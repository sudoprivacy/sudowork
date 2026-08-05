#!/usr/bin/env bash

set -euo pipefail

ASSETS_DIR="${1:-release-assets}"
BASE_URL="${2:-${COS_PUBLIC_BASE_URL:-}}"
MODE="${3:---full}"

if [ ! -d "$ASSETS_DIR" ]; then
  echo "FAIL: release assets directory does not exist: $ASSETS_DIR"
  exit 1
fi

if [ -z "$BASE_URL" ]; then
  echo "FAIL: COS public base URL is required as the second argument or COS_PUBLIC_BASE_URL"
  exit 1
fi

if [ "$MODE" != "--assets-only" ] && [ "$MODE" != "--full" ]; then
  echo "FAIL: mode must be --assets-only or --full"
  exit 1
fi

BASE_URL="${BASE_URL%/}"
CURL_ARGS=(
  --silent
  --show-error
  --fail
  --location
  --retry 6
  --retry-delay 2
  --retry-all-errors
  --connect-timeout 15
  --max-time 120
)

REMOTE_FILES=()
while IFS= read -r -d '' file; do
  REMOTE_FILES+=("$file")
done < <(
  find "$ASSETS_DIR" -maxdepth 1 -type f \( \
    -name '*.exe' -o \
    -name '*.dmg' -o \
    -name '*.AppImage' -o \
    -name '*.deb' -o \
    -name '*.zip' -o \
    -name '*.blockmap' \
  \) -print0
)

if [ "${#REMOTE_FILES[@]}" -eq 0 ]; then
  echo "FAIL: no release files found in $ASSETS_DIR"
  exit 1
fi

latest_alias_name() {
  local file_name="$1"
  printf '%s\n' "$file_name" \
    | sed -E 's/[0-9]+\.[0-9]+\.[0-9]+/latest/' \
    | sed -E 's/-darwin-/-mac-/; s/-win32-/-win-/'
}

verify_remote_size() {
  local file="$1"
  local remote_name="${2:-$(basename "$file")}"
  local expected_size
  local headers
  local remote_size

  expected_size=$(wc -c < "$file" | tr -d ' ')
  headers=$(curl "${CURL_ARGS[@]}" --head "$BASE_URL/$remote_name")
  remote_size=$(printf '%s\n' "$headers" | tr -d '\r' | awk 'tolower($1) == "content-length:" { value = $2 } END { print value }')

  if [ "$remote_size" != "$expected_size" ]; then
    echo "FAIL: remote size mismatch for $remote_name (expected $expected_size, got ${remote_size:-missing})"
    exit 1
  fi

  echo "PASS: remote asset $remote_name ($expected_size bytes)"
}

verify_single_range() {
  local file="$1"
  local remote_name="${2:-$(basename "$file")}"
  local file_size
  local range_end
  local expected_content_range
  local temp_dir
  local status
  local content_range

  file_size=$(wc -c < "$file" | tr -d ' ')
  range_end=1023
  if [ "$file_size" -le "$range_end" ]; then
    range_end=$((file_size - 1))
  fi
  expected_content_range="bytes 0-$range_end/$file_size"
  temp_dir=$(mktemp -d)

  if ! curl "${CURL_ARGS[@]}" \
    --range "0-$range_end" \
    --dump-header "$temp_dir/headers" \
    --output "$temp_dir/body" \
    "$BASE_URL/$remote_name"; then
    rm -rf "$temp_dir"
    return 1
  fi

  status=$(tr -d '\r' < "$temp_dir/headers" | awk '/^HTTP\// { value = $2 } END { print value }')
  content_range=$(tr -d '\r' < "$temp_dir/headers" | awk 'tolower($1) == "content-range:" { $1 = ""; sub(/^[[:space:]]*/, ""); value = $0 } END { print value }')

  if [ "$status" != "206" ]; then
    echo "FAIL: COS did not honor a single Range request for $remote_name (HTTP ${status:-unknown})"
    rm -rf "$temp_dir"
    exit 1
  fi
  if [ "$content_range" != "$expected_content_range" ]; then
    echo "FAIL: unexpected Content-Range for $remote_name (expected '$expected_content_range', got '${content_range:-missing}')"
    rm -rf "$temp_dir"
    exit 1
  fi
  if ! cmp -s <(head -c "$((range_end + 1))" "$file") "$temp_dir/body"; then
    echo "FAIL: Range response content mismatch for $remote_name"
    rm -rf "$temp_dir"
    exit 1
  fi

  rm -rf "$temp_dir"
  echo "PASS: single Range request $remote_name"
}

for file in "${REMOTE_FILES[@]}"; do
  verify_remote_size "$file"
done

for file in "${REMOTE_FILES[@]}"; do
  file_name=$(basename "$file")
  alias_name=$(latest_alias_name "$file_name")
  if [ "$alias_name" = "$file_name" ]; then
    echo "FAIL: could not derive latest alias for $file_name"
    exit 1
  fi
  verify_remote_size "$file" "$alias_name"
done

for file in "${REMOTE_FILES[@]}"; do
  case "$file" in
    *.exe|*.zip)
      verify_single_range "$file"
      verify_single_range "$file" "$(latest_alias_name "$(basename "$file")")"
      ;;
  esac
done

if [ "$MODE" = "--assets-only" ]; then
  echo "ALL REMOTE RELEASE ASSET CHECKS PASSED"
  exit 0
fi

METADATA_FILES=(latest.yml latest-mac.yml arm64-mac.yml win-arm64.yml latest-linux.yml arm64-linux.yml)
for metadata in "${METADATA_FILES[@]}"; do
  if [ ! -f "$ASSETS_DIR/$metadata" ]; then
    continue
  fi

  remote_metadata=$(mktemp)
  is_metadata_match=false
  for _attempt in 1 2 3 4 5 6; do
    curl "${CURL_ARGS[@]}" --output "$remote_metadata" "$BASE_URL/$metadata"
    if cmp -s "$ASSETS_DIR/$metadata" "$remote_metadata"; then
      is_metadata_match=true
      break
    fi
    sleep 2
  done
  if [ "$is_metadata_match" != "true" ]; then
    echo "FAIL: published metadata does not match local file: $metadata"
    rm -f "$remote_metadata"
    exit 1
  fi
  rm -f "$remote_metadata"
  echo "PASS: published metadata $metadata"
done

echo "ALL COS UPDATE FEED CHECKS PASSED"
