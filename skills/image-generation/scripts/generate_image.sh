#!/usr/bin/env bash
# Sudowork image generation/editing script
# Usage:
#   generate_image.sh gen "<prompt>" [size]
#   generate_image.sh edit "<prompt>" "<image_path>" [size]
# Reads config from sudoclaw.json via OPENCLAW_CONFIG_PATH env var.
# IMAGE_MODEL is read from agents.defaults.model.image in sudoclaw.json.
# Overrides: PROVIDER_BASE_URL, PROVIDER_API_KEY, IMAGE_MODEL

set -euo pipefail

MODE="${1:-}"
if [ "$MODE" != "gen" ] && [ "$MODE" != "edit" ]; then
  echo "Usage:" >&2
  echo "  generate_image.sh gen \"<prompt>\" [size]" >&2
  echo "  generate_image.sh edit \"<prompt>\" \"<image_path>\" [size]" >&2
  exit 1
fi

if [ "$MODE" = "gen" ]; then
  PROMPT="${2:-}"
  IMAGE_PATH=""
  SIZE="${3:-1024x1024}"
else
  PROMPT="${2:-}"
  IMAGE_PATH="${3:-}"
  SIZE="${4:-1024x1024}"
fi

if [ -z "$PROMPT" ]; then
  echo "Error: prompt is required" >&2
  exit 1
fi

if [ "$MODE" = "edit" ] && [ -z "$IMAGE_PATH" ]; then
  echo "Error: image_path is required for edit mode" >&2
  exit 1
fi

if [ "$MODE" = "edit" ] && [ ! -f "$IMAGE_PATH" ]; then
  echo "Error: Image file not found: $IMAGE_PATH" >&2
  exit 1
fi

# Read BASE_URL, API_KEY, and IMAGE_MODEL from sudoclaw.json (with env var overrides)
if [ -n "${OPENCLAW_CONFIG_PATH:-}" ] && [ -f "$OPENCLAW_CONFIG_PATH" ]; then
  eval "$(python3 -c "
import json, sys
try:
    c = json.load(open(sys.argv[1]))
    sr = c.get('models',{}).get('providers',{}).get('sudorouter',{})
    base_url = sr.get('baseUrl','')
    api_key = sr.get('apiKey','')
    image_model = c.get('agents',{}).get('defaults',{}).get('model',{}).get('image','')
    print(f'_CFG_BASE_URL={repr(base_url.rstrip(\"/\"))}')
    print(f'_CFG_API_KEY={repr(api_key)}')
    print(f'_CFG_IMAGE_MODEL={repr(image_model)}')
except: pass
" "$OPENCLAW_CONFIG_PATH" 2>/dev/null)"
fi

BASE_URL="${PROVIDER_BASE_URL:-${_CFG_BASE_URL:-}}"
API_KEY="${PROVIDER_API_KEY:-${_CFG_API_KEY:-}}"
MODEL="${IMAGE_MODEL:-${_CFG_IMAGE_MODEL:-}}"

if [ -z "$MODEL" ]; then
  echo "Error: Image generation is unavailable because no image model is configured. Please set the image model in Tools settings." >&2
  exit 1
fi

if [ -z "$BASE_URL" ] || [ -z "$API_KEY" ]; then
  echo "Error: Could not resolve API credentials from config or env vars" >&2
  exit 1
fi

echo "[generate_image] MODE=$MODE MODEL=$MODEL SIZE=$SIZE" >&2
echo "[generate_image] BASE_URL=$BASE_URL" >&2
echo "[generate_image] Prompt: ${PROMPT:0:80}" >&2

if [ "$MODE" = "gen" ]; then
  # --- Image Generation ---
  ENDPOINT="${BASE_URL}/images/generations"
  echo "[generate_image] POST $ENDPOINT" >&2

  RESPONSE=$(python3 -c "
import json, sys
payload = {
    'model': sys.argv[1],
    'prompt': sys.argv[2],
    'n': 1,
    'size': sys.argv[3]
}
sys.stdout.write(json.dumps(payload))
" "$MODEL" "$PROMPT" "$SIZE" | \
    curl -s -X POST "$ENDPOINT" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $API_KEY" \
      --data-binary @-)

else
  # --- Image Edit ---
  ENDPOINT="${BASE_URL}/images/edits"
  echo "[generate_image] POST $ENDPOINT (image: $IMAGE_PATH)" >&2

  RESPONSE=$(curl -s -X POST "$ENDPOINT" \
    -H "Authorization: Bearer $API_KEY" \
    -F "image=@${IMAGE_PATH}" \
    -F "prompt=${PROMPT}" \
    -F "model=${MODEL}" \
    -F "n=1" \
    -F "size=${SIZE}")
fi

echo "[generate_image] Response length: ${#RESPONSE}" >&2
echo "[generate_image] Response preview: ${RESPONSE:0:200}" >&2

# Extract image data, save to file, and print the path
# Response is piped via stdin to avoid OS command-line arg size limits (b64 data can be 2.5MB+)
echo "$RESPONSE" | python3 -c "
import json, sys, base64, re, os, urllib.request

response = json.load(sys.stdin)
prompt = sys.argv[1]
size = sys.argv[2]

# Check for error
if 'error' in response:
    print(f'Error: {response[\"error\"].get(\"message\", json.dumps(response[\"error\"]))}', file=sys.stderr)
    sys.exit(1)

data = response.get('data', [])
if not data:
    print('Error: No image data in response', file=sys.stderr)
    sys.exit(1)

item = data[0]
image_bytes = None

if item.get('b64_json'):
    image_bytes = base64.b64decode(item['b64_json'])
elif item.get('url'):
    url = item['url']
    print(f'[generate_image] Downloading from URL: {url[:80]}', file=sys.stderr)
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req) as resp:
        image_bytes = resp.read()
else:
    print('Error: Response contains neither b64_json nor url', file=sys.stderr)
    sys.exit(1)

# Detect format from magic bytes
ext = 'png'
if image_bytes[:3] == b'\xff\xd8\xff':
    ext = 'jpg'
elif image_bytes[:4] == b'RIFF' and image_bytes[8:12] == b'WEBP':
    ext = 'webp'

# Build meaningful filename from prompt
slug = re.sub(r'[^a-zA-Z0-9\u4e00-\u9fff]+', '_', prompt).strip('_')[:40].rstrip('_')
filename = f'{slug}_{size}.{ext}'

# Avoid overwriting
if os.path.exists(filename):
    base, dot_ext = os.path.splitext(filename)
    i = 2
    while os.path.exists(f'{base}_{i}{dot_ext}'):
        i += 1
    filename = f'{base}_{i}{dot_ext}'

with open(filename, 'wb') as f:
    f.write(image_bytes)

print(f'[generate_image] Saved: {filename} ({len(image_bytes)} bytes)', file=sys.stderr)
print(filename)
" "$PROMPT" "$SIZE"
