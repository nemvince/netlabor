#!/usr/bin/env bash
# Install the controller binary, unit, and environment file. Requires root.
set -euo pipefail

BINARY="${1:-dist/netlabor-controller}"
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

id -u netlabor-controller >/dev/null 2>&1 || useradd --system --home /var/lib/netlabor --shell /usr/sbin/nologin netlabor-controller
install -d -m 0755 "$PREFIX" "$ENV_DIR"
install -d -m 0750 -o netlabor-controller -g netlabor-controller /var/lib/netlabor
install -m 0755 "$BINARY" "$PREFIX/netlabor-controller"
install -m 0644 deploy/systemd/netlabor-controller.service /etc/systemd/system/netlabor-controller.service
if [[ ! -f "$ENV_DIR/controller.env" ]]; then
  umask 077
  cat > "$ENV_DIR/controller.env" <<ENV
NB_DATABASE_URL=postgres://netlabor:change-me@127.0.0.1:5432/netlabor
NB_PUBLIC_URL=https://netlabor.example.com
NB_SECRET_KEY=$(head -c32 /dev/urandom | base64)
NB_LISTEN=0.0.0.0:8080
NB_ADMIN_USER=admin
NB_ADMIN_PASSWORD=change-this-password
NB_WEB_ROOT=/opt/netlabor/web
NB_LOG_LEVEL=info
ENV
  echo "wrote $ENV_DIR/controller.env — edit it before starting"
fi
systemctl daemon-reload
echo "installed; enable with: systemctl enable --now netlabor-controller"
