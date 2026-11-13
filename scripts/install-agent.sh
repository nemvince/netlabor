#!/usr/bin/env bash
# Install the compute agent binary, unit, environment file, and on Debian 13
# the host tools it needs (QEMU, vpcs, tshark, nftables, xorriso, ubridge).
# Pass --skip-deps to only install the binary.
set -euo pipefail

BINARY="dist/netlabor-agent"
SKIP_DEPS=0
WITH_DOCKER=0
WITH_NAT=0
for arg in "$@"; do
  case "$arg" in
    --skip-deps) SKIP_DEPS=1 ;;
    --with-docker) WITH_DOCKER=1 ;;
    --with-nat) WITH_NAT=1 ;;
    -*) echo "unknown option: $arg" >&2; exit 1 ;;
    *) BINARY="$arg" ;;
  esac
done

PREFIX=/opt/netlabor
ENV_DIR=/etc/netlabor

if [[ $EUID -ne 0 ]]; then
  echo "run as root" >&2
  exit 1
fi
if [[ ! -f "$BINARY" ]]; then
  echo "binary $BINARY not found; run 'bun run build' first" >&2
  exit 1
fi

if [[ $SKIP_DEPS -eq 0 ]] && command -v apt-get >/dev/null 2>&1; then
  echo "installing agent dependencies (Debian/Ubuntu)"
  packages=(
    ca-certificates
    iproute2
    nftables
    util-linux
    qemu-system-x86
    qemu-utils
    xorriso
    tcpdump
    tshark
    vpcs
    ethtool
    bridge-utils
    libcap2-bin
    git
    build-essential
    libpcap-dev
  )
  if [[ $WITH_DOCKER -eq 1 ]]; then packages+=(docker.io); fi
  if [[ $WITH_NAT -eq 1 ]]; then packages+=(iptables dnsmasq); fi
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${packages[@]}"

  # ubridge is not packaged in Debian main; build the upstream release with
  # the marker, iol_bridge, and capture modules the agent expects.
  if ! command -v ubridge >/dev/null 2>&1; then
    echo "building ubridge from source"
    tmp=$(mktemp -d)
    trap 'rm -rf "$tmp"' EXIT
    git clone --depth 1 https://github.com/GNS3/ubridge.git "$tmp/ubridge"
    make -C "$tmp/ubridge" -j"$(nproc)"
    make -C "$tmp/ubridge" install
    trap - EXIT
    rm -rf "$tmp"
  fi

  # dynamips is not in Debian main; the agent reports it as missing and the
  # Dynamips templates stay unavailable until it is installed by hand.
  if ! command -v dynamips >/dev/null 2>&1; then
    echo "note: dynamips is not installed; add it manually if you need IOS routers" >&2
  fi
fi

for bin in ip nft tc ubridge; do
  command -v "$bin" >/dev/null 2>&1 || echo "warning: $bin not found (kernel dataplane features may be unavailable)" >&2
done

# Emulators drop from root to an unprivileged account (NB_EMULATOR_UID/GID).
EMU_USER=netlabor-emu
if ! getent group "$EMU_USER" >/dev/null 2>&1; then
  groupadd --system "$EMU_USER" 2>/dev/null || true
fi
if ! getent passwd "$EMU_USER" >/dev/null 2>&1; then
  useradd --system --gid "$EMU_USER" --home-dir /nonexistent \
    --shell /usr/sbin/nologin "$EMU_USER" 2>/dev/null || true
fi
if ! id -u "$EMU_USER" >/dev/null 2>&1; then
  echo "could not create the $EMU_USER emulator account" >&2
  exit 1
fi
EMU_UID=$(id -u "$EMU_USER")
EMU_GID=$(id -g "$EMU_USER")

install -d -m 0755 "$PREFIX" "$ENV_DIR"
install -d -m 0755 /var/lib/netlabor /var/lib/netlabor/images
install -d -m 0700 /run/netlabor
install -m 0755 "$BINARY" "$PREFIX/netlabor-agent"
install -m 0644 deploy/systemd/netlabor-agent.service /etc/systemd/system/netlabor-agent.service
if [[ ! -f "$ENV_DIR/agent.env" ]]; then
  umask 077
  cat > "$ENV_DIR/agent.env" <<ENV
# Values are printed by the controller when a compute is registered.
NB_AGENT_TOKEN=replace-with-compute-token
NB_UNDERLAY_INDEX=1
NB_UNDERLAY_HOST=10.0.0.1
NB_AGENT_LISTEN=0.0.0.0:8081
NB_STATE_DIR=/var/lib/netlabor
NB_RUN_DIR=/run/netlabor
NB_UBRIDGE_PATH=$(command -v ubridge 2>/dev/null || echo /usr/local/bin/ubridge)
NB_UNDERLAY_INTERFACE=wg0
NB_EMULATOR_UID=$EMU_UID
NB_EMULATOR_GID=$EMU_GID
NB_NAT_BRIDGE=nb-nat
NB_LOG_LEVEL=info
ENV
  echo "wrote $ENV_DIR/agent.env — fill in the token and underlay values"
fi

if [[ $WITH_NAT -eq 1 ]]; then
  if [[ -x scripts/provision-nat-bridge.sh ]]; then
    scripts/provision-nat-bridge.sh
  else
    echo "warning: scripts/provision-nat-bridge.sh not found; provision ${NB_NAT_BRIDGE:-nb-nat} manually" >&2
  fi
fi

systemctl daemon-reload
echo "installed; enable with: systemctl enable --now netlabor-agent"
