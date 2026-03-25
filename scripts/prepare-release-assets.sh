#!/usr/bin/env bash
# prepare-release-assets.sh
#
# Normalize electron-updater metadata from multi-arch build artifacts
# into a deterministic release-assets/ directory.
#
# Usage:
#   ./scripts/prepare-release-assets.sh [ARTIFACTS_DIR] [OUTPUT_DIR]
#
# Defaults:
#   ARTIFACTS_DIR = build-artifacts
#   OUTPUT_DIR    = release-assets

set -euo pipefail

ARTIFACTS_DIR="${1:-build-artifacts}"
OUTPUT_DIR="${2:-release-assets}"

rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

# ---------------------------------------------------------------------------
# 1) Copy all distributables and blockmaps (unique file names)
# ---------------------------------------------------------------------------
echo "==> Copying distributables from $ARTIFACTS_DIR ..."
DISTRIBUTABLES=()
while IFS= read -r line; do
  DISTRIBUTABLES+=("$line")
done < <(find "$ARTIFACTS_DIR" -type f \( \
  -name "*.exe" -o \
  -name "*.msi" -o \
  -name "*.dmg" -o \
  -name "*.AppImage" -o \
  -name "*.zip" -o \
  -name "*.blockmap" \
\) | sort)

DUPLICATE_BASENAMES=$(for file in "${DISTRIBUTABLES[@]}"; do basename "$file"; done | sort | uniq -d || true)
if [ -n "$DUPLICATE_BASENAMES" ]; then
  echo "::error::Found duplicate distributable basenames that would be overwritten in flat output:"
  echo "$DUPLICATE_BASENAMES"
  exit 1
fi

for file in "${DISTRIBUTABLES[@]}"; do
  cp -f "$file" "$OUTPUT_DIR/"
done

# ---------------------------------------------------------------------------
# 2) Collect updater metadata from each platform artifact directory
# ---------------------------------------------------------------------------
echo "==> Collecting updater metadata ..."

WIN_X64_LATEST=$(find "$ARTIFACTS_DIR" -type f -path "*/windows-build-x64/*" -name "latest.yml" | sort | head -n 1 || true)
WIN_ARM64_LATEST=$(find "$ARTIFACTS_DIR" -type f -path "*/windows-build-arm64/*" -name "latest.yml" | sort | head -n 1 || true)
MAC_X64_LATEST=$(find "$ARTIFACTS_DIR" -type f -path "*/macos-build-x64/*" -name "latest-mac.yml" | sort | head -n 1 || true)
MAC_ARM64_LATEST=$(find "$ARTIFACTS_DIR" -type f -path "*/macos-build-arm64/*" -name "latest-mac.yml" | sort | head -n 1 || true)
LINUX_X64_LATEST=$(find "$ARTIFACTS_DIR" -type f -path "*/linux-build/*" -name "latest-linux.yml" | sort | head -n 1 || true)
LINUX_ARM64_LATEST=$(find "$ARTIFACTS_DIR" -type f -path "*/linux-build/*" -name "latest-linux-arm64.yml" | sort | head -n 1 || true)

WIN_X64_DEBUG=$(find "$ARTIFACTS_DIR" -type f -path "*/windows-build-x64/*" -name "builder-debug.yml" | sort | head -n 1 || true)
WIN_ARM64_DEBUG=$(find "$ARTIFACTS_DIR" -type f -path "*/windows-build-arm64/*" -name "builder-debug.yml" | sort | head -n 1 || true)
MAC_X64_DEBUG=$(find "$ARTIFACTS_DIR" -type f -path "*/macos-build-x64/*" -name "builder-debug.yml" | sort | head -n 1 || true)
MAC_ARM64_DEBUG=$(find "$ARTIFACTS_DIR" -type f -path "*/macos-build-arm64/*" -name "builder-debug.yml" | sort | head -n 1 || true)
LINUX_DEBUG=$(find "$ARTIFACTS_DIR" -type f -path "*/linux-build/*" -name "builder-debug.yml" | sort | head -n 1 || true)

# ---------------------------------------------------------------------------
# 3) Publish deterministic canonical metadata for electron-updater
#    (avoid nondeterministic overwrite when multiple jobs produce same names)
# ---------------------------------------------------------------------------
echo "==> Writing canonical updater metadata ..."

[ -n "$WIN_X64_LATEST" ]    && cp -f "$WIN_X64_LATEST"    "$OUTPUT_DIR/latest.yml"
[ -n "$MAC_X64_LATEST" ]    && cp -f "$MAC_X64_LATEST"    "$OUTPUT_DIR/latest-mac.yml"
[ -n "$LINUX_X64_LATEST" ]  && cp -f "$LINUX_X64_LATEST"  "$OUTPUT_DIR/latest-linux.yml"

# ---------------------------------------------------------------------------
# 4) Architecture-scoped metadata for non-x64 architectures
#
# electron-updater constructs the yml filename from the channel name set in
# autoUpdaterService.ts by appending a platform suffix:
#   macOS:   ${channel}-mac.yml
#   Linux:   ${channel}-linux.yml
#   Windows: ${channel}.yml  (no suffix)
#
# Channel names in autoUpdaterService.ts:
#   'arm64'     → arm64-mac.yml (macOS arm64) / arm64-linux.yml (Linux arm64)
#   'win-arm64' → win-arm64.yml (Windows arm64)
#   undefined   → standard defaults for x64 (latest-mac.yml / latest.yml / latest-linux.yml)
# ---------------------------------------------------------------------------
echo "==> Writing architecture-scoped metadata ..."

[ -n "$MAC_ARM64_LATEST" ]   && cp -f "$MAC_ARM64_LATEST"   "$OUTPUT_DIR/arm64-mac.yml"
[ -n "$WIN_ARM64_LATEST" ]   && cp -f "$WIN_ARM64_LATEST"   "$OUTPUT_DIR/win-arm64.yml"
[ -n "$LINUX_ARM64_LATEST" ] && cp -f "$LINUX_ARM64_LATEST" "$OUTPUT_DIR/arm64-linux.yml"

[ -n "$WIN_X64_DEBUG" ]     && cp -f "$WIN_X64_DEBUG"     "$OUTPUT_DIR/builder-debug-win-x64.yml"
[ -n "$WIN_ARM64_DEBUG" ]   && cp -f "$WIN_ARM64_DEBUG"   "$OUTPUT_DIR/builder-debug-win-arm64.yml"
[ -n "$MAC_X64_DEBUG" ]     && cp -f "$MAC_X64_DEBUG"     "$OUTPUT_DIR/builder-debug-mac-x64.yml"
[ -n "$MAC_ARM64_DEBUG" ]   && cp -f "$MAC_ARM64_DEBUG"   "$OUTPUT_DIR/builder-debug-mac-arm64.yml"
[ -n "$LINUX_DEBUG" ]       && cp -f "$LINUX_DEBUG"       "$OUTPUT_DIR/builder-debug-linux.yml"

# Keep builder-debug.yml canonical and deterministic as well
if [ -n "$WIN_X64_DEBUG" ]; then
  cp -f "$WIN_X64_DEBUG" "$OUTPUT_DIR/builder-debug.yml"
elif [ -n "$MAC_X64_DEBUG" ]; then
  cp -f "$MAC_X64_DEBUG" "$OUTPUT_DIR/builder-debug.yml"
elif [ -n "$LINUX_DEBUG" ]; then
  cp -f "$LINUX_DEBUG" "$OUTPUT_DIR/builder-debug.yml"
fi

# ---------------------------------------------------------------------------
# 5) Validate updater metadata
#    - Tag release: only mac-arm64 + windows-x64 (arm64-mac.yml + latest.yml)
#    - Dev release: all platforms (latest-mac.yml + latest.yml + arch-specific)
# ---------------------------------------------------------------------------
echo "==> Validating updater metadata ..."

MISSING=0

# Windows: must have at least one Windows metadata
if [ ! -f "$OUTPUT_DIR/latest.yml" ] && [ ! -f "$OUTPUT_DIR/win-arm64.yml" ]; then
  echo "::error::Missing Windows updater metadata (need latest.yml or win-arm64.yml)"
  MISSING=1
fi

# macOS: must have at least one macOS metadata
if [ ! -f "$OUTPUT_DIR/latest-mac.yml" ] && [ ! -f "$OUTPUT_DIR/arm64-mac.yml" ]; then
  echo "::error::Missing macOS updater metadata (need latest-mac.yml or arm64-mac.yml)"
  MISSING=1
fi

if [ "$MISSING" -ne 0 ]; then
  exit 1
fi

echo ""
echo "==> Prepared release assets:"
ls -lh "$OUTPUT_DIR"
echo ""
echo "==> Done."
