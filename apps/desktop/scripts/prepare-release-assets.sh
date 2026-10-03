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

# electron-builder can choose the DMG as the legacy top-level update artifact.
# macOS updates require the ZIP; keep its recorded digest without changing any
# per-file metadata, which verify-release-assets.sh validates against the bytes.
python3 - "$OUTPUT_DIR" <<'PY'
import pathlib
import re
import sys

for name, arch in [('latest-mac.yml', 'x64'), ('arm64-mac.yml', 'arm64')]:
    metadata = pathlib.Path(sys.argv[1]) / name
    if not metadata.is_file():
        continue
    text = metadata.read_text(encoding='utf-8')
    files = {}
    current = None
    for line in text.splitlines():
        entry = re.match(r'^\s*-\s+url:\s*(\S+)\s*$', line)
        if entry:
            current = entry.group(1)
            files[current] = {}
        field = re.match(r'^\s{4}sha512:\s*(\S+)\s*$', line)
        if field and current is not None:
            files[current]['sha512'] = field.group(1)
    primary = re.search(r'^path:\s*(\S+)\s*$', text, re.MULTILINE)
    digest = re.search(r'^sha512:\s*(\S+)\s*$', text, re.MULTILINE)
    if not primary or not digest or files.get(primary.group(1), {}).get('sha512') != digest.group(1):
        raise SystemExit(f'FAIL: {name}: primary artifact does not match file metadata')
    candidates = [file for file in files if file.endswith(f'-{arch}.zip')]
    if len(candidates) != 1 or 'sha512' not in files[candidates[0]]:
        raise SystemExit(f'FAIL: {name}: expected one {arch} ZIP update artifact')
    archive = candidates[0]
    text = re.sub(r'^path:\s*\S+\s*$', f'path: {archive}', text, count=1, flags=re.MULTILINE)
    text = re.sub(r'^sha512:\s*\S+\s*$', f"sha512: {files[archive]['sha512']}", text, count=1, flags=re.MULTILINE)
    metadata.write_text(text, encoding='utf-8')
    print(f'Normalized {name}: {archive}')
PY

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
#    Stable releases require Windows x64 and both macOS architectures.
#    Manual development builds may additionally contain Windows arm64 and Linux.
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
