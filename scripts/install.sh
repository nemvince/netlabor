#!/usr/bin/env bash
# Netlabor installer and updater: controller (UI, API, database owner) and/or compute agent.
# Debian/Ubuntu hosts get their dependencies installed automatically.
#
#   curl -fsSL https://raw.githubusercontent.com/nemvince/netlabor/main/scripts/install.sh | sudo bash
#
# Interactive for a fresh install and non-interactive for an update (existing
# /etc/netlabor/*.env); every prompt has a flag for scripted installs (`--help`).
set -euo pipefail

REPO=nemvince/netlabor
PREFIX=/opt/netlabor
ENV_DIR=/etc/netlabor
LOG=/var/log/netlabor-install.log
REF=latest
ROLES=""
ASSUME_YES=0
SKIP_DEPS=0
DEPS_SET=0
BINARY_DIR=""
WITH_DOCKER=0
WITH_NAT=0

PUBLIC_URL=""
ADMIN_USER="admin"
ADMIN_PASSWORD=""
DATABASE_URL=""
LISTEN="0.0.0.0:8080"
WEB_ROOT=""

TOKEN=""
UNDERLAY_HOST="10.0.0.1"
UNDERLAY_INDEX="1"
UNDERLAY_INTERFACE="wg0"

usage() {
  cat <<'USAGE'
Usage: install.sh [options]

Re-running the script updates an existing install: the environment files are
kept, nothing is prompted, host dependencies are skipped, and running services
are restarted. Pass --with-deps to install dependencies again.

Roles (detected from existing installs; ask when omitted):
  --controller            install or update the controller (UI + API)
  --agent                 install or update the compute agent
  --all                   both on this host

Release:
  --version <tag|nightly> install a specific release tag, or the nightly channel
  --binary-dir <dir>      use local binaries (netlabor-controller, netlabor-agent) instead of downloading

Controller (fresh installs only):
  --public-url <url>      URL browsers use (default http://<host>:8080)
  --admin-user <name>     first administrator (default admin)
  --admin-password <pw>   first administrator password
  --database-url <url>    PostgreSQL URL; on Debian it is created automatically when omitted
  --listen <addr:port>    default 0.0.0.0:8080
  --web-root <dir>        serve the UI from disk instead of the copy embedded in the binary

Agent (fresh installs only):
  --token <token>         compute token printed by the controller
  --underlay-host <ip>    controller underlay address the agent dials
  --underlay-index <n>    underlay address index (default 1)
  --underlay-interface <if>  default wg0
  --with-docker           install Docker Engine for container nodes
  --with-nat              provision the host NAT bridge for NAT nodes

General:
  --skip-deps             do not install or configure host dependencies
  --with-deps             install host dependencies even when updating
  --yes                   non-interactive: accept defaults and flags, never prompt
  --help                  show this help
USAGE
}

die() {
  echo "error: $*" >&2
  exit 1
}

say() {
  echo "==> $*"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --controller) ROLES+=" controller" ;;
    --agent) ROLES+=" agent" ;;
    --all) ROLES="controller agent" ;;
    --version) REF="${2:?--version needs a value}" && shift ;;
    --binary-dir) BINARY_DIR="${2:?--binary-dir needs a value}" && shift ;;
    --public-url) PUBLIC_URL="${2:?--public-url needs a value}" && shift ;;
    --admin-user) ADMIN_USER="${2:?--admin-user needs a value}" && shift ;;
    --admin-password) ADMIN_PASSWORD="${2:?--admin-password needs a value}" && shift ;;
    --database-url) DATABASE_URL="${2:?--database-url needs a value}" && shift ;;
    --listen) LISTEN="${2:?--listen needs a value}" && shift ;;
    --web-root) WEB_ROOT="${2:?--web-root needs a value}" && shift ;;
    --token) TOKEN="${2:?--token needs a value}" && shift ;;
    --underlay-host) UNDERLAY_HOST="${2:?--underlay-host needs a value}" && shift ;;
    --underlay-index) UNDERLAY_INDEX="${2:?--underlay-index needs a value}" && shift ;;
    --underlay-interface) UNDERLAY_INTERFACE="${2:?--underlay-interface needs a value}" && shift ;;
    --with-docker) WITH_DOCKER=1 ;;
    --with-nat) WITH_NAT=1 ;;
    --skip-deps) SKIP_DEPS=1 && DEPS_SET=1 ;;
    --with-deps) SKIP_DEPS=0 && DEPS_SET=1 ;;
    --yes) ASSUME_YES=1 ;;
    --help | -h) usage && exit 0 ;;
    *) usage >&2 && die "unknown option: $1" ;;
  esac
  shift
done

[[ $EUID -eq 0 ]] || die "run as root: curl -fsSL .../scripts/install.sh | sudo bash"

INTERACTIVE=1
if [[ $ASSUME_YES -eq 1 ]]; then
  INTERACTIVE=0
elif ! { exec 3</dev/tty; } 2>/dev/null; then
  INTERACTIVE=0
fi
# Prompts talk to the terminal even when the script arrives on stdin.
[[ $INTERACTIVE -eq 1 ]] && exec 0</dev/tty

ask() { # ask <var> <prompt> <default>
  local __value
  if [[ $INTERACTIVE -eq 1 ]]; then
    read -r -p "$2 [$3]: " __value
  fi
  printf -v "$1" '%s' "${__value:-${3:-}}"
}

ask_secret() { # ask_secret <var> <prompt>
  local __value
  if [[ $INTERACTIVE -eq 1 ]]; then
    read -r -s -p "$2: " __value && echo >&2
  fi
  printf -v "$1" '%s' "${__value:-}"
}

confirm() { # confirm <prompt> <default: y|n>
  [[ $INTERACTIVE -eq 0 ]] && [[ "${2:-y}" == y ]] && return 0
  local __answer
  read -r -p "$1 [${2:-y}]: " __answer
  [[ "${__answer:-${2:-y}}" =~ ^([yY]|[yY][eE][sS])$ ]]
}

EXISTING_CONTROLLER=0
[[ -f "$ENV_DIR/controller.env" || -x "$PREFIX/netlabor-controller" ]] && EXISTING_CONTROLLER=1
EXISTING_AGENT=0
[[ -f "$ENV_DIR/agent.env" || -x "$PREFIX/netlabor-agent" ]] && EXISTING_AGENT=1

if [[ -z "${ROLES// /}" ]]; then
  if [[ $EXISTING_CONTROLLER -eq 1 || $EXISTING_AGENT -eq 1 ]]; then
    # Re-run: update whatever is installed here.
    [[ $EXISTING_CONTROLLER -eq 1 ]] && ROLES+=" controller"
    [[ $EXISTING_AGENT -eq 1 ]] && ROLES+=" agent"
  elif [[ $INTERACTIVE -eq 1 ]]; then
    confirm "Install the controller (UI + API) on this host?" y && ROLES+=" controller"
    confirm "Install a compute agent on this host?" n && ROLES+=" agent"
  else
    ROLES="controller"
  fi
fi
ROLES=$(printf '%s' "$ROLES" | xargs)
[[ -n "$ROLES" ]] || die "nothing selected: pass --controller, --agent or --all"
INSTALL_CONTROLLER=0
INSTALL_AGENT=0
if [[ "$ROLES" == *controller* ]]; then INSTALL_CONTROLLER=1; fi
if [[ "$ROLES" == *agent* ]]; then INSTALL_AGENT=1; fi
UPDATE=0
if [[ $INSTALL_CONTROLLER -eq 1 && $EXISTING_CONTROLLER -eq 1 ]] || [[ $INSTALL_AGENT -eq 1 && $EXISTING_AGENT -eq 1 ]]; then
  UPDATE=1
fi
# An update replaces binaries only; host dependencies are skipped unless asked for.
if [[ $DEPS_SET -eq 0 && $UPDATE -eq 1 ]]; then SKIP_DEPS=1; fi

case "$(uname -m)" in
  x86_64 | amd64) ARCH=x64 ;;
  aarch64 | arm64) ARCH=arm64 ;;
  *) die "unsupported architecture: $(uname -m) (release builds: x64, arm64)" ;;
esac

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
: >"$LOG"

say "Netlabor installer ($ROLES)"

fetch() { # fetch <url> <dest>
  command -v curl >/dev/null 2>&1 || die "curl is required"
  if [[ -t 2 ]]; then
    curl -fSL --retry 3 --progress-bar -o "$2" "$1" || die "download failed: $1"
  else
    curl -fsSL --retry 3 -o "$2" "$1" || die "download failed: $1"
  fi
}

TAG=""
resolve_release() {
  [[ -n "$BINARY_DIR" ]] && return 0
  if [[ "$REF" == latest ]]; then
    say "Resolving the latest release"
    TAG=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" |
      sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1)
    [[ -n "$TAG" ]] || die "could not resolve the latest release"
  else
    TAG="$REF"
  fi
}

get_binary() { # get_binary <controller|agent> <dest>
  if [[ -n "$BINARY_DIR" ]]; then
    say "Using $BINARY_DIR/netlabor-$1"
    cp "$BINARY_DIR/netlabor-$1" "$2" || die "$BINARY_DIR/netlabor-$1 not found"
    return 0
  fi
  local name="netlabor-$1-linux-$ARCH"
  say "Downloading $name $TAG"
  fetch "https://github.com/$REPO/releases/download/$TAG/$name" "$2"
  fetch "https://github.com/$REPO/releases/download/$TAG/SHA256SUMS" "$TMP/SHA256SUMS"
  local want
  want=$(awk -v n="$name" '$2 == n { print $1 }' "$TMP/SHA256SUMS")
  [[ -n "$want" ]] || die "release $TAG has no $name"
  [[ "$(sha256sum "$2" | cut -d' ' -f1)" == "$want" ]] || die "checksum mismatch for $name"
  say "Verified SHA256SUMS for $name"
}

apt_install() {
  [[ $SKIP_DEPS -eq 0 ]] || return 1
  command -v apt-get >/dev/null 2>&1 || return 1
  say "Installing packages: $*"
  {
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$@"
  } >>"$LOG" 2>&1 || {
    tail -n 15 "$LOG" >&2
    die "package installation failed (log: $LOG)"
  }
}

# --- controller ------------------------------------------------------------

install_controller() {
  local binary="$TMP/netlabor-controller"
  local fresh=0
  [[ -f "$ENV_DIR/controller.env" ]] || fresh=1
  get_binary controller "$binary"
  install -d -m 0755 "$ENV_DIR"

  local db_password=""
  if [[ $fresh -eq 1 ]]; then
    if [[ -z "$DATABASE_URL" && $SKIP_DEPS -eq 0 ]] && command -v apt-get >/dev/null 2>&1; then
      say "Installing controller dependencies (PostgreSQL)"
      apt_install ca-certificates postgresql
      systemctl enable --now postgresql >/dev/null 2>&1 || true
      if [[ "$(runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='netlabor'" 2>/dev/null)" != 1 ]]; then
        db_password=$(head -c32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c24)
        runuser -u postgres -- psql -v ON_ERROR_STOP=1 \
          -c "CREATE ROLE netlabor LOGIN PASSWORD '$db_password'" >/dev/null
      fi
      [[ "$(runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_database WHERE datname='netlabor'" 2>/dev/null)" == 1 ]] ||
        runuser -u postgres -- createdb -O netlabor netlabor
      say "Database netlabor ready"
    fi
    [[ -n "$DATABASE_URL" ]] || ask DATABASE_URL "PostgreSQL URL" \
      "postgres://netlabor:${db_password:-change-me}@127.0.0.1:5432/netlabor"
    [[ -n "$PUBLIC_URL" ]] || ask PUBLIC_URL "Public URL browsers use" "http://$(hostname -f 2>/dev/null || hostname):8080"
    [[ -n "$ADMIN_PASSWORD" ]] || ask_secret ADMIN_PASSWORD "First administrator password (empty = run the setup wizard)"
    ask ADMIN_USER "First administrator user" "$ADMIN_USER"
    ask LISTEN "Listen address" "$LISTEN"
  fi

  id -u netlabor-controller >/dev/null 2>&1 ||
    useradd --system --home /var/lib/netlabor --shell /usr/sbin/nologin netlabor-controller
  # The controller installs its own updates, so its service group writes the prefix.
  install -d -m 0775 -o root -g netlabor-controller "$PREFIX"
  install -d -m 0750 -o netlabor-controller -g netlabor-controller /var/lib/netlabor
  install -m 0755 "$binary" "$PREFIX/netlabor-controller"

  if [[ $fresh -eq 0 ]]; then
    say "Keeping $ENV_DIR/controller.env"
  else
    umask 077
    {
      echo "NB_DATABASE_URL=$DATABASE_URL"
      echo "NB_PUBLIC_URL=$PUBLIC_URL"
      echo "NB_SECRET_KEY=$(head -c32 /dev/urandom | base64)"
      echo "NB_LISTEN=$LISTEN"
      echo "NB_ADMIN_USER=$ADMIN_USER"
      echo "NB_ADMIN_PASSWORD=$ADMIN_PASSWORD"
      echo "NB_LOG_LEVEL=info"
      if [[ -n "$WEB_ROOT" ]]; then echo "NB_WEB_ROOT=$WEB_ROOT"; fi
    } >"$ENV_DIR/controller.env"
    say "Wrote $ENV_DIR/controller.env"
  fi
}

# --- agent -----------------------------------------------------------------

provision_nat_bridge() {
  [[ $SKIP_DEPS -eq 0 ]] && apt_install iptables dnsmasq >/dev/null || true
  local uplink
  uplink=$(ip route show default | awk '{print $5; exit}')
  [[ -n "$uplink" ]] || die "no default uplink for the NAT bridge"
  say "Provisioning the NAT bridge on $uplink"
  ip link show nb-nat >/dev/null 2>&1 || ip link add nb-nat type bridge
  ip addr replace 10.10.99.1/24 dev nb-nat
  ip link set nb-nat up
  sysctl -w net.ipv4.ip_forward=1 >/dev/null
  if nft list table inet netlabor >/dev/null 2>&1; then
    nft list chain inet netlabor forward 2>/dev/null | grep -q 'nt\*' ||
      nft add rule inet netlabor forward iifname 'nt*' accept
    nft list chain inet netlabor forward 2>/dev/null | grep -q 'iifname "nb-nat"' ||
      nft add rule inet netlabor forward iifname "nb-nat" accept
  fi
  iptables -C FORWARD -i nb-nat -o "$uplink" -j ACCEPT 2>/dev/null ||
    iptables -A FORWARD -i nb-nat -o "$uplink" -j ACCEPT
  iptables -C FORWARD -i "$uplink" -o nb-nat -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null ||
    iptables -A FORWARD -i "$uplink" -o nb-nat -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
  iptables -t nat -C POSTROUTING -s 10.10.99.0/24 -o "$uplink" -j MASQUERADE 2>/dev/null ||
    iptables -t nat -A POSTROUTING -s 10.10.99.0/24 -o "$uplink" -j MASQUERADE
  mkdir -p /run/netlabor
  [[ -f /run/netlabor/nat-dnsmasq.pid ]] &&
    kill "$(cat /run/netlabor/nat-dnsmasq.pid)" 2>/dev/null || true
  dnsmasq --conf-file=/dev/null --interface=nb-nat --bind-interfaces --dhcp-authoritative \
    --dhcp-range=10.10.99.100,10.10.99.199,12h --dhcp-option=3,10.10.99.1 \
    --dhcp-option=6,1.1.1.1,9.9.9.9 --no-resolv --server=1.1.1.1 --server=9.9.9.9 \
    --pid-file=/run/netlabor/nat-dnsmasq.pid
  say "NAT bridge nb-nat ready: 10.10.99.1/24 via $uplink"
}

install_agent() {
  local binary="$TMP/netlabor-agent"
  local fresh=0
  [[ -f "$ENV_DIR/agent.env" ]] || fresh=1
  get_binary agent "$binary"

  local packages=(ca-certificates iproute2 nftables util-linux qemu-system-x86 qemu-utils
    xorriso tcpdump tshark vpcs ethtool bridge-utils libcap2-bin git build-essential libpcap-dev)
  [[ $WITH_DOCKER -eq 1 ]] && packages+=(docker.io)
  [[ $WITH_NAT -eq 1 ]] && packages+=(iptables dnsmasq)
  if apt_install "${packages[@]}"; then
    if ! command -v ubridge >/dev/null 2>&1; then
      say "Building ubridge from source"
      {
        git clone --depth 1 https://github.com/GNS3/ubridge.git "$TMP/ubridge"
        make -C "$TMP/ubridge" -j"$(nproc)"
        make -C "$TMP/ubridge" install
      } >>"$LOG" 2>&1 || die "ubridge build failed (log: $LOG)"
    fi
    command -v dynamips >/dev/null 2>&1 ||
      echo "note: dynamips is not installed; add it manually for IOS routers" >&2
  fi
  for bin in ip nft tc ubridge; do
    command -v "$bin" >/dev/null 2>&1 ||
      echo "warning: $bin not found (kernel dataplane features may be unavailable)" >&2
  done

  # Emulators drop from root to an unprivileged account (NB_EMULATOR_UID/GID).
  getent group netlabor-emu >/dev/null 2>&1 || groupadd --system netlabor-emu 2>/dev/null || true
  getent passwd netlabor-emu >/dev/null 2>&1 ||
    useradd --system --gid netlabor-emu --home-dir /nonexistent \
      --shell /usr/sbin/nologin netlabor-emu 2>/dev/null || true
  id -u netlabor-emu >/dev/null 2>&1 || die "could not create the netlabor-emu account"

  install -d -m 0755 "$PREFIX" "$ENV_DIR" /var/lib/netlabor /var/lib/netlabor/images
  install -d -m 0700 /run/netlabor
  install -m 0755 "$binary" "$PREFIX/netlabor-agent"

  if [[ $fresh -eq 0 ]]; then
    say "Keeping $ENV_DIR/agent.env"
  else
    [[ -n "$TOKEN" ]] || ask TOKEN "Compute token (printed by the controller; empty = add it later)"
    [[ -n "$UNDERLAY_HOST" ]] || ask UNDERLAY_HOST "Controller underlay address" "$UNDERLAY_HOST"
    ask UNDERLAY_INDEX "Underlay address index" "$UNDERLAY_INDEX"
    ask UNDERLAY_INTERFACE "Underlay interface" "$UNDERLAY_INTERFACE"
    umask 077
    cat >"$ENV_DIR/agent.env" <<ENV
NB_AGENT_TOKEN=${TOKEN:-replace-with-compute-token}
NB_UNDERLAY_INDEX=$UNDERLAY_INDEX
NB_UNDERLAY_HOST=$UNDERLAY_HOST
NB_AGENT_LISTEN=0.0.0.0:8081
NB_STATE_DIR=/var/lib/netlabor
NB_RUN_DIR=/run/netlabor
NB_UBRIDGE_PATH=$(command -v ubridge 2>/dev/null || echo /usr/local/bin/ubridge)
NB_UNDERLAY_INTERFACE=$UNDERLAY_INTERFACE
NB_EMULATOR_UID=$(id -u netlabor-emu)
NB_EMULATOR_GID=$(id -g netlabor-emu)
NB_NAT_BRIDGE=nb-nat
NB_LOG_LEVEL=info
ENV
    say "Wrote $ENV_DIR/agent.env"
  fi

  if [[ $WITH_NAT -eq 1 ]]; then provision_nat_bridge; fi
}

# --- units (kept in sync with deploy/systemd/) -----------------------------

write_units() {
  if [[ $INSTALL_CONTROLLER -eq 1 ]]; then
    cat >/etc/systemd/system/netlabor-controller.service <<'UNIT'
[Unit]
Description=Netlabor controller (API, UI, database owner)
Documentation=https://github.com/nemvince/netlabor
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=netlabor-controller
Group=netlabor-controller
EnvironmentFile=/etc/netlabor/controller.env
ExecStart=/opt/netlabor/netlabor-controller
Restart=always
RestartSec=3
StateDirectory=netlabor
WorkingDirectory=/opt/netlabor
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/netlabor /opt/netlabor
CapabilityBoundingSet=
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
UNIT
  fi
  if [[ $INSTALL_AGENT -eq 1 ]]; then
    cat >/etc/systemd/system/netlabor-agent.service <<'UNIT'
[Unit]
Description=Netlabor compute agent (namespaces, ubridge, emulators)
Documentation=https://github.com/nemvince/netlabor
After=network-online.target docker.service
Wants=network-online.target
RequiresMountsFor=/var/lib/netlabor

[Service]
Type=simple
User=root
Group=root
EnvironmentFile=/etc/netlabor/agent.env
ExecStart=/opt/netlabor/netlabor-agent
Restart=always
RestartSec=3
StateDirectory=netlabor
RuntimeDirectory=netlabor
RuntimeDirectoryMode=0700
WorkingDirectory=/opt/netlabor
KillMode=control-group
LimitNOFILE=1048576
PrivateMounts=no
NoNewPrivileges=false

[Install]
WantedBy=multi-user.target
UNIT
  fi
}

restart_if_running() { # restart_if_running <unit>
  command -v systemctl >/dev/null 2>&1 || return 0
  if systemctl is-active --quiet "$1"; then
    say "Restarting $1"
    systemctl restart "$1"
  fi
}

resolve_release
if [[ $UPDATE -eq 1 ]]; then
  say "Updating $ROLES to ${TAG:-the local build}"
else
  say "Installing $ROLES${TAG:+ $TAG}"
fi
[[ $INSTALL_CONTROLLER -eq 1 ]] && install_controller
[[ $INSTALL_AGENT -eq 1 ]] && install_agent
write_units
command -v systemctl >/dev/null 2>&1 && systemctl daemon-reload || true
[[ $INSTALL_CONTROLLER -eq 1 ]] && restart_if_running netlabor-controller
[[ $INSTALL_AGENT -eq 1 ]] && restart_if_running netlabor-agent

echo
if [[ $UPDATE -eq 1 ]]; then
  echo "Updated: $ROLES."
else
  echo "Installed: $ROLES."
  [[ $INSTALL_CONTROLLER -eq 1 ]] && echo "  start the controller: systemctl enable --now netlabor-controller"
  [[ $INSTALL_AGENT -eq 1 ]] && echo "  start the agent:      systemctl enable --now netlabor-agent"
  if [[ $INSTALL_CONTROLLER -eq 0 && $INSTALL_AGENT -eq 1 ]]; then
    echo "  register this compute under Computes → Add compute in the controller, then put the token in $ENV_DIR/agent.env"
  fi
fi
