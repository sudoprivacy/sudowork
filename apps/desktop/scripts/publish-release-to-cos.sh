#!/usr/bin/env bash

set -euo pipefail

ASSETS_DIR="${1:-release-assets}"
COS_BUCKET="${COS_BUCKET:-sudowork-release-1309794936}"
COS_REGION="${COS_REGION:-ap-beijing}"
COS_PATH="${COS_PATH:-sudowork/release/latest}"
COS_PUBLIC_BASE_URL="${COS_PUBLIC_BASE_URL:-https://${COS_BUCKET}.cos.${COS_REGION}.myqcloud.com/${COS_PATH}}"

if ! command -v coscmd >/dev/null 2>&1; then
  echo "FAIL: coscmd is required"
  exit 1
fi

bash scripts/verify-release-assets.sh "$ASSETS_DIR"

VERSIONED_FILES=()
while IFS= read -r -d '' file; do
  VERSIONED_FILES+=("$file")
done < <(
  find "$ASSETS_DIR" -maxdepth 1 -type f \( \
    -name '*.exe' -o \
    -name '*.dmg' -o \
    -name '*.zip' -o \
    -name '*.blockmap' \
  \) -print0
)

if [ "${#VERSIONED_FILES[@]}" -eq 0 ]; then
  echo "FAIL: no versioned release files found in $ASSETS_DIR"
  exit 1
fi

latest_alias_name() {
  local file_name="$1"
  printf '%s\n' "$file_name" \
    | sed -E 's/[0-9]+\.[0-9]+\.[0-9]+/latest/' \
    | sed -E 's/-darwin-/-mac-/; s/-win32-/-win-/'
}

echo "Uploading immutable, versioned release files..."
for file in "${VERSIONED_FILES[@]}"; do
  file_name=$(basename "$file")
  if [[ ! "$file_name" =~ [0-9]+\.[0-9]+\.[0-9]+ ]]; then
    echo "FAIL: release filename is not versioned: $file_name"
    exit 1
  fi

  echo "  $file_name"
  coscmd upload "$file" "$COS_PATH/$file_name"
done

echo "Uploading latest compatibility aliases..."
for file in "${VERSIONED_FILES[@]}"; do
  file_name=$(basename "$file")
  alias_name=$(latest_alias_name "$file_name")
  if [ "$alias_name" = "$file_name" ]; then
    echo "FAIL: could not derive latest alias for $file_name"
    exit 1
  fi

  echo "  $file_name -> $alias_name"
  coscmd upload "$file" "$COS_PATH/$alias_name"
done

echo "Verifying uploaded assets and COS single-range behavior before publishing metadata..."
bash scripts/verify-cos-update-feed.sh "$ASSETS_DIR" "$COS_PUBLIC_BASE_URL" --assets-only

METADATA_FILES=(latest.yml latest-mac.yml arm64-mac.yml win-arm64.yml latest-linux.yml arm64-linux.yml)
echo "Publishing updater metadata last..."
for metadata in "${METADATA_FILES[@]}"; do
  if [ ! -f "$ASSETS_DIR/$metadata" ]; then
    continue
  fi

  echo "  $metadata"
  coscmd upload "$ASSETS_DIR/$metadata" "$COS_PATH/$metadata"
done

echo "Verifying published COS update feed..."
bash scripts/verify-cos-update-feed.sh "$ASSETS_DIR" "$COS_PUBLIC_BASE_URL" --full

echo "COS release published successfully: $COS_PUBLIC_BASE_URL/"
