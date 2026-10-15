#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
RELEASE_TAG="${1:?usage: package-release.sh RELEASE_TAG ARCH OUTPUT_DIR}"
ARCH="${2:?usage: package-release.sh RELEASE_TAG ARCH OUTPUT_DIR}"
OUTPUT_DIR="${3:?usage: package-release.sh RELEASE_TAG ARCH OUTPUT_DIR}"

case "$RELEASE_TAG" in
  v*) VERSION="${RELEASE_TAG#v}" ;;
  dev-*) VERSION="$RELEASE_TAG" ;;
  *) echo "Invalid WebUI release tag: $RELEASE_TAG" >&2; exit 1 ;;
esac
case "$VERSION" in
  ''|*[!0-9A-Za-z._+-]*) echo "Invalid WebUI version: $VERSION" >&2; exit 1 ;;
esac
case "$ARCH" in
  amd64|arm64) ;;
  *) echo "Unsupported WebUI architecture: $ARCH" >&2; exit 1 ;;
esac
command -v docker >/dev/null 2>&1 || { echo 'Docker is required' >&2; exit 1; }

IMAGE_VERSION="${VERSION//+/-}"
IMAGE_NAME="sudowork-webui:$IMAGE_VERSION"
STAGE_DIR="$(mktemp -d)"
trap 'rm -rf "$STAGE_DIR"' EXIT
RAW_ARCHIVE="$STAGE_DIR/images.tar.gz"

docker buildx build \
  --platform "linux/$ARCH" \
  --load \
  --build-arg "RELEASE_VERSION=$VERSION" \
  --tag "$IMAGE_NAME" \
  --file "$ROOT_DIR/apps/webui/Dockerfile" \
  "$ROOT_DIR"
docker pull --platform "linux/$ARCH" postgres:16-alpine
for image in "$IMAGE_NAME" postgres:16-alpine; do
  [ "$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image")" = "linux/$ARCH" ] \
    || { echo "Image architecture differs from linux/$ARCH: $image" >&2; exit 1; }
done
# Loading the addon exercises the native PTY dependency on each release runner.
docker run --rm --entrypoint node "$IMAGE_NAME" -e 'require("@lydell/node-pty")'
docker save "$IMAGE_NAME" postgres:16-alpine | gzip -1 > "$RAW_ARCHIVE"
gzip -t "$RAW_ARCHIVE"

bash "$ROOT_DIR/apps/webui/deploy/prepare-release-assets.sh" \
  "$RELEASE_TAG" "$ARCH" "$RAW_ARCHIVE" "$OUTPUT_DIR"
