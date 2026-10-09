#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELEASE_TAG="${1:?usage: prepare-release-assets.sh RELEASE_TAG ARCH IMAGE_ARCHIVE OUTPUT_DIR}"
ARCH="${2:?usage: prepare-release-assets.sh RELEASE_TAG ARCH IMAGE_ARCHIVE OUTPUT_DIR}"
IMAGE_ARCHIVE="${3:?usage: prepare-release-assets.sh RELEASE_TAG ARCH IMAGE_ARCHIVE OUTPUT_DIR}"
OUTPUT_DIR="${4:?usage: prepare-release-assets.sh RELEASE_TAG ARCH IMAGE_ARCHIVE OUTPUT_DIR}"

case "$RELEASE_TAG" in
  v*) VERSION="${RELEASE_TAG#v}" ;;
  dev-*) VERSION="$RELEASE_TAG" ;;
  *) echo "Invalid WebUI release tag: $RELEASE_TAG" >&2; exit 1 ;;
esac
case "$VERSION" in
  ''|*[!0-9A-Za-z._+-]*) echo "Invalid WebUI version: $VERSION" >&2; exit 1 ;;
esac
case "$ARCH" in
  amd64) ;;
  *) echo "Unsupported WebUI architecture: $ARCH" >&2; exit 1 ;;
esac
[ -f "$IMAGE_ARCHIVE" ] || { echo "Image archive not found: $IMAGE_ARCHIVE" >&2; exit 1; }

mkdir -p "$OUTPUT_DIR"
OUTPUT_DIR="$(cd "$OUTPUT_DIR" && pwd)"
ARCHIVE_NAME="sudowork-webui-$VERSION-linux-$ARCH.tar.gz"
ARCHIVE_PATH="$OUTPUT_DIR/$ARCHIVE_NAME"
if [ "$(cd "$(dirname "$IMAGE_ARCHIVE")" && pwd)/$(basename "$IMAGE_ARCHIVE")" != "$ARCHIVE_PATH" ]; then
  cp "$IMAGE_ARCHIVE" "$ARCHIVE_PATH"
fi

sed "s/@@SUDOWORK_WEBUI_RELEASE_TAG@@/$RELEASE_TAG/g" \
  "$ROOT_DIR/deploy/install.sh" > "$OUTPUT_DIR/install.sh"
chmod 755 "$OUTPUT_DIR/install.sh"
EXPECTED_RELEASE_LINE="$(printf 'RELEASE_TAG="${WEBUI_RELEASE_TAG:-%s}"' "$RELEASE_TAG")"
grep -Fq "$EXPECTED_RELEASE_LINE" "$OUTPUT_DIR/install.sh" \
  || { echo 'Failed to stamp install.sh' >&2; exit 1; }

if command -v sha256sum >/dev/null 2>&1; then
  (cd "$OUTPUT_DIR" && sha256sum "$ARCHIVE_NAME" > SHA256SUMS)
else
  (cd "$OUTPUT_DIR" && shasum -a 256 "$ARCHIVE_NAME" > SHA256SUMS)
fi

printf '%s\n' "$OUTPUT_DIR/install.sh" "$OUTPUT_DIR/SHA256SUMS" "$ARCHIVE_PATH"
