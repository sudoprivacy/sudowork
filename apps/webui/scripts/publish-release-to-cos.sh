#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: publish-release-to-cos.sh ASSETS_DIR RELEASE_TAG [mode]

Modes:
  --release-only   Upload and verify immutable release assets.
  --latest-only    Verify release assets, then publish latest/install.sh.
  --all            Run both phases (default).
EOF
}

if [ "${1:-}" = -h ] || [ "${1:-}" = --help ]; then
  usage
  exit 0
fi
[ "$#" -ge 2 ] && [ "$#" -le 3 ] || { usage >&2; exit 1; }

ASSETS_DIR="$1"
RELEASE_TAG="$2"
MODE="${3:---all}"
COS_BUCKET="${COS_BUCKET:-sudowork-release-1309794936}"
COS_ROOT_PATH="${COS_ROOT_PATH:-sudowork/webui}"
COS_PUBLIC_BASE_URL="${COS_PUBLIC_BASE_URL:-https://${COS_BUCKET}.cos.accelerate.myqcloud.com}"

case "$RELEASE_TAG" in
  v*) VERSION="${RELEASE_TAG#v}" ;;
  dev-*) VERSION="$RELEASE_TAG" ;;
  *) echo "FAIL: invalid WebUI release tag: $RELEASE_TAG" >&2; exit 1 ;;
esac
case "$VERSION" in
  ''|*[!0-9A-Za-z._+-]*) echo "FAIL: invalid WebUI version: $VERSION" >&2; exit 1 ;;
esac
case "$MODE" in
  --release-only|--latest-only|--all) ;;
  *) echo "FAIL: invalid mode: $MODE" >&2; exit 1 ;;
esac

ARCHIVE="sudowork-webui-$VERSION-linux-amd64.tar.gz"
EXPECTED_FILES=(install.sh SHA256SUMS "$ARCHIVE")
[ -d "$ASSETS_DIR" ] || { echo "FAIL: asset directory does not exist: $ASSETS_DIR" >&2; exit 1; }
command -v coscmd >/dev/null 2>&1 || { echo 'FAIL: coscmd is required' >&2; exit 1; }
for file_name in "${EXPECTED_FILES[@]}"; do
  [ -f "$ASSETS_DIR/$file_name" ] \
    || { echo "FAIL: missing release asset: $file_name" >&2; exit 1; }
done

EXPECTED_RELEASE_LINE="$(printf 'RELEASE_TAG="${WEBUI_RELEASE_TAG:-%s}"' "$RELEASE_TAG")"
grep -Fq "$EXPECTED_RELEASE_LINE" "$ASSETS_DIR/install.sh" \
  || { echo "FAIL: install.sh is not stamped for $RELEASE_TAG" >&2; exit 1; }
grep -Fq 'sudowork-release-1309794936.cos.accelerate.myqcloud.com/sudowork/webui' \
  "$ASSETS_DIR/install.sh" \
  || { echo 'FAIL: install.sh does not use the WebUI COS source' >&2; exit 1; }
(cd "$ASSETS_DIR" && sha256sum -c SHA256SUMS)

COS_PUBLIC_BASE_URL="${COS_PUBLIC_BASE_URL%/}"
RELEASE_PATH="$COS_ROOT_PATH/releases/$RELEASE_TAG"
LATEST_PATH="$COS_ROOT_PATH/latest"
RELEASE_URL="$COS_PUBLIC_BASE_URL/$RELEASE_PATH"
LATEST_URL="$COS_PUBLIC_BASE_URL/$LATEST_PATH"
CURL_ARGS=(
  --silent --show-error --fail --location --retry 6 --retry-delay 2
  --retry-all-errors --connect-timeout 15 --max-time 180
)
IMMUTABLE_HEADERS='{"Cache-Control":"public, max-age=31536000, immutable"}'
LATEST_HEADERS='{"Cache-Control":"no-cache, no-store, must-revalidate","Content-Type":"text/x-shellscript"}'

verify_remote_size() {
  local file_name="$1" expected_size remote_size headers
  expected_size="$(wc -c < "$ASSETS_DIR/$file_name" | tr -d ' ')"
  headers="$(curl "${CURL_ARGS[@]}" --head "$RELEASE_URL/$file_name")"
  remote_size="$(printf '%s\n' "$headers" | tr -d '\r' \
    | awk 'tolower($1) == "content-length:" { value=$2 } END { print value }')"
  [ "$remote_size" = "$expected_size" ] \
    || { echo "FAIL: remote size mismatch for $file_name" >&2; exit 1; }
}

verify_remote_content() {
  local local_file="$1" remote_url="$2" downloaded
  downloaded="$(mktemp)"
  curl "${CURL_ARGS[@]}" --output "$downloaded" "$remote_url"
  cmp -s "$local_file" "$downloaded" \
    || { rm -f "$downloaded"; echo "FAIL: remote content mismatch: $remote_url" >&2; exit 1; }
  rm -f "$downloaded"
}

verify_release() {
  for file_name in "${EXPECTED_FILES[@]}"; do
    verify_remote_size "$file_name"
  done
  verify_remote_content "$ASSETS_DIR/SHA256SUMS" "$RELEASE_URL/SHA256SUMS"
}

upload_release() {
  echo "Uploading immutable WebUI release: $RELEASE_URL/"
  for file_name in "${EXPECTED_FILES[@]}"; do
    coscmd upload -H "$IMMUTABLE_HEADERS" "$ASSETS_DIR/$file_name" "$RELEASE_PATH/$file_name"
  done
  verify_release
}

publish_latest() {
  verify_release
  coscmd upload -H "$LATEST_HEADERS" "$ASSETS_DIR/install.sh" "$LATEST_PATH/install.sh"
  verify_remote_content "$ASSETS_DIR/install.sh" "$LATEST_URL/install.sh"
}

case "$MODE" in
  --release-only) upload_release ;;
  --latest-only) publish_latest ;;
  --all)
    upload_release
    publish_latest
    ;;
esac
