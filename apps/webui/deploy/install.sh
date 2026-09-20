#!/usr/bin/env bash
set -euo pipefail

RELEASE_TAG="${WEBUI_RELEASE_TAG:-@@SUDOWORK_WEBUI_RELEASE_TAG@@}"
DEFAULT_COS_ROOT="https://sudowork-release-1309794936.cos.accelerate.myqcloud.com/sudowork/webui"
DEFAULT_GITHUB_ROOT="https://github.com/sudoprivacy/sudowork/releases"
PROJECT_NAME="${WEBUI_COMPOSE_PROJECT:-sudowork-webui}"
NON_INTERACTIVE="${WEBUI_NON_INTERACTIVE:-0}"
SKIP_MOSS_CHECK="${WEBUI_SKIP_MOSS_CHECK:-0}"
UPGRADE_ONLY="${WEBUI_PROGRAM_UPGRADE:-0}"
INSTALLER_REFRESHED="${WEBUI_INSTALLER_REFRESHED:-0}"
OFFLINE=0
DOWNLOAD_ONLY=0
DOWNLOAD_DIR=""
DRY_RUN=0
INSTALL_DIR="${WEBUI_INSTALL_DIR:-}"
ENV_FILE="${WEBUI_ENV_FILE:-}"

PUBLIC_ORIGIN="${PUBLIC_ORIGIN:-}"
MOSS_BASE_URL="${MOSS_BASE_URL:-}"
MOSS_WS_BASE_URL="${MOSS_WS_BASE_URL:-}"
MOSS_ALLOWED_ORIGINS="${MOSS_ALLOWED_ORIGINS:-}"
MOSS_BASE_OVERRIDDEN=0
MOSS_WS_OVERRIDDEN=0
[ -z "$MOSS_BASE_URL" ] || MOSS_BASE_OVERRIDDEN=1
[ -z "$MOSS_WS_BASE_URL" ] || MOSS_WS_OVERRIDDEN=1
WEBUI_PORT="${WEBUI_PORT:-}"
TRUST_PROXY="${TRUST_PROXY:-}"
CSP_IMG_SRC_ORIGINS="${CSP_IMG_SRC_ORIGINS:-}"
POSTGRES_USER="${POSTGRES_USER:-}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-}"
POSTGRES_DB="${POSTGRES_DB:-}"
SESSION_HMAC_KEY="${SESSION_HMAC_KEY:-}"
TOKEN_AES_KEY="${TOKEN_AES_KEY:-}"

log() { printf '[webui-install] %s\n' "$*"; }
warn() { printf '[webui-install] WARNING: %s\n' "$*" >&2; }
die() { printf '[webui-install] ERROR: %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage: install.sh [options]

Installs the released Sudowork WebUI Docker images and starts WebUI with its
PostgreSQL database. Running the installed script again with --upgrade keeps
the existing configuration and database.

Options:
  --public-origin URL      Public HTTPS origin, for example https://webui.example.com.
  --moss-url URL           Moss HTTP(S) origin, for example http://10.0.1.206:43127.
  --moss-ws-url URL        Moss WS(S) origin. Inferred from --moss-url when omitted.
  --moss-allowed-origins LIST
                           Additional administrator-approved Moss origins, comma separated.
  --port PORT              Host port for WebUI (default: 26808).
  --install-dir PATH       Installation root (default: <install-user-home>/.sudowork/webui).
  --env-file PATH          Configuration file override (mainly for source deployments/tests).
  --offline                Read release files next to this script.
  --download PATH          Download files for a later offline installation.
  --upgrade                Upgrade an existing installation without changing user data.
  --non-interactive        Do not prompt; required values must come from flags or env.
  --skip-moss-check        Do not probe Moss before starting WebUI.
  --dry-run                Generate and validate configuration without running Docker.
  -h, --help               Show this help.

Configuration environment variables:
  PUBLIC_ORIGIN, MOSS_BASE_URL, MOSS_WS_BASE_URL, MOSS_ALLOWED_ORIGINS,
  WEBUI_PORT, TRUST_PROXY,
  CSP_IMG_SRC_ORIGINS, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB,
  SESSION_HMAC_KEY, TOKEN_AES_KEY, WEBUI_INSTALL_USER, WEBUI_INSTALL_DIR,
  WEBUI_DOWNLOAD_BASE, WEBUI_INSTALLER_URL.

Examples:
  curl -fsSL https://sudowork-release-1309794936.cos.accelerate.myqcloud.com/sudowork/webui/latest/install.sh | sudo bash

  curl -fsSL https://sudowork-release-1309794936.cos.accelerate.myqcloud.com/sudowork/webui/latest/install.sh | \
    sudo PUBLIC_ORIGIN=https://webui.example.com \
         MOSS_BASE_URL=http://10.0.1.206:43127 \
         bash -s -- --non-interactive
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --public-origin)
      [ "$#" -ge 2 ] || die '--public-origin requires a URL'
      PUBLIC_ORIGIN="$2"
      shift
      ;;
    --public-origin=*) PUBLIC_ORIGIN="${1#--public-origin=}" ;;
    --moss-url)
      [ "$#" -ge 2 ] || die '--moss-url requires a URL'
      MOSS_BASE_URL="$2"
      MOSS_BASE_OVERRIDDEN=1
      shift
      ;;
    --moss-url=*)
      MOSS_BASE_URL="${1#--moss-url=}"
      MOSS_BASE_OVERRIDDEN=1
      ;;
    --moss-ws-url)
      [ "$#" -ge 2 ] || die '--moss-ws-url requires a URL'
      MOSS_WS_BASE_URL="$2"
      MOSS_WS_OVERRIDDEN=1
      shift
      ;;
    --moss-ws-url=*)
      MOSS_WS_BASE_URL="${1#--moss-ws-url=}"
      MOSS_WS_OVERRIDDEN=1
      ;;
    --moss-allowed-origins)
      [ "$#" -ge 2 ] || die '--moss-allowed-origins requires a comma-separated list'
      MOSS_ALLOWED_ORIGINS="$2"
      shift
      ;;
    --moss-allowed-origins=*) MOSS_ALLOWED_ORIGINS="${1#--moss-allowed-origins=}" ;;
    --port)
      [ "$#" -ge 2 ] || die '--port requires a value'
      WEBUI_PORT="$2"
      shift
      ;;
    --port=*) WEBUI_PORT="${1#--port=}" ;;
    --install-dir)
      [ "$#" -ge 2 ] || die '--install-dir requires a path'
      INSTALL_DIR="$2"
      shift
      ;;
    --install-dir=*) INSTALL_DIR="${1#--install-dir=}" ;;
    --env-file)
      [ "$#" -ge 2 ] || die '--env-file requires a path'
      ENV_FILE="$2"
      shift
      ;;
    --env-file=*) ENV_FILE="${1#--env-file=}" ;;
    --offline) OFFLINE=1 ;;
    --download)
      [ "$#" -ge 2 ] || die '--download requires a path'
      DOWNLOAD_ONLY=1
      DOWNLOAD_DIR="$2"
      shift
      ;;
    --upgrade) UPGRADE_ONLY=1 ;;
    --non-interactive) NON_INTERACTIVE=1 ;;
    --skip-moss-check) SKIP_MOSS_CHECK=1 ;;
    --dry-run) DRY_RUN=1 ;;
    -h|--help)
      usage
      exit 0
      ;;
    *) die "unknown option: $1" ;;
  esac
  shift
done

[ "$OFFLINE" = 0 ] || [ "$DOWNLOAD_ONLY" = 0 ] \
  || die '--offline and --download cannot be used together'
[ "$UPGRADE_ONLY" = 0 ] || [ "$DOWNLOAD_ONLY" = 0 ] \
  || die '--upgrade and --download cannot be used together'

SOURCE_MODE=0
SOURCE_RELEASE_TAG_PLACEHOLDER='@@SUDOWORK_''WEBUI_RELEASE_TAG@@'
if [ "$RELEASE_TAG" = "$SOURCE_RELEASE_TAG_PLACEHOLDER" ]; then
  SOURCE_MODE=1
  VERSION=source
  IMAGE_VERSION=source
else
  case "$RELEASE_TAG" in
    v*) VERSION="${RELEASE_TAG#v}" ;;
    dev-*) VERSION="$RELEASE_TAG" ;;
    *) die "invalid WebUI release tag: $RELEASE_TAG" ;;
  esac
  IMAGE_VERSION="${VERSION//+/-}"
fi
case "$VERSION" in
  ''|*[!0-9A-Za-z._+-]*) die "invalid WebUI version: $VERSION" ;;
esac

ARCH=amd64
ARCHIVE="sudowork-webui-$VERSION-linux-$ARCH.tar.gz"
DEFAULT_DOWNLOAD_BASE="$DEFAULT_COS_ROOT/releases/$RELEASE_TAG"
GITHUB_DOWNLOAD_BASE="$DEFAULT_GITHUB_ROOT/download/$RELEASE_TAG"

checksum_command() {
  if command -v sha256sum >/dev/null 2>&1; then
    CHECKSUM_COMMAND=(sha256sum -c)
  elif command -v shasum >/dev/null 2>&1; then
    CHECKSUM_COMMAND=(shasum -a 256 -c)
  else
    die 'sha256sum or shasum is required'
  fi
}

download_asset() {
  local filename="$1" destination="$2" base='' part="${destination}.part"
  local bases=()
  if [ -n "${WEBUI_DOWNLOAD_BASE:-}" ]; then
    bases+=("${WEBUI_DOWNLOAD_BASE%/}")
  else
    bases+=("$DEFAULT_DOWNLOAD_BASE" "$GITHUB_DOWNLOAD_BASE")
  fi
  rm -f "$part"
  for base in "${bases[@]}"; do
    log "Downloading $filename from $base"
    if curl --fail --location --progress-bar --retry 3 --connect-timeout 20 \
      -o "$part" "$base/$filename"; then
      mv "$part" "$destination"
      return 0
    fi
  done
  rm -f "$part"
  die "could not download $filename"
}

verify_archive() {
  local directory="$1" checksum_file
  checksum_command
  [ -f "$directory/SHA256SUMS" ] || die 'missing release asset: SHA256SUMS'
  [ -f "$directory/$ARCHIVE" ] || die "missing release asset: $ARCHIVE"
  checksum_file="$(mktemp)"
  awk -v filename="$ARCHIVE" \
    '$2 == filename || $2 == "*" filename { print; found=1 } END { exit found ? 0 : 1 }' \
    "$directory/SHA256SUMS" > "$checksum_file" \
    || { rm -f "$checksum_file"; die "checksum manifest does not contain $ARCHIVE"; }
  (cd "$directory" && "${CHECKSUM_COMMAND[@]}" "$checksum_file")
  rm -f "$checksum_file"
}

if [ "$DOWNLOAD_ONLY" = 1 ]; then
  [ "$SOURCE_MODE" = 0 ] || die '--download requires a released install.sh'
  command -v curl >/dev/null 2>&1 || die 'curl is required'
  mkdir -p "$DOWNLOAD_DIR"
  DOWNLOAD_DIR="$(cd "$DOWNLOAD_DIR" && pwd)"
  download_asset install.sh "$DOWNLOAD_DIR/install.sh"
  download_asset SHA256SUMS "$DOWNLOAD_DIR/SHA256SUMS"
  download_asset "$ARCHIVE" "$DOWNLOAD_DIR/$ARCHIVE"
  verify_archive "$DOWNLOAD_DIR"
  EXPECTED_RELEASE_LINE="$(printf 'RELEASE_TAG="${WEBUI_RELEASE_TAG:-%s}"' "$RELEASE_TAG")"
  grep -Fq "$EXPECTED_RELEASE_LINE" "$DOWNLOAD_DIR/install.sh" \
    || die "downloaded install.sh does not match $RELEASE_TAG"
  chmod 755 "$DOWNLOAD_DIR/install.sh"
  log "Offline files are ready: $DOWNLOAD_DIR"
  log 'Copy this directory to the target server, then run: sudo ./install.sh --offline'
  exit 0
fi

INSTALL_USER="${WEBUI_INSTALL_USER:-${SUDO_USER:-$(id -un)}}"
if command -v getent >/dev/null 2>&1; then
  PASSWD_ENTRY="$(getent passwd "$INSTALL_USER" || true)"
  [ -n "$PASSWD_ENTRY" ] || die "install user does not exist: $INSTALL_USER"
  INSTALL_USER_HOME="$(printf '%s\n' "$PASSWD_ENTRY" | awk -F: 'NR == 1 { print $6 }')"
  INSTALL_USER_GROUP="$(id -gn "$INSTALL_USER")"
else
  INSTALL_USER_HOME="${HOME:-}"
  INSTALL_USER_GROUP="$(id -gn 2>/dev/null || id -g)"
fi
[ -n "$INSTALL_USER_HOME" ] || die "could not determine home directory for $INSTALL_USER"

SCRIPT_PATH="${BASH_SOURCE[0]:-}"
if [ -n "$SCRIPT_PATH" ] && [ -f "$SCRIPT_PATH" ]; then
  SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"
else
  SCRIPT_DIR=""
fi

if [ "$SOURCE_MODE" = 1 ]; then
  [ -n "$SCRIPT_DIR" ] || die 'source deployment must run from deploy/install.sh'
  APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
  COMPOSE_FILE="$APP_DIR/docker-compose.yml"
  INSTALL_DIR="${INSTALL_DIR:-$APP_DIR}"
  ENV_FILE="${ENV_FILE:-$APP_DIR/.env.deploy}"
  [ -f "$COMPOSE_FILE" ] || die "docker-compose.yml not found: $COMPOSE_FILE"
else
  INSTALL_DIR="${INSTALL_DIR:-${INSTALL_USER_HOME%/}/.sudowork/webui}"
  case "$INSTALL_DIR" in
    /*) ;;
    *) die 'install directory must be an absolute path' ;;
  esac
  case "$INSTALL_DIR" in
    *[[:space:]]*) die 'install directory must not contain whitespace' ;;
  esac
  [ "$INSTALL_DIR" != / ] || die 'refusing to install into /'
  if [ "$DRY_RUN" != 1 ] && [ -n "$ENV_FILE" ] && [ "$ENV_FILE" != "$INSTALL_DIR/.env" ]; then
    die 'released installations keep configuration at <install-dir>/.env'
  fi
  ENV_FILE="${ENV_FILE:-$INSTALL_DIR/.env}"
  COMPOSE_FILE="$INSTALL_DIR/docker-compose.yml"
fi

if [ "$DRY_RUN" != 1 ]; then
  if [ "$SOURCE_MODE" = 0 ]; then
    [ "$(id -u)" -eq 0 ] || die 'run as root (for example: curl ... | sudo bash)'
    [ "$(uname -s)" = Linux ] || die 'only Linux is supported by release packages'
    case "$(uname -m)" in
      x86_64|amd64) ;;
      *) die 'only x86_64/amd64 is supported by this release package' ;;
    esac
    command -v gzip >/dev/null 2>&1 || die 'gzip is required'
    command -v install >/dev/null 2>&1 || die 'install is required'
  fi
  command -v docker >/dev/null 2>&1 || die 'Docker 20.10 or newer is required'
  docker compose version >/dev/null 2>&1 || die 'Docker Compose v2 is required'
  docker info >/dev/null 2>&1 || die 'Docker daemon is not available'
fi

if [ "$UPGRADE_ONLY" = 1 ] && [ "$SOURCE_MODE" = 0 ] && [ "$OFFLINE" = 0 ] \
  && [ "$INSTALLER_REFRESHED" != 1 ] && [ "$DRY_RUN" != 1 ]; then
  [ -f "$ENV_FILE" ] || die "no existing WebUI installation found in $INSTALL_DIR"
  command -v curl >/dev/null 2>&1 || die 'curl is required'
  LATEST_INSTALLER="$(mktemp)"
  LATEST_INSTALLER_URL="${WEBUI_INSTALLER_URL:-$DEFAULT_COS_ROOT/latest/install.sh}"
  log 'Downloading latest installer'
  if ! curl --fail --location --progress-bar --retry 3 --connect-timeout 20 \
    -o "$LATEST_INSTALLER" "$LATEST_INSTALLER_URL"; then
    warn 'COS installer download failed; trying GitHub Releases'
    curl --fail --location --progress-bar --retry 3 --connect-timeout 20 \
      -o "$LATEST_INSTALLER" "$DEFAULT_GITHUB_ROOT/latest/download/install.sh" \
      || { rm -f "$LATEST_INSTALLER"; die 'could not download latest installer'; }
  fi
  chmod 755 "$LATEST_INSTALLER"
  set +e
  WEBUI_PROGRAM_UPGRADE=1 WEBUI_INSTALLER_REFRESHED=1 \
    WEBUI_RELEASE_TAG= \
    WEBUI_INSTALL_USER="$INSTALL_USER" WEBUI_INSTALL_DIR="$INSTALL_DIR" \
    WEBUI_NON_INTERACTIVE=1 WEBUI_SKIP_MOSS_CHECK="$SKIP_MOSS_CHECK" \
    bash "$LATEST_INSTALLER"
  UPGRADE_STATUS=$?
  set -e
  rm -f "$LATEST_INSTALLER"
  exit "$UPGRADE_STATUS"
fi

UPGRADE_BACKUP_DIR=""
if [ "$SOURCE_MODE" = 0 ] && [ "$DRY_RUN" != 1 ] \
  && [ -f "$ENV_FILE" ] && [ -f "$COMPOSE_FILE" ]; then
  UPGRADE_BACKUP_DIR="$INSTALL_DIR/backups/$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$UPGRADE_BACKUP_DIR"
  cp "$ENV_FILE" "$UPGRADE_BACKUP_DIR/.env"
  cp "$COMPOSE_FILE" "$UPGRADE_BACKUP_DIR/docker-compose.yml"
  [ ! -f "$INSTALL_DIR/release-tag" ] \
    || cp "$INSTALL_DIR/release-tag" "$UPGRADE_BACKUP_DIR/release-tag"

  OLD_COMPOSE=(docker compose --project-name "$PROJECT_NAME" \
    --project-directory "$INSTALL_DIR" --env-file "$UPGRADE_BACKUP_DIR/.env" \
    -f "$COMPOSE_FILE")
  log "Backing up WebUI database to $UPGRADE_BACKUP_DIR/database.dump"
  "${OLD_COMPOSE[@]}" up -d postgres
  DATABASE_READY=0
  for _attempt in $(seq 1 30); do
    if "${OLD_COMPOSE[@]}" exec -T postgres sh -c \
      'pg_isready --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"' >/dev/null 2>&1; then
      DATABASE_READY=1
      break
    fi
    sleep 2
  done
  [ "$DATABASE_READY" = 1 ] \
    || die 'database did not become ready; the existing installation was not upgraded'
  if ! "${OLD_COMPOSE[@]}" exec -T postgres sh -c \
    'pg_dump --format=custom --username="$POSTGRES_USER" "$POSTGRES_DB"' \
    > "$UPGRADE_BACKUP_DIR/database.dump.part"; then
    rm -rf "$UPGRADE_BACKUP_DIR"
    die 'database backup failed; the existing installation was not upgraded'
  fi
  if [ ! -s "$UPGRADE_BACKUP_DIR/database.dump.part" ]; then
    rm -rf "$UPGRADE_BACKUP_DIR"
    die 'database backup was empty; the existing installation was not upgraded'
  fi
  mv "$UPGRADE_BACKUP_DIR/database.dump.part" "$UPGRADE_BACKUP_DIR/database.dump"
  chmod 600 "$UPGRADE_BACKUP_DIR/.env" "$UPGRADE_BACKUP_DIR/database.dump"
fi

read_env_value() {
  local key="$1"
  [ -f "$ENV_FILE" ] || return 0
  awk -v prefix="$key=" \
    'index($0, prefix) == 1 { value = substr($0, length(prefix) + 1) } END { print value }' \
    "$ENV_FILE"
}

load_existing_value() {
  local variable="$1" existing=''
  [ -z "${!variable:-}" ] || return 0
  existing="$(read_env_value "$variable")"
  [ -z "$existing" ] || printf -v "$variable" '%s' "$existing"
}

for variable in \
  PUBLIC_ORIGIN MOSS_BASE_URL MOSS_WS_BASE_URL MOSS_ALLOWED_ORIGINS WEBUI_PORT TRUST_PROXY \
  CSP_IMG_SRC_ORIGINS POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB \
  SESSION_HMAC_KEY TOKEN_AES_KEY; do
  if [ "$variable" = MOSS_WS_BASE_URL ] && [ "$MOSS_BASE_OVERRIDDEN" = 1 ] \
    && [ "$MOSS_WS_OVERRIDDEN" = 0 ]; then
    continue
  fi
  load_existing_value "$variable"
done

prompt_required() {
  local variable="$1" label="$2" answer=''
  [ -z "${!variable:-}" ] || return 0
  [ "$NON_INTERACTIVE" != 1 ] || die "$variable is required in non-interactive mode"
  [ -r /dev/tty ] || die "$variable is required and no interactive terminal is available"
  printf '%s: ' "$label" > /dev/tty
  IFS= read -r answer < /dev/tty || true
  [ -n "$answer" ] || die "$variable is required"
  printf -v "$variable" '%s' "$answer"
}

prompt_required PUBLIC_ORIGIN 'Public HTTPS origin (for example https://webui.example.com)'
prompt_required MOSS_BASE_URL 'Moss URL advertised by Moss (for example http://10.0.1.206:43127)'

PUBLIC_ORIGIN="${PUBLIC_ORIGIN%/}"
MOSS_BASE_URL="${MOSS_BASE_URL%/}"
if [ -z "$MOSS_WS_BASE_URL" ]; then
  case "$MOSS_BASE_URL" in
    https://*) MOSS_WS_BASE_URL="wss://${MOSS_BASE_URL#https://}" ;;
    http://*) MOSS_WS_BASE_URL="ws://${MOSS_BASE_URL#http://}" ;;
    *) die 'MOSS_BASE_URL must start with http:// or https://' ;;
  esac
fi
MOSS_WS_BASE_URL="${MOSS_WS_BASE_URL%/}"

WEBUI_PORT="${WEBUI_PORT:-26808}"
TRUST_PROXY="${TRUST_PROXY:-true}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-sudowork_webui}"
CSP_IMG_SRC_ORIGINS="${CSP_IMG_SRC_ORIGINS:-https://sudowork-hub-1309794936.cos.ap-beijing.myqcloud.com,https://sudoworkhub-1309794936.cos.ap-beijing.myqcloud.com}"

generate_hex() {
  local byte_count="$1"
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$byte_count"
    return
  fi
  command -v od >/dev/null 2>&1 || die 'openssl or od is required to generate secrets'
  od -An -N "$byte_count" -tx1 /dev/urandom | tr -d ' \n'
}

POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$(generate_hex 24)}"
SESSION_HMAC_KEY="${SESSION_HMAC_KEY:-$(generate_hex 32)}"
TOKEN_AES_KEY="${TOKEN_AES_KEY:-$(generate_hex 32)}"

validate_origin() {
  local label="$1" value="$2" allowed="$3" remainder authority
  case "$allowed:$value" in
    https:https://*) ;;
    http:https://*|http:http://*) ;;
    ws:wss://*|ws:ws://*) ;;
    *) die "$label has an unsupported scheme: $value" ;;
  esac
  remainder="${value#*://}"
  authority="${remainder%%/*}"
  [ -n "$authority" ] || die "$label must include a host"
  [ "$remainder" = "$authority" ] || die "$label must be an origin without a path: $value"
  case "$authority" in
    *'?'*|*'#'*) die "$label must be an origin without a query or fragment: $value" ;;
    *'@'*) die "$label must not include credentials" ;;
    *[[:space:]]*) die "$label must not contain whitespace" ;;
  esac
}

url_authority() {
  local value="${1#*://}"
  printf '%s' "${value%%/*}"
}

validate_origin PUBLIC_ORIGIN "$PUBLIC_ORIGIN" https
validate_origin MOSS_BASE_URL "$MOSS_BASE_URL" http
validate_origin MOSS_WS_BASE_URL "$MOSS_WS_BASE_URL" ws
[ "$(url_authority "$MOSS_BASE_URL")" = "$(url_authority "$MOSS_WS_BASE_URL")" ] \
  || die 'MOSS_BASE_URL and MOSS_WS_BASE_URL must use the same host and port'
if [ -n "$MOSS_ALLOWED_ORIGINS" ]; then
  OLD_IFS="$IFS"
  IFS=','
  for origin in $MOSS_ALLOWED_ORIGINS; do
    [ -n "$origin" ] || die 'MOSS_ALLOWED_ORIGINS must not contain empty entries'
    validate_origin MOSS_ALLOWED_ORIGINS "$origin" http
  done
  IFS="$OLD_IFS"
fi

case "$WEBUI_PORT" in
  ''|*[!0-9]*) die 'WEBUI_PORT must be an integer between 1 and 65535' ;;
esac
[ "$WEBUI_PORT" -ge 1 ] && [ "$WEBUI_PORT" -le 65535 ] \
  || die 'WEBUI_PORT must be an integer between 1 and 65535'
case "$TRUST_PROXY" in
  true|false|1|0) ;;
  *) die 'TRUST_PROXY must be true, false, 1, or 0' ;;
esac
case "$POSTGRES_USER" in
  ''|*[!A-Za-z0-9_]*) die 'POSTGRES_USER may only use letters, digits, and _' ;;
esac
case "$POSTGRES_DB" in
  ''|*[!A-Za-z0-9_]*) die 'POSTGRES_DB may only use letters, digits, and _' ;;
esac
case "$POSTGRES_PASSWORD" in
  ''|*[!A-Za-z0-9._~-]*) die 'POSTGRES_PASSWORD may only use letters, digits, _, ., ~, and -' ;;
esac
for variable in \
  PUBLIC_ORIGIN MOSS_BASE_URL MOSS_WS_BASE_URL MOSS_ALLOWED_ORIGINS CSP_IMG_SRC_ORIGINS \
  SESSION_HMAC_KEY TOKEN_AES_KEY; do
  value="${!variable}"
  case "$value" in
    *$'\n'*|*$'\r'*) die "$variable must not contain newlines" ;;
  esac
done

mkdir -p "$(dirname "$ENV_FILE")"
umask 077
TEMP_ENV="$(mktemp "${ENV_FILE}.tmp.XXXXXX")"
trap 'rm -f "$TEMP_ENV"' EXIT
{
  printf 'POSTGRES_USER=%s\n' "$POSTGRES_USER"
  printf 'POSTGRES_PASSWORD=%s\n' "$POSTGRES_PASSWORD"
  printf 'POSTGRES_DB=%s\n' "$POSTGRES_DB"
  printf 'SESSION_HMAC_KEY=%s\n' "$SESSION_HMAC_KEY"
  printf 'TOKEN_AES_KEY=%s\n' "$TOKEN_AES_KEY"
  printf 'PUBLIC_ORIGIN=%s\n' "$PUBLIC_ORIGIN"
  printf 'TRUST_PROXY=%s\n' "$TRUST_PROXY"
  printf 'MOSS_BASE_URL=%s\n' "$MOSS_BASE_URL"
  printf 'MOSS_WS_BASE_URL=%s\n' "$MOSS_WS_BASE_URL"
  printf 'MOSS_ALLOWED_ORIGINS=%s\n' "$MOSS_ALLOWED_ORIGINS"
  printf 'CSP_IMG_SRC_ORIGINS=%s\n' "$CSP_IMG_SRC_ORIGINS"
  printf 'WEBUI_PORT=%s\n' "$WEBUI_PORT"
} > "$TEMP_ENV"
chmod 600 "$TEMP_ENV"
mv "$TEMP_ENV" "$ENV_FILE"
trap - EXIT
log "Deployment configuration ready: $ENV_FILE"

write_release_compose() {
  local temporary
  mkdir -p "$INSTALL_DIR/data/postgres" "$INSTALL_DIR/packages"
  temporary="$(mktemp "$INSTALL_DIR/docker-compose.yml.tmp.XXXXXX")"
  cat > "$temporary" <<'EOF'
services:
  postgres:
    image: postgres:16-alpine
    pull_policy: never
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    volumes:
      - ./data/postgres:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}']
      interval: 5s
      timeout: 3s
      retries: 20
    restart: unless-stopped

  migrate:
    image: sudowork-webui:@@WEBUI_IMAGE_VERSION@@
    pull_policy: never
    command: ['node', 'dist/server/migrate.js']
    environment: &webui-env
      DATABASE_URL: postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
      SESSION_HMAC_KEY: ${SESSION_HMAC_KEY}
      TOKEN_AES_KEY: ${TOKEN_AES_KEY}
      PUBLIC_ORIGIN: ${PUBLIC_ORIGIN}
      TRUST_PROXY: ${TRUST_PROXY}
      MOSS_BASE_URL: ${MOSS_BASE_URL}
      MOSS_WS_BASE_URL: ${MOSS_WS_BASE_URL}
      MOSS_ALLOWED_ORIGINS: ${MOSS_ALLOWED_ORIGINS}
      PORT: '26808'
      NODE_ENV: production
    depends_on:
      postgres:
        condition: service_healthy
    restart: 'no'

  webui:
    image: sudowork-webui:@@WEBUI_IMAGE_VERSION@@
    pull_policy: never
    environment:
      <<: *webui-env
      CSP_IMG_SRC_ORIGINS: ${CSP_IMG_SRC_ORIGINS}
    ports:
      - '${WEBUI_PORT}:26808'
    depends_on:
      postgres:
        condition: service_healthy
      migrate:
        condition: service_completed_successfully
    healthcheck:
      test: ['CMD-SHELL', 'node -e "require(''http'').get(''http://127.0.0.1:26808/health/live'',r=>process.exit(r.statusCode===200?0:1)).on(''error'',()=>process.exit(1))"']
      interval: 10s
      timeout: 5s
      retries: 12
    restart: unless-stopped
EOF
  sed "s/@@WEBUI_IMAGE_VERSION@@/$IMAGE_VERSION/g" "$temporary" > "$COMPOSE_FILE"
  rm -f "$temporary"
  chmod 644 "$COMPOSE_FILE"
}

PREVIOUS_COMPOSE=""
if [ "$SOURCE_MODE" = 0 ]; then
  if [ "$DRY_RUN" = 1 ]; then
    write_release_compose
  elif [ -f "$COMPOSE_FILE" ]; then
    PREVIOUS_COMPOSE="$(mktemp)"
    cp "$COMPOSE_FILE" "$PREVIOUS_COMPOSE"
  fi
fi
trap 'rm -f "${PREVIOUS_COMPOSE:-}"' EXIT

COMPOSE=(docker compose --project-name "$PROJECT_NAME" --project-directory "$INSTALL_DIR" --env-file "$ENV_FILE" -f "$COMPOSE_FILE")

if [ "$DRY_RUN" = 1 ]; then
  log 'Dry run complete; Docker was not invoked'
  if [ "$SOURCE_MODE" = 1 ]; then
    log "Run: docker compose --project-name $PROJECT_NAME --env-file $ENV_FILE -f $COMPOSE_FILE up -d --build"
  else
    log "Release compose file ready: $COMPOSE_FILE"
  fi
  exit 0
fi

if [ "$SKIP_MOSS_CHECK" != 1 ]; then
  if command -v curl >/dev/null 2>&1; then
    log "Checking Moss Server: $MOSS_BASE_URL"
    curl --fail --silent --show-error --location --connect-timeout 5 --max-time 15 \
      --output /dev/null "$MOSS_BASE_URL/api/v1/system-config" \
      || die 'Moss Server is not reachable; verify its advertised URL or use --skip-moss-check'
  else
    warn 'curl is unavailable; skipping the Moss connectivity check'
  fi
fi

if [ "$SOURCE_MODE" = 0 ]; then
  if [ "$OFFLINE" = 1 ]; then
    [ -n "$SCRIPT_DIR" ] || die '--offline must be run from an install.sh file'
    SOURCE_DIR="$SCRIPT_DIR"
  else
    command -v curl >/dev/null 2>&1 || die 'curl is required'
    SOURCE_DIR="$INSTALL_DIR/packages/$RELEASE_TAG"
    mkdir -p "$SOURCE_DIR"
    download_asset install.sh "$SOURCE_DIR/install.sh"
    download_asset SHA256SUMS "$SOURCE_DIR/SHA256SUMS"
    download_asset "$ARCHIVE" "$SOURCE_DIR/$ARCHIVE"
  fi
  verify_archive "$SOURCE_DIR"
  EXPECTED_RELEASE_LINE="$(printf 'RELEASE_TAG="${WEBUI_RELEASE_TAG:-%s}"' "$RELEASE_TAG")"
  grep -Fq "$EXPECTED_RELEASE_LINE" "$SOURCE_DIR/install.sh" \
    || die "install.sh does not match $RELEASE_TAG"

  log "Loading WebUI and PostgreSQL images from $ARCHIVE"
  gzip -dc "$SOURCE_DIR/$ARCHIVE" | docker load
  docker image inspect "sudowork-webui:$IMAGE_VERSION" >/dev/null \
    || die "release archive does not contain sudowork-webui:$IMAGE_VERSION"
  docker image inspect postgres:16-alpine >/dev/null \
    || die 'release archive does not contain postgres:16-alpine'

  write_release_compose
fi

write_helper_scripts() {
  cat > "$INSTALL_DIR/start.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec docker compose --project-name sudowork-webui --project-directory "$INSTALL_DIR" \
  --env-file "$INSTALL_DIR/.env" -f "$INSTALL_DIR/docker-compose.yml" up -d
EOF
  cat > "$INSTALL_DIR/stop.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec docker compose --project-name sudowork-webui --project-directory "$INSTALL_DIR" \
  --env-file "$INSTALL_DIR/.env" -f "$INSTALL_DIR/docker-compose.yml" down
EOF
  cat > "$INSTALL_DIR/status.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
docker compose --project-name sudowork-webui --project-directory "$INSTALL_DIR" \
  --env-file "$INSTALL_DIR/.env" -f "$INSTALL_DIR/docker-compose.yml" ps
EOF
  cat > "$INSTALL_DIR/backup.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="${1:-$INSTALL_DIR/backups/$(date -u +%Y%m%dT%H%M%SZ)}"
mkdir -p "$BACKUP_DIR"
cp "$INSTALL_DIR/.env" "$BACKUP_DIR/.env"
cp "$INSTALL_DIR/docker-compose.yml" "$BACKUP_DIR/docker-compose.yml"
[ ! -f "$INSTALL_DIR/release-tag" ] || cp "$INSTALL_DIR/release-tag" "$BACKUP_DIR/release-tag"
COMPOSE=(docker compose --project-name sudowork-webui --project-directory "$INSTALL_DIR" \
  --env-file "$INSTALL_DIR/.env" -f "$INSTALL_DIR/docker-compose.yml")
"${COMPOSE[@]}" up -d postgres
for _attempt in $(seq 1 30); do
  if "${COMPOSE[@]}" exec -T postgres sh -c \
    'pg_isready --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"' >/dev/null 2>&1; then
    break
  fi
  [ "$_attempt" -lt 30 ] || { printf '[webui-backup] PostgreSQL is not ready\n' >&2; exit 1; }
  sleep 2
done
trap 'rm -f "$BACKUP_DIR/database.dump.part"' EXIT
"${COMPOSE[@]}" exec -T postgres sh -c \
  'pg_dump --format=custom --username="$POSTGRES_USER" "$POSTGRES_DB"' \
  > "$BACKUP_DIR/database.dump.part"
[ -s "$BACKUP_DIR/database.dump.part" ] \
  || { printf '[webui-backup] Database backup was empty\n' >&2; exit 1; }
mv "$BACKUP_DIR/database.dump.part" "$BACKUP_DIR/database.dump"
trap - EXIT
chmod 600 "$BACKUP_DIR/.env" "$BACKUP_DIR/database.dump"
printf '[webui-backup] Backup ready: %s\n' "$BACKUP_DIR"
EOF
  cat > "$INSTALL_DIR/restore.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="${1:?usage: restore.sh BACKUP_DIR}"
for file in .env docker-compose.yml database.dump; do
  [ -f "$BACKUP_DIR/$file" ] || { printf '[webui-restore] Missing %s\n' "$BACKUP_DIR/$file" >&2; exit 1; }
done
CURRENT_COMPOSE=(docker compose --project-name sudowork-webui --project-directory "$INSTALL_DIR" \
  --env-file "$INSTALL_DIR/.env" -f "$INSTALL_DIR/docker-compose.yml")
"${CURRENT_COMPOSE[@]}" stop webui migrate >/dev/null 2>&1 || true
cp "$BACKUP_DIR/.env" "$INSTALL_DIR/.env"
cp "$BACKUP_DIR/docker-compose.yml" "$INSTALL_DIR/docker-compose.yml"
[ ! -f "$BACKUP_DIR/release-tag" ] || cp "$BACKUP_DIR/release-tag" "$INSTALL_DIR/release-tag"
COMPOSE=(docker compose --project-name sudowork-webui --project-directory "$INSTALL_DIR" \
  --env-file "$INSTALL_DIR/.env" -f "$INSTALL_DIR/docker-compose.yml")
"${COMPOSE[@]}" up -d postgres
for _attempt in $(seq 1 30); do
  if "${COMPOSE[@]}" exec -T postgres sh -c \
    'pg_isready --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"' >/dev/null 2>&1; then
    break
  fi
  [ "$_attempt" -lt 30 ] || { printf '[webui-restore] PostgreSQL is not ready\n' >&2; exit 1; }
  sleep 2
done
"${COMPOSE[@]}" exec -T postgres sh -c \
  'psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --set=ON_ERROR_STOP=1 --command="DROP SCHEMA public CASCADE; CREATE SCHEMA public"'
"${COMPOSE[@]}" exec -T postgres sh -c \
  'pg_restore --no-owner --exit-on-error --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"' \
  < "$BACKUP_DIR/database.dump"
"${COMPOSE[@]}" up -d
printf '[webui-restore] Restored backup: %s\n' "$BACKUP_DIR"
EOF
  cat > "$INSTALL_DIR/uninstall.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
docker compose --project-name sudowork-webui --project-directory "$INSTALL_DIR" \
  --env-file "$INSTALL_DIR/.env" -f "$INSTALL_DIR/docker-compose.yml" down || true
if [ "${1:-}" = --purge ]; then
  rm -rf "$INSTALL_DIR/data" "$INSTALL_DIR/packages"
  rm -f "$INSTALL_DIR/.env" "$INSTALL_DIR/docker-compose.yml" "$INSTALL_DIR/release-tag" \
    "$INSTALL_DIR/install.sh" "$INSTALL_DIR/start.sh" "$INSTALL_DIR/stop.sh" \
    "$INSTALL_DIR/status.sh" "$INSTALL_DIR/backup.sh" "$INSTALL_DIR/restore.sh" \
    "$INSTALL_DIR/uninstall.sh"
  printf '[webui-uninstall] WebUI and its local data were removed.\n'
else
  printf '[webui-uninstall] WebUI stopped. Configuration and database were preserved.\n'
  printf '[webui-uninstall] Run sudo %s/uninstall.sh --purge to remove local data.\n' "$INSTALL_DIR"
fi
EOF
  chmod 755 "$INSTALL_DIR/start.sh" "$INSTALL_DIR/stop.sh" \
    "$INSTALL_DIR/status.sh" "$INSTALL_DIR/backup.sh" "$INSTALL_DIR/restore.sh" \
    "$INSTALL_DIR/uninstall.sh"
}

if [ "$SOURCE_MODE" = 0 ]; then
  write_helper_scripts
fi

rollback_release() {
  [ "$SOURCE_MODE" = 0 ] || return 0
  if [ -n "$UPGRADE_BACKUP_DIR" ] && [ -f "$UPGRADE_BACKUP_DIR/database.dump" ]; then
    warn "Restoring configuration and database from $UPGRADE_BACKUP_DIR"
    "${COMPOSE[@]}" stop webui migrate >/dev/null 2>&1 || true
    cp "$UPGRADE_BACKUP_DIR/.env" "$ENV_FILE"
    cp "$UPGRADE_BACKUP_DIR/docker-compose.yml" "$COMPOSE_FILE"
    [ ! -f "$UPGRADE_BACKUP_DIR/release-tag" ] \
      || cp "$UPGRADE_BACKUP_DIR/release-tag" "$INSTALL_DIR/release-tag"
    "${COMPOSE[@]}" up -d postgres >/dev/null 2>&1 || true
    DATABASE_READY=0
    for _attempt in $(seq 1 30); do
      if "${COMPOSE[@]}" exec -T postgres sh -c \
        'pg_isready --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"' >/dev/null 2>&1; then
        DATABASE_READY=1
        break
      fi
      sleep 2
    done
    if [ "$DATABASE_READY" != 1 ]; then
      warn 'PostgreSQL did not become ready during rollback; use restore.sh manually'
      return 0
    fi
    if ! "${COMPOSE[@]}" exec -T postgres sh -c \
      'psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --set=ON_ERROR_STOP=1 --command="DROP SCHEMA public CASCADE; CREATE SCHEMA public"' \
      >/dev/null 2>&1; then
      warn 'Could not reset the database schema during rollback; use restore.sh manually'
      return 0
    fi
    if ! "${COMPOSE[@]}" exec -T postgres sh -c \
      'pg_restore --no-owner --exit-on-error --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"' \
      < "$UPGRADE_BACKUP_DIR/database.dump" >/dev/null 2>&1; then
      warn 'Could not restore the database backup; use restore.sh manually'
      return 0
    fi
    "${COMPOSE[@]}" up -d >/dev/null 2>&1 || true
  elif [ -n "$PREVIOUS_COMPOSE" ] && [ -f "$PREVIOUS_COMPOSE" ]; then
    warn 'Restoring the previous Compose definition'
    cp "$PREVIOUS_COMPOSE" "$COMPOSE_FILE"
    "${COMPOSE[@]}" up -d >/dev/null 2>&1 || true
  else
    "${COMPOSE[@]}" down >/dev/null 2>&1 || true
  fi
}

log 'Starting PostgreSQL, database migration, and WebUI'
if [ "$SOURCE_MODE" = 1 ]; then
  "${COMPOSE[@]}" up -d --build
elif ! "${COMPOSE[@]}" up -d; then
  rollback_release
  die 'Docker Compose failed to start WebUI'
fi

log 'Waiting for WebUI health check'
for _attempt in $(seq 1 60); do
  container_id="$("${COMPOSE[@]}" ps -q webui)"
  if [ -n "$container_id" ]; then
    health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || true)"
    if [ "$health" = healthy ]; then
      if [ "$SOURCE_MODE" = 0 ]; then
        if [ "$(cd "$(dirname "$SOURCE_DIR/install.sh")" && pwd)/$(basename "$SOURCE_DIR/install.sh")" \
          != "$(cd "$INSTALL_DIR" && pwd)/install.sh" ]; then
          install -m 755 "$SOURCE_DIR/install.sh" "$INSTALL_DIR/install.sh"
        else
          chmod 755 "$INSTALL_DIR/install.sh"
        fi
        printf '%s\n' "$RELEASE_TAG" > "$INSTALL_DIR/release-tag"
        chmod 644 "$INSTALL_DIR/release-tag"
        rm -f "$PREVIOUS_COMPOSE"
        if [ -n "$UPGRADE_BACKUP_DIR" ]; then
          ls -1dt "$INSTALL_DIR"/backups/* 2>/dev/null \
            | tail -n +6 \
            | while IFS= read -r old_backup; do rm -rf "$old_backup"; done
        fi
        chown -R "$INSTALL_USER:$INSTALL_USER_GROUP" \
          "$INSTALL_DIR/.env" "$INSTALL_DIR/docker-compose.yml" "$INSTALL_DIR/install.sh" \
          "$INSTALL_DIR/release-tag" "$INSTALL_DIR/packages" "$INSTALL_DIR/backups" \
          "$INSTALL_DIR/start.sh" "$INSTALL_DIR/stop.sh" "$INSTALL_DIR/status.sh" \
          "$INSTALL_DIR/backup.sh" "$INSTALL_DIR/restore.sh" "$INSTALL_DIR/uninstall.sh" \
          2>/dev/null || true
      fi
      log "Sudowork WebUI is ready: $PUBLIC_ORIGIN"
      if [ "$SOURCE_MODE" = 0 ]; then
        log "Status: sudo $INSTALL_DIR/status.sh"
        log "Upgrade: sudo $INSTALL_DIR/install.sh --upgrade"
        log "Stop: sudo $INSTALL_DIR/stop.sh"
        log "Backup: sudo $INSTALL_DIR/backup.sh"
        log "Restore: sudo $INSTALL_DIR/restore.sh $INSTALL_DIR/backups/<timestamp>"
        log "Uninstall: sudo $INSTALL_DIR/uninstall.sh"
      else
        log "Status: docker compose --project-name $PROJECT_NAME --env-file $ENV_FILE -f $COMPOSE_FILE ps"
        log "Stop: docker compose --project-name $PROJECT_NAME --env-file $ENV_FILE -f $COMPOSE_FILE down"
      fi
      exit 0
    fi
    [ "$health" != unhealthy ] || break
  fi
  sleep 2
done

"${COMPOSE[@]}" ps >&2 || true
"${COMPOSE[@]}" logs --tail=100 webui >&2 || true
rollback_release
rm -f "$PREVIOUS_COMPOSE"
die 'WebUI did not become healthy within 120 seconds'
