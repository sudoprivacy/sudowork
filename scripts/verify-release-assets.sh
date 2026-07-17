#!/usr/bin/env bash

set -euo pipefail

OUTPUT_DIR="${1:-release-assets}"
ERRORS=0

for f in latest.yml latest-mac.yml latest-linux.yml; do
  if [ ! -f "$OUTPUT_DIR/$f" ]; then
    echo "FAIL: missing canonical metadata: $f"
    ERRORS=$((ERRORS + 1))
  fi
done

extract_ref_file() {
  local metadata_file="$1"
  local ref
  ref=$(grep -E '^path:' "$metadata_file" | head -n 1 | sed -E 's/^path:[[:space:]]*//')
  if [ -z "$ref" ]; then
    ref=$(grep -E '^[[:space:]]*-?[[:space:]]*url:' "$metadata_file" | head -n 1 | sed -E 's/^[[:space:]]*-?[[:space:]]*url:[[:space:]]*//')
  fi
  echo "$ref"
}

assert_metadata_points_to_existing_file() {
  local metadata_name="$1"
  local expected_pattern="$2"
  local metadata_path="$OUTPUT_DIR/$metadata_name"

  local ref_file
  ref_file=$(extract_ref_file "$metadata_path")

  if [ -z "$ref_file" ]; then
    echo "FAIL: $metadata_name has no path/url entry"
    ERRORS=$((ERRORS + 1))
    return
  fi

  if [[ ! "$ref_file" =~ $expected_pattern ]]; then
    echo "FAIL: $metadata_name points to unexpected file: $ref_file"
    ERRORS=$((ERRORS + 1))
    return
  fi

  if [ ! -f "$OUTPUT_DIR/$ref_file" ]; then
    echo "FAIL: $metadata_name references missing file: $ref_file"
    ERRORS=$((ERRORS + 1))
    return
  fi

  echo "PASS: $metadata_name -> $ref_file"
}

# Canonical metadata: x64 defaults used by electron-updater
assert_metadata_points_to_existing_file "latest.yml" "(win-x64|win32-x64|x64)"
assert_metadata_points_to_existing_file "latest-mac.yml" "(mac-x64|darwin-x64|x64)"
assert_metadata_points_to_existing_file "latest-linux.yml" "(linux|AppImage)"
if ! extract_ref_file "$OUTPUT_DIR/latest-mac.yml" | grep -q '\.zip$'; then
  echo "FAIL: latest-mac.yml should reference a .zip package"
  ERRORS=$((ERRORS + 1))
else
  echo "PASS: latest-mac.yml references a .zip package"
fi

# Architecture-scoped metadata: electron-updater constructs filenames from
# channel names set in autoUpdaterService.ts:
#   arm64     → arm64-mac.yml / arm64-linux.yml
#   win-arm64 → win-arm64.yml
for f in arm64-mac.yml win-arm64.yml arm64-linux.yml; do
  if [ ! -f "$OUTPUT_DIR/$f" ]; then
    echo "FAIL: missing arch-scoped metadata: $f"
    ERRORS=$((ERRORS + 1))
  else
    echo "PASS: $f exists"
  fi
done
assert_metadata_points_to_existing_file "arm64-mac.yml" "(mac-arm64|darwin-arm64|arm64)"
if ! extract_ref_file "$OUTPUT_DIR/arm64-mac.yml" | grep -q '\.zip$'; then
  echo "FAIL: arm64-mac.yml should reference a .zip package"
  ERRORS=$((ERRORS + 1))
else
  echo "PASS: arm64-mac.yml references a .zip package"
fi

for f in builder-debug-win-x64.yml builder-debug-win-arm64.yml builder-debug-mac-x64.yml builder-debug-mac-arm64.yml builder-debug-linux.yml builder-debug.yml; do
  if [ ! -f "$OUTPUT_DIR/$f" ]; then
    echo "FAIL: missing debug metadata: $f"
    ERRORS=$((ERRORS + 1))
  else
    echo "PASS: $f exists"
  fi
done

for f in Sudowork-1.0.0-win-x64.exe Sudowork-1.0.0-win-arm64.exe Sudowork-1.0.0-mac-x64.dmg Sudowork-1.0.0-mac-arm64.dmg Sudowork-1.0.0-mac-x64.zip Sudowork-1.0.0-mac-arm64.zip Sudowork-1.0.0.AppImage Sudowork-1.0.0-arm64.AppImage; do
  if [ ! -f "$OUTPUT_DIR/$f" ]; then
    echo "FAIL: missing distributable: $f"
    ERRORS=$((ERRORS + 1))
  else
    echo "PASS: $f exists"
  fi
done

# Blockmaps enable differential (incremental) auto-updates. electron-updater
# fetches "<installer-url>.blockmap" next to each updater package, so every
# .exe and every mac .zip must ship with a sibling blockmap. dmg needs none:
# macOS auto-update uses the zip target only.
for installer in "$OUTPUT_DIR"/*.exe "$OUTPUT_DIR"/*-mac-*.zip; do
  [ -f "$installer" ] || continue
  name=$(basename "$installer")
  if [ ! -f "$installer.blockmap" ]; then
    echo "FAIL: missing blockmap for $name"
    ERRORS=$((ERRORS + 1))
  else
    echo "PASS: $name.blockmap exists"
  fi
done

echo ""
if [ "$ERRORS" -gt 0 ]; then
  echo "FAILED: $ERRORS errors found"
  exit 1
fi

echo "ALL CHECKS PASSED"
