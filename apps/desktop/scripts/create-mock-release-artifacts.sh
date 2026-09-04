#!/usr/bin/env bash

set -euo pipefail

ARTIFACTS_DIR="${1:-build-artifacts}"

rm -rf "$ARTIFACTS_DIR"
mkdir -p "$ARTIFACTS_DIR/windows-build-x64"
mkdir -p "$ARTIFACTS_DIR/windows-build-arm64"
mkdir -p "$ARTIFACTS_DIR/macos-build-x64"
mkdir -p "$ARTIFACTS_DIR/macos-build-arm64"
mkdir -p "$ARTIFACTS_DIR/linux-build"

sha512_file() {
  openssl dgst -sha512 -binary "$1" | openssl base64 -A
}

file_size() {
  wc -c < "$1" | tr -d ' '
}

create_blockmap() {
  python3 - "$1" <<'PY'
import gzip
import json
import sys

with gzip.open(sys.argv[1], 'wt', encoding='utf-8') as output:
    json.dump({'version': '2', 'files': []}, output)
PY
}

create_file() {
  printf '%s\n' "$2" > "$1"
}

WIN_X64_EXE="$ARTIFACTS_DIR/windows-build-x64/Sudowork-1.0.0-win-x64.exe"
create_file "$WIN_X64_EXE" 'mock Windows x64 installer'
create_blockmap "$WIN_X64_EXE.blockmap"
WIN_X64_SHA=$(sha512_file "$WIN_X64_EXE")
WIN_X64_SIZE=$(file_size "$WIN_X64_EXE")
cat > "$ARTIFACTS_DIR/windows-build-x64/latest.yml" <<EOF
version: 1.0.0
files:
  - url: Sudowork-1.0.0-win-x64.exe
    sha512: $WIN_X64_SHA
    size: $WIN_X64_SIZE
path: Sudowork-1.0.0-win-x64.exe
sha512: $WIN_X64_SHA
releaseDate: '2025-01-01T00:00:00.000Z'
EOF
printf '%s\n' 'debug: win-x64' > "$ARTIFACTS_DIR/windows-build-x64/builder-debug.yml"

WIN_ARM64_EXE="$ARTIFACTS_DIR/windows-build-arm64/Sudowork-1.0.0-win-arm64.exe"
create_file "$WIN_ARM64_EXE" 'mock Windows arm64 installer'
create_blockmap "$WIN_ARM64_EXE.blockmap"
WIN_ARM64_SHA=$(sha512_file "$WIN_ARM64_EXE")
WIN_ARM64_SIZE=$(file_size "$WIN_ARM64_EXE")
cat > "$ARTIFACTS_DIR/windows-build-arm64/latest.yml" <<EOF
version: 1.0.0
files:
  - url: Sudowork-1.0.0-win-arm64.exe
    sha512: $WIN_ARM64_SHA
    size: $WIN_ARM64_SIZE
path: Sudowork-1.0.0-win-arm64.exe
sha512: $WIN_ARM64_SHA
releaseDate: '2025-01-01T00:00:00.000Z'
EOF
printf '%s\n' 'debug: win-arm64' > "$ARTIFACTS_DIR/windows-build-arm64/builder-debug.yml"

MAC_X64_ZIP="$ARTIFACTS_DIR/macos-build-x64/Sudowork-1.0.0-mac-x64.zip"
MAC_X64_DMG="$ARTIFACTS_DIR/macos-build-x64/Sudowork-1.0.0-mac-x64.dmg"
create_file "$MAC_X64_ZIP" 'mock macOS x64 update zip'
create_file "$MAC_X64_DMG" 'mock macOS x64 installer'
create_blockmap "$MAC_X64_ZIP.blockmap"
MAC_X64_ZIP_SHA=$(sha512_file "$MAC_X64_ZIP")
MAC_X64_ZIP_SIZE=$(file_size "$MAC_X64_ZIP")
MAC_X64_DMG_SHA=$(sha512_file "$MAC_X64_DMG")
MAC_X64_DMG_SIZE=$(file_size "$MAC_X64_DMG")
cat > "$ARTIFACTS_DIR/macos-build-x64/latest-mac.yml" <<EOF
version: 1.0.0
files:
  - url: Sudowork-1.0.0-mac-x64.zip
    sha512: $MAC_X64_ZIP_SHA
    size: $MAC_X64_ZIP_SIZE
  - url: Sudowork-1.0.0-mac-x64.dmg
    sha512: $MAC_X64_DMG_SHA
    size: $MAC_X64_DMG_SIZE
path: Sudowork-1.0.0-mac-x64.zip
sha512: $MAC_X64_ZIP_SHA
releaseDate: '2025-01-01T00:00:00.000Z'
EOF
printf '%s\n' 'debug: mac-x64' > "$ARTIFACTS_DIR/macos-build-x64/builder-debug.yml"

MAC_ARM64_ZIP="$ARTIFACTS_DIR/macos-build-arm64/Sudowork-1.0.0-mac-arm64.zip"
MAC_ARM64_DMG="$ARTIFACTS_DIR/macos-build-arm64/Sudowork-1.0.0-mac-arm64.dmg"
create_file "$MAC_ARM64_ZIP" 'mock macOS arm64 update zip'
create_file "$MAC_ARM64_DMG" 'mock macOS arm64 installer'
create_blockmap "$MAC_ARM64_ZIP.blockmap"
MAC_ARM64_ZIP_SHA=$(sha512_file "$MAC_ARM64_ZIP")
MAC_ARM64_ZIP_SIZE=$(file_size "$MAC_ARM64_ZIP")
MAC_ARM64_DMG_SHA=$(sha512_file "$MAC_ARM64_DMG")
MAC_ARM64_DMG_SIZE=$(file_size "$MAC_ARM64_DMG")
cat > "$ARTIFACTS_DIR/macos-build-arm64/latest-mac.yml" <<EOF
version: 1.0.0
files:
  - url: Sudowork-1.0.0-mac-arm64.zip
    sha512: $MAC_ARM64_ZIP_SHA
    size: $MAC_ARM64_ZIP_SIZE
  - url: Sudowork-1.0.0-mac-arm64.dmg
    sha512: $MAC_ARM64_DMG_SHA
    size: $MAC_ARM64_DMG_SIZE
path: Sudowork-1.0.0-mac-arm64.zip
sha512: $MAC_ARM64_ZIP_SHA
releaseDate: '2025-01-01T00:00:00.000Z'
EOF
printf '%s\n' 'debug: mac-arm64' > "$ARTIFACTS_DIR/macos-build-arm64/builder-debug.yml"

LINUX_X64_APPIMAGE="$ARTIFACTS_DIR/linux-build/Sudowork-1.0.0.AppImage"
LINUX_ARM64_APPIMAGE="$ARTIFACTS_DIR/linux-build/Sudowork-1.0.0-arm64.AppImage"
create_file "$LINUX_X64_APPIMAGE" 'mock Linux x64 AppImage'
create_file "$LINUX_ARM64_APPIMAGE" 'mock Linux arm64 AppImage'
LINUX_X64_SHA=$(sha512_file "$LINUX_X64_APPIMAGE")
LINUX_X64_SIZE=$(file_size "$LINUX_X64_APPIMAGE")
LINUX_ARM64_SHA=$(sha512_file "$LINUX_ARM64_APPIMAGE")
LINUX_ARM64_SIZE=$(file_size "$LINUX_ARM64_APPIMAGE")
cat > "$ARTIFACTS_DIR/linux-build/latest-linux.yml" <<EOF
version: 1.0.0
files:
  - url: Sudowork-1.0.0.AppImage
    sha512: $LINUX_X64_SHA
    size: $LINUX_X64_SIZE
path: Sudowork-1.0.0.AppImage
sha512: $LINUX_X64_SHA
releaseDate: '2025-01-01T00:00:00.000Z'
EOF
cat > "$ARTIFACTS_DIR/linux-build/latest-linux-arm64.yml" <<EOF
version: 1.0.0
files:
  - url: Sudowork-1.0.0-arm64.AppImage
    sha512: $LINUX_ARM64_SHA
    size: $LINUX_ARM64_SIZE
path: Sudowork-1.0.0-arm64.AppImage
sha512: $LINUX_ARM64_SHA
releaseDate: '2025-01-01T00:00:00.000Z'
EOF
printf '%s\n' 'debug: linux' > "$ARTIFACTS_DIR/linux-build/builder-debug.yml"

echo "Mock artifacts created in $ARTIFACTS_DIR:"
find "$ARTIFACTS_DIR" -type f | sort
