#!/usr/bin/env bash
# Install the controller binary, unit, web bundle, and environment file.
# Debian 13: installs PostgreSQL and creates a database/role automatically.
# Other hosts: pass --skip-deps and point NB_DATABASE_URL at an existing server.
set -euo pipefail

BINARY="dist/netlabor-controller"
SKIP_DEPS=0
for arg in "$@"; do
  case "$arg" in
    --skip-deps) SKIP_DEPS=1 ;;
    -*) echo "unknown option: $arg" >&2; exit 1 ;;
    *) BINARY="$arg" ;;
  esac
done

PREFIX=/opt/netlabor
ENV_DIR=/etc/netlabor
WEB_BUNDLE=apps/web/dist

if [[ $EUID -ne 0 ]]; then
  echo "run as root" >&2
  exit 1
fi
if [[ ! -f "$BINARY" ]]; then
  echo "binary $BINARY not found; run 'bun run build' first" >&2
  exit 1
fi

DB_PASSWORD=""
if [[ $SKIP_DEPS -eq 0 ]] && command -v apt-get >/dev/null 2>&1; then
  echo "installing controller dependencies (Debian/Ubuntu)"
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    ca-certificates postgresql
  systemctl enable --now postgresql >/dev/null 2>&1 || true

  # Generate a role password only when this install owns the database.
  existing_role=$(runuser -u postgres -- psql -tAc \
    "SELECT 1 FROM pg_roles WHERE rolname='netlabor'" 2>/dev/null || true)
  if [[ "$existing_role" != "1" ]]; then
    DB_PASSWORD=$(head -c32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c24)
    runuser -u postgres -- psql -v ON_ERROR_STOP=1 -c \
      "CREATE ROLE netlabor LOGIN PASSWORD '$DB_PASSWORD'" >/dev/null
  else
    echo "note: PostgreSQL role netlabor already exists; set its password in NB_DATABASE_URL" >&2
  fi
  existing_db=$(runuser -u postgres -- psql -tAc \
    "SELECT 1 FROM pg_database WHERE datname='netlabor'" 2>/dev/null || true)
  if [[ "$existing_db" != "1" ]]; then
    runuser -u postgres -- createdb -O netlabor netlabor
  fi
fi

id -u netlabor-controller >/dev/null 2>&1 || useradd --system --home /var/lib/netlabor --shell /usr/sbin/nologin netlabor-controller
# The controller installs its own updates, so its service group may write the prefix.
install -d -m 0775 -o root -g netlabor-controller "$PREFIX"
install -d -m 0755 "$ENV_DIR"
install -d -m 0750 -o netlabor-controller -g netlabor-controller /var/lib/netlabor
install -m 0755 "$BINARY" "$PREFIX/netlabor-controller"
install -m 0644 deploy/systemd/netlabor-controller.service /etc/systemd/system/netlabor-controller.service

if [[ -d "$WEB_BUNDLE" ]]; then
  install -d -m 0755 "$PREFIX/web"
  cp -a "$WEB_BUNDLE/." "$PREFIX/web/"
  echo "installed the web bundle to $PREFIX/web"
else
  echo "warning: $WEB_BUNDLE is missing; the controller will serve no UI" >&2
fi

if [[ ! -f "$ENV_DIR/controller.env" ]]; then
  if [[ -z "$DB_PASSWORD" ]]; then
    DATABASE_URL='postgres://netlabor:change-me@127.0.0.1:5432/netlabor'
  else
    DATABASE_URL="postgres://netlabor:${DB_PASSWORD}@127.0.0.1:5432/netlabor"
  fi
  umask 077
  cat > "$ENV_DIR/controller.env" <<ENV
NB_DATABASE_URL=$DATABASE_URL
NB_PUBLIC_URL=https://netlabor.example.com
NB_SECRET_KEY=$(head -c32 /dev/urandom | base64)
NB_LISTEN=0.0.0.0:8080
NB_ADMIN_USER=admin
NB_ADMIN_PASSWORD=change-this-password
NB_WEB_ROOT=$PREFIX/web
NB_LOG_LEVEL=info
ENV
  echo "wrote $ENV_DIR/controller.env — edit NB_PUBLIC_URL and NB_ADMIN_PASSWORD before starting"
fi

systemctl daemon-reload
echo "installed; enable with: systemctl enable --now netlabor-controller"
