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
STORAGE_DRIVER=""
NFS_IMAGE_DIR=""
STORAGE_SET=0
PROJECT_DIR=""
TEMPLATE_DIR=""

PUBLIC_URL=""
ADMIN_USER="admin"
ADMIN_PASSWORD=""
DATABASE_URL=""
LISTEN="0.0.0.0:8080"
WEB_ROOT=""

TOKEN=""
REG_TOKEN=""
REG_INDEX=""
CONTROLLER_URL=""
AGENT_URL=""
COMPUTE_NAME=""
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
  --controller-url <url>  controller that registers this compute (asked for agent-only installs)
  --agent-url <url>       URL the controller uses to reach this agent (default http://<host>:8081)
  --compute-name <name>   compute name in the controller (default hostname)
  --token <token>         skip registration and use this compute token
  --underlay-host <ip>    controller underlay address the agent dials
  --underlay-index <n>    underlay address index (default 1)
  --underlay-interface <if>  default wg0
  --with-docker           install Docker Engine for container nodes
  --with-nat              provision the host NAT bridge for NAT nodes

Images (controller and agent installs; re-run to change an existing install):
  --storage-driver local|nfs   keep images per compute, or share one NFS directory
  --nfs-image-dir <dir>        shared image directory, e.g. /srv/netlabor/images
                               (required with --storage-driver nfs; mounted on agents)
  --project-dir <dir>          per-compute node working directories (default
                               /var/lib/netlabor/projects; put it on local disk)
  --template-dir <dir>         appliance bundle directory for import:appliances

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
    --controller-url) CONTROLLER_URL="${2:?--controller-url needs a value}" && shift ;;
    --agent-url) AGENT_URL="${2:?--agent-url needs a value}" && shift ;;
    --compute-name) COMPUTE_NAME="${2:?--compute-name needs a value}" && shift ;;
    --underlay-host) UNDERLAY_HOST="${2:?--underlay-host needs a value}" && shift ;;
    --underlay-index) UNDERLAY_INDEX="${2:?--underlay-index needs a value}" && shift ;;
    --underlay-interface) UNDERLAY_INTERFACE="${2:?--underlay-interface needs a value}" && shift ;;
    --with-docker) WITH_DOCKER=1 ;;
    --with-nat) WITH_NAT=1 ;;
    --storage-driver) STORAGE_DRIVER="${2:?--storage-driver needs a value}" && STORAGE_SET=1 && shift ;;
    --nfs-image-dir) NFS_IMAGE_DIR="${2:?--nfs-image-dir needs a value}"; STORAGE_SET=1; [[ -n "$STORAGE_DRIVER" ]] || STORAGE_DRIVER=nfs; shift ;;
    --project-dir) PROJECT_DIR="${2:?--project-dir needs a value}" && shift ;;
    --template-dir) TEMPLATE_DIR="${2:?--template-dir needs a value}" && shift ;;
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

env_get() { # env_get <file> <key>
  [[ -f "$1" ]] || return 0
  sed -n "s/^$2=//p" "$1" | tail -n 1
}

set_env() { # set_env <file> <key> <value>
  local tmp
  tmp=$(mktemp)
  grep -v "^$2=" "$1" >"$tmp" || true
  printf '%s=%s\n' "$2" "$3" >>"$tmp"
  cat "$tmp" >"$1"
  rm -f "$tmp"
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

# Keep an existing image-store setting when re-running without the flags.
if [[ -z "$STORAGE_DRIVER" ]]; then
  STORAGE_DRIVER=$(env_get "$ENV_DIR/controller.env" NB_STORAGE_DRIVER)
  [[ -n "$STORAGE_DRIVER" ]] || STORAGE_DRIVER=$(env_get "$ENV_DIR/agent.env" NB_STORAGE_DRIVER)
fi
if [[ -z "$NFS_IMAGE_DIR" ]]; then
  NFS_IMAGE_DIR=$(env_get "$ENV_DIR/controller.env" NB_NFS_IMAGE_DIR)
  [[ -n "$NFS_IMAGE_DIR" ]] || NFS_IMAGE_DIR=$(env_get "$ENV_DIR/agent.env" NB_NFS_IMAGE_DIR)
fi
STORAGE_DRIVER=${STORAGE_DRIVER:-local}
[[ "$STORAGE_DRIVER" == local || "$STORAGE_DRIVER" == nfs ]] ||
  die "--storage-driver must be local or nfs"
if [[ "$STORAGE_DRIVER" == nfs && -z "$NFS_IMAGE_DIR" ]]; then
  die "--nfs-image-dir is required with --storage-driver nfs"
fi
[[ -n "$PROJECT_DIR" ]] || PROJECT_DIR=$(env_get "$ENV_DIR/agent.env" NB_PROJECT_DIR)
[[ -n "$TEMPLATE_DIR" ]] || TEMPLATE_DIR=$(env_get "$ENV_DIR/controller.env" NB_TEMPLATE_DIR)

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

# ProtectSystem=strict hides a mounted image directory from the controller
# unless the path is added to ReadWritePaths; the unit is generic, so the
# deployment-specific paths go in a drop-in.
write_nfs_override() { # write_nfs_override <controller|agent>
  local unit=$1 dir="/etc/systemd/system/netlabor-$1.service.d"
  local -a paths=()
  [[ "$STORAGE_DRIVER" == nfs && -n "$NFS_IMAGE_DIR" ]] && paths+=("$NFS_IMAGE_DIR")
  [[ "$unit" == agent && -n "$PROJECT_DIR" && "$PROJECT_DIR" != /var/lib/netlabor/projects ]] &&
    paths+=("$PROJECT_DIR")
  if [[ ${#paths[@]} -eq 0 ]]; then
    rm -f "$dir/nfs.conf"
    return 0
  fi
  install -d -m 0755 "$dir"
  cat >"$dir/nfs.conf" <<EOF
[Unit]
RequiresMountsFor=${paths[*]}

[Service]
ReadWritePaths=${paths[*]}
EOF
}

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
    if [[ $STORAGE_SET -eq 0 ]]; then
      ask STORAGE_DRIVER "Image storage (local or nfs)" "$STORAGE_DRIVER"
    fi
    [[ "$STORAGE_DRIVER" == local || "$STORAGE_DRIVER" == nfs ]] ||
      die "--storage-driver must be local or nfs"
    if [[ "$STORAGE_DRIVER" == nfs ]]; then
      [[ -n "$NFS_IMAGE_DIR" ]] || ask NFS_IMAGE_DIR "Shared NFS image directory" "/srv/netlabor/images"
      [[ -n "$NFS_IMAGE_DIR" ]] || die "--nfs-image-dir is required with --storage-driver nfs"
    fi
  fi

  id -u netlabor-controller >/dev/null 2>&1 ||
    useradd --system --home /var/lib/netlabor --shell /usr/sbin/nologin netlabor-controller
  # The controller installs its own updates, so its service group writes the prefix.
  install -d -m 0775 -o root -g netlabor-controller "$PREFIX"
  # 0711: the emulator account only traverses this tree; it never lists it.
  install -d -m 0711 -o netlabor-controller -g netlabor-controller /var/lib/netlabor
  install -d -m 0755 -o netlabor-controller -g netlabor-controller /var/lib/netlabor/staging
  # Upgrades can leave staging files and subdirectories owned by root or by a
  # previous service user, which fail the next download with EACCES.
  chown -R netlabor-controller:netlabor-controller /var/lib/netlabor/staging
  install -m 0755 "$binary" "$PREFIX/netlabor-controller"

  if [[ $fresh -eq 0 ]]; then
    say "Keeping $ENV_DIR/controller.env"
    if [[ $STORAGE_SET -eq 1 ]]; then
      set_env "$ENV_DIR/controller.env" NB_STORAGE_DRIVER "$STORAGE_DRIVER"
      set_env "$ENV_DIR/controller.env" NB_NFS_IMAGE_DIR "$NFS_IMAGE_DIR"
    fi
    [[ -n "$TEMPLATE_DIR" ]] && set_env "$ENV_DIR/controller.env" NB_TEMPLATE_DIR "$TEMPLATE_DIR"
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
      echo "NB_STORAGE_DRIVER=$STORAGE_DRIVER"
      if [[ "$STORAGE_DRIVER" == nfs ]]; then
        echo "NB_NFS_IMAGE_DIR=$NFS_IMAGE_DIR"
      fi
      if [[ -n "$WEB_ROOT" ]]; then echo "NB_WEB_ROOT=$WEB_ROOT"; fi
      if [[ -n "$TEMPLATE_DIR" ]]; then echo "NB_TEMPLATE_DIR=$TEMPLATE_DIR"; fi
    } >"$ENV_DIR/controller.env"
    say "Wrote $ENV_DIR/controller.env"
  fi
  if [[ "$STORAGE_DRIVER" == nfs ]]; then
    # The head node owns the export directory; workers only mount it.
    install -d -m 0755 "$NFS_IMAGE_DIR"
    chown netlabor-controller:netlabor-controller "$NFS_IMAGE_DIR" 2>/dev/null || true
  fi
  write_nfs_override controller
}

# --- agent -----------------------------------------------------------------

install_nat_bridge() {
  [[ $SKIP_DEPS -eq 0 ]] && apt_install iptables dnsmasq >/dev/null || true
  local script=/usr/local/sbin/netlabor-nat-bridge
  install -d -m 0755 /usr/local/sbin
  if [[ -f scripts/provision-nat-bridge.sh ]]; then
    install -m 0755 scripts/provision-nat-bridge.sh "$script"
  else
    fetch "https://raw.githubusercontent.com/$REPO/${TAG:-main}/scripts/provision-nat-bridge.sh" "$script"
    chmod 0755 "$script"
  fi
  cat >/etc/systemd/system/netlabor-nat-bridge.service <<'UNIT'
[Unit]
Description=Netlabor NAT bridge (DHCP and masquerade for NAT nodes)
Documentation=https://github.com/nemvince/netlabor
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/sbin/netlabor-nat-bridge

[Install]
WantedBy=multi-user.target
UNIT
  say "Installing the NAT bridge service"
  if command -v systemctl >/dev/null 2>&1; then
    systemctl daemon-reload
    systemctl enable netlabor-nat-bridge >/dev/null 2>&1 || true
    systemctl restart netlabor-nat-bridge || die "the NAT bridge service failed (journalctl -u netlabor-nat-bridge)"
  else
    "$script" || die "the NAT bridge script failed"
  fi
}

# --- compute registration --------------------------------------------------

json_escape() {
  local value=${1//\\/\\\\}
  printf '%s' "${value//\"/\\\"}"
}

controller_base() {
  if [[ $INSTALL_CONTROLLER -eq 1 ]]; then
    printf 'http://127.0.0.1:%s' "${LISTEN##*:}"
  else
    printf '%s' "${CONTROLLER_URL%/}"
  fi
}

controller_healthy() {
  curl -fsS --max-time 2 "$1/healthz" >/dev/null 2>&1
}

start_controller_wait() { # <base-url>
  controller_healthy "$1" && return 0
  command -v systemctl >/dev/null 2>&1 || return 1
  say "Starting netlabor-controller"
  systemctl enable --now netlabor-controller >/dev/null 2>&1 || true
  local i
  for i in $(seq 1 30); do
    controller_healthy "$1" && return 0
    sleep 1
  done
  return 1
}

# Sets REG_TOKEN and REG_INDEX when the controller accepts the new compute.
register_compute() { # <base-url> <admin-user> <admin-password> <name> <agent-url> <underlay-host>
  local base=${1%/} cookie body
  cookie=$(curl -fsS -D - -o /dev/null -X POST "$base/rpc/auth/login" \
    -H 'content-type: application/json' \
    -d "{\"json\":{\"username\":\"$(json_escape "$2")\",\"password\":\"$(json_escape "$3")\"}}" 2>/dev/null |
    sed -n 's/^[Ss]et-[Cc]ookie: *\([^;]*\).*/\1/p' | tr -d '\r')
  [[ -n "$cookie" ]] || return 1
  body=$(curl -fsS -X POST "$base/rpc/computes/create" \
    -H 'content-type: application/json' -H "cookie: $cookie" \
    -d "{\"json\":{\"name\":\"$(json_escape "$4")\",\"url\":\"$(json_escape "$5")\",\"underlayHost\":\"$(json_escape "$6")\"}}" 2>/dev/null) || return 1
  REG_TOKEN=$(printf '%s' "$body" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
  REG_INDEX=$(printf '%s' "$body" | sed -n 's/.*"underlayIndex":\([0-9]*\).*/\1/p')
  [[ -n "$REG_TOKEN" ]]
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

  # mkdir -p keeps the owner the controller install set on the shared tree.
  install -d -m 0755 "$PREFIX" "$ENV_DIR"
  mkdir -p /var/lib/netlabor/images
  install -d -m 0700 /run/netlabor
  install -m 0755 "$binary" "$PREFIX/netlabor-agent"

  if [[ $fresh -eq 0 ]]; then
    say "Keeping $ENV_DIR/agent.env"
    if [[ $STORAGE_SET -eq 1 ]]; then
      set_env "$ENV_DIR/agent.env" NB_STORAGE_DRIVER "$STORAGE_DRIVER"
      set_env "$ENV_DIR/agent.env" NB_NFS_IMAGE_DIR "$NFS_IMAGE_DIR"
    fi
    [[ -n "$PROJECT_DIR" ]] && set_env "$ENV_DIR/agent.env" NB_PROJECT_DIR "$PROJECT_DIR"
  else
    local base="" agent_url="$AGENT_URL"
    [[ -n "$agent_url" ]] || agent_url="http://$(hostname -f 2>/dev/null || hostname):8081"
    [[ -n "$COMPUTE_NAME" ]] || COMPUTE_NAME=$(hostname -f 2>/dev/null || hostname)
    if [[ -z "$TOKEN" ]]; then
      base=$(controller_base)
      if [[ -z "$base" ]]; then
        ask CONTROLLER_URL "Controller URL" "http://$(hostname -f 2>/dev/null || hostname):8080"
        base=$(controller_base)
      fi
      ask COMPUTE_NAME "Compute name" "$COMPUTE_NAME"
      ask AGENT_URL "Agent URL reachable from the controller" "$agent_url"
      agent_url=$AGENT_URL
      [[ -n "$UNDERLAY_HOST" ]] || ask UNDERLAY_HOST "Controller underlay address" "$UNDERLAY_HOST"
      if [[ -z "$ADMIN_PASSWORD" && $INSTALL_CONTROLLER -eq 0 ]]; then
        ask_secret ADMIN_PASSWORD "Controller admin password (empty = register later in the UI)"
      fi
      if [[ -n "$ADMIN_PASSWORD" ]]; then
        # Plain-HTTP agents need this on the controller; it would be the same
        # setting an admin ticks in the UI for a manual registration.
        if [[ "$agent_url" == http://* && -f "$ENV_DIR/controller.env" ]] &&
          ! grep -q '^NB_ALLOW_INSECURE_AGENT=' "$ENV_DIR/controller.env"; then
          echo 'NB_ALLOW_INSECURE_AGENT=1' >>"$ENV_DIR/controller.env"
          say "Added NB_ALLOW_INSECURE_AGENT=1 to controller.env"
        fi
        if start_controller_wait "$base"; then
          if register_compute "$base" "$ADMIN_USER" "$ADMIN_PASSWORD" "$COMPUTE_NAME" "$agent_url" "$UNDERLAY_HOST"; then
            TOKEN=$REG_TOKEN
            [[ -n "$REG_INDEX" ]] && UNDERLAY_INDEX=$REG_INDEX
            say "Registered compute $COMPUTE_NAME (underlay index $UNDERLAY_INDEX)"
          else
            echo "warning: the controller refused the compute; register it in the UI and add the token" >&2
          fi
        else
          echo "warning: controller at $base is unreachable; register the compute in the UI" >&2
        fi
      else
        echo "note: no admin password; register the compute in the UI and put the token in agent.env" >&2
      fi
      [[ -n "$TOKEN" ]] || ask TOKEN "Compute token (empty = add it later)"
    fi
    if [[ -z "$REG_TOKEN" ]]; then
      ask UNDERLAY_INDEX "Underlay address index" "$UNDERLAY_INDEX"
    fi
    ask UNDERLAY_INTERFACE "Underlay interface" "$UNDERLAY_INTERFACE"
    if [[ $STORAGE_SET -eq 0 && $INSTALL_CONTROLLER -eq 0 ]]; then
      ask STORAGE_DRIVER "Image storage (local or nfs)" "$STORAGE_DRIVER"
    fi
    [[ "$STORAGE_DRIVER" == local || "$STORAGE_DRIVER" == nfs ]] ||
      die "--storage-driver must be local or nfs"
    if [[ "$STORAGE_DRIVER" == nfs ]]; then
      [[ -n "$NFS_IMAGE_DIR" ]] || ask NFS_IMAGE_DIR "Mounted NFS image directory" "/srv/netlabor/images"
      [[ -n "$NFS_IMAGE_DIR" ]] || die "--nfs-image-dir is required with --storage-driver nfs"
      mountpoint -q "$NFS_IMAGE_DIR" 2>/dev/null ||
        echo "warning: $NFS_IMAGE_DIR is not a mountpoint; the agent will refuse to start" >&2
    fi
    umask 077
    cat >"$ENV_DIR/agent.env" <<ENV
NB_AGENT_TOKEN=${TOKEN:-replace-with-compute-token}
NB_UNDERLAY_INDEX=$UNDERLAY_INDEX
NB_UNDERLAY_HOST=$UNDERLAY_HOST
NB_AGENT_LISTEN=0.0.0.0:8081
NB_STATE_DIR=/var/lib/netlabor
NB_PROJECT_DIR=${PROJECT_DIR:-/var/lib/netlabor/projects}
NB_RUN_DIR=/run/netlabor
NB_UBRIDGE_PATH=$(command -v ubridge 2>/dev/null || echo /usr/local/bin/ubridge)
NB_UNDERLAY_INTERFACE=$UNDERLAY_INTERFACE
NB_EMULATOR_UID=$(id -u netlabor-emu)
NB_EMULATOR_GID=$(id -g netlabor-emu)
NB_NAT_BRIDGE=nb-nat
NB_STORAGE_DRIVER=$STORAGE_DRIVER
NB_LOG_LEVEL=info
ENV
    if [[ "$STORAGE_DRIVER" == nfs ]]; then
      echo "NB_NFS_IMAGE_DIR=$NFS_IMAGE_DIR" >>"$ENV_DIR/agent.env"
    fi
    say "Wrote $ENV_DIR/agent.env"
    write_nfs_override agent
    if [[ -n "$REG_TOKEN" ]] && command -v systemctl >/dev/null 2>&1; then
      systemctl enable --now netlabor-agent >/dev/null 2>&1 && say "Started netlabor-agent"
    fi
  fi

  if [[ $WITH_NAT -eq 1 ]]; then install_nat_bridge; fi
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
RequiresMountsFor=/var/lib/netlabor

[Service]
Type=simple
User=netlabor-controller
Group=netlabor-controller
EnvironmentFile=/etc/netlabor/controller.env
ExecStart=/opt/netlabor/netlabor-controller
Restart=always
RestartSec=3
# No StateDirectory=: the agent shares /var/lib/netlabor, and systemd would
# recursively chown the whole tree (staging included) to the wrong user.
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
# No StateDirectory=: /var/lib/netlabor is shared with the controller, whose
# staging tree must keep its own owner. The installer creates the directories.
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
# Units first: registering a compute starts the controller it talks to.
write_units
command -v systemctl >/dev/null 2>&1 && systemctl daemon-reload || true
[[ $INSTALL_CONTROLLER -eq 1 ]] && install_controller
[[ $INSTALL_AGENT -eq 1 ]] && install_agent
# install_* may add the NFS drop-in after the first daemon-reload.
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
  if [[ $INSTALL_CONTROLLER -eq 0 && $INSTALL_AGENT -eq 1 && -z "$REG_TOKEN" ]]; then
    echo "  register this compute under Computes → Add compute in the controller, then put the token in $ENV_DIR/agent.env"
  fi
fi
