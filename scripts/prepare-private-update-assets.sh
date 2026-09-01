#!/usr/bin/env bash

set -euo pipefail

ARTIFACTS_DIR="${1:-build-artifacts}"
OUTPUT_DIR="${2:-private-update-assets}"
ZIP_NAME="${3:-private-update-assets.zip}"
ZIP_PATH="$(python3 -c 'import os, sys; print(os.path.abspath(sys.argv[1]))' "$ZIP_NAME")"

rm -rf "$OUTPUT_DIR"
rm -f "$ZIP_PATH"
mkdir -p "$OUTPUT_DIR"

find_one() {
  local pattern="$1"
  local result_count
  result_count=$(find "$ARTIFACTS_DIR" -type f -path "$pattern" | wc -l | tr -d ' ')
  if [ "$result_count" -ne 1 ]; then
    echo "FAIL: expected exactly one file matching $pattern, found $result_count"
    find "$ARTIFACTS_DIR" -type f -path "$pattern" | sort || true
    exit 1
  fi
  find "$ARTIFACTS_DIR" -type f -path "$pattern" | sort | head -n 1
}

copy_required() {
  local source="$1"
  local target_name="${2:-$(basename "$source")}"
  cp -f "$source" "$OUTPUT_DIR/$target_name"
}

latest_alias_name() {
  local file_name="$1"
  printf '%s\n' "$file_name" \
    | sed -E 's/[0-9]+\.[0-9]+\.[0-9]+/latest/' \
    | sed -E 's/-darwin-/-mac-/; s/-win32-/-win-/'
}

copy_with_latest_alias() {
  local source="$1"
  local file_name
  local alias_name
  file_name=$(basename "$source")
  alias_name=$(latest_alias_name "$file_name")
  if [ "$alias_name" = "$file_name" ]; then
    echo "FAIL: could not derive latest alias for $file_name"
    exit 1
  fi

  copy_required "$source"
  copy_required "$source" "$alias_name"
}

WIN_YML=$(find_one '*/windows-build-x64/latest.yml')
MAC_ARM64_YML=$(find_one '*/macos-build-arm64/latest-mac.yml')
WIN_EXE=$(find_one '*/windows-build-x64/Sudowork-[0-9]*.[0-9]*.[0-9]*-win-x64.exe')
MAC_ARM64_ZIP=$(find_one '*/macos-build-arm64/Sudowork-[0-9]*.[0-9]*.[0-9]*-mac-arm64.zip')
MAC_ARM64_DMG=$(find_one '*/macos-build-arm64/Sudowork-[0-9]*.[0-9]*.[0-9]*-mac-arm64.dmg')

WIN_EXE_BLOCKMAP="$WIN_EXE.blockmap"
MAC_ARM64_ZIP_BLOCKMAP="$MAC_ARM64_ZIP.blockmap"

if [ ! -f "$WIN_EXE_BLOCKMAP" ]; then
  echo "FAIL: missing Windows blockmap: $WIN_EXE_BLOCKMAP"
  exit 1
fi
if [ ! -f "$MAC_ARM64_ZIP_BLOCKMAP" ]; then
  echo "FAIL: missing macOS arm64 blockmap: $MAC_ARM64_ZIP_BLOCKMAP"
  exit 1
fi

copy_required "$WIN_YML" latest.yml
copy_required "$MAC_ARM64_YML" arm64-mac.yml
copy_with_latest_alias "$WIN_EXE"
copy_with_latest_alias "$WIN_EXE_BLOCKMAP"
copy_with_latest_alias "$MAC_ARM64_ZIP"
copy_with_latest_alias "$MAC_ARM64_ZIP_BLOCKMAP"
copy_with_latest_alias "$MAC_ARM64_DMG"

grep -F "$(basename "$WIN_EXE")" "$OUTPUT_DIR/latest.yml" >/dev/null || {
  echo "FAIL: latest.yml does not reference $(basename "$WIN_EXE")"
  exit 1
}

grep -F "$(basename "$MAC_ARM64_ZIP")" "$OUTPUT_DIR/arm64-mac.yml" >/dev/null || {
  echo "FAIL: arm64-mac.yml does not reference $(basename "$MAC_ARM64_ZIP")"
  exit 1
}

(
  cd "$OUTPUT_DIR"
  zip -q -r "$ZIP_PATH" .
)

echo "Prepared private update assets:"
find "$OUTPUT_DIR" -maxdepth 1 -type f -exec basename {} \; | sort
echo "Created $ZIP_PATH"
