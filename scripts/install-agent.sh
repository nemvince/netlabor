#!/usr/bin/env bash
# Install the compute agent binary and unit. Requires root on the compute host.
set -euo pipefail

BINARY="${1:-dist/netlabor-agent}"
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
for bin in ip nft tc ubridge; do
  command -v "$bin" >/dev/null 2>&1 || echo "warning: $bin not found (kernel dataplane features may be unavailable)" >&2
done

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
NB_UBRIDGE_PATH=/usr/local/bin/ubridge
NB_UNDERLAY_INTERFACE=wg0
NB_EMULATOR_UID=1001
NB_EMULATOR_GID=1001
NB_NAT_BRIDGE=nb-nat
NB_LOG_LEVEL=info
ENV
  echo "wrote $ENV_DIR/agent.env — fill in the token and underlay values"
fi
systemctl daemon-reload
echo "installed; enable with: systemctl enable --now netlabor-agent"
