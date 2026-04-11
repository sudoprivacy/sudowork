#!/usr/bin/env bash
# Sudowork built-in image analysis script
# Usage: analyze_image.sh <image_path> [prompt]
# Reads config from sudoclaw.json via SUDOCLAW_CONFIG_PATH (required) env var.
# Overrides with optional env vars: PROVIDER_BASE_URL, PROVIDER_API_KEY, CHAT_MODEL

set -euo pipefail

IMAGE_PATH="${1:-}"
PROMPT="${2:-Describe this image in detail.}"

if [ -z "$IMAGE_PATH" ]; then
  echo "Usage: analyze_image.sh <image_path> [prompt]" >&2
  exit 1
fi

if [ ! -f "$IMAGE_PATH" ]; then
  echo "Error: Image file not found: $IMAGE_PATH" >&2
  exit 1
fi

# Read BASE_URL, API_KEY, and MODEL from sudoclaw.json (with env var overrides)
if [ -n "${SUDOCLAW_CONFIG_PATH:-}" ] && [ -f "$SUDOCLAW_CONFIG_PATH" ]; then
  eval "$(python3 -c "
import json, sys
try:
    c = json.load(open(sys.argv[1]))
    sr = c.get('models',{}).get('providers',{}).get('sudorouter',{})
    base_url = sr.get('baseUrl','')
    api_key = sr.get('apiKey','')
    m = c.get('agents',{}).get('defaults',{}).get('model',{}).get('primary','')
    model = m.split('/')[-1] if '/' in m else m
    print(f'_CFG_BASE_URL={repr(base_url.rstrip(\"/\"))}')
    print(f'_CFG_API_KEY={repr(api_key)}')
    print(f'_CFG_MODEL={repr(model)}')
except: pass
" "$SUDOCLAW_CONFIG_PATH" 2>/dev/null)"
fi

BASE_URL="${PROVIDER_BASE_URL:-${_CFG_BASE_URL:-}}"
API_KEY="${PROVIDER_API_KEY:-${_CFG_API_KEY:-}}"
MODEL="${CHAT_MODEL:-${_CFG_MODEL:-gemini-2.5-flash}}"

if [ -z "$BASE_URL" ] || [ -z "$API_KEY" ]; then
  echo "Error: Could not resolve PROVIDER_BASE_URL and PROVIDER_API_KEY from config or env vars" >&2
  exit 1
fi

echo "[analyze_image] IMAGE_PATH=$IMAGE_PATH" >&2
echo "[analyze_image] BASE_URL=$BASE_URL" >&2
echo "[analyze_image] MODEL=$MODEL" >&2
echo "[analyze_image] File size: $(wc -c < "$IMAGE_PATH") bytes" >&2

ENDPOINT="${BASE_URL}/chat/completions"

echo "[analyze_image] Endpoint: $ENDPOINT" >&2
echo "[analyze_image] Prompt: $PROMPT" >&2

# Build JSON payload via python (reads image file directly to avoid arg size limits)
# and pipe to curl
RESPONSE=$(python3 -c "
import json, sys, base64

image_path = sys.argv[1]
prompt = sys.argv[2]
model = sys.argv[3]

with open(image_path, 'rb') as f:
    h = f.read(12)
    f.seek(0)
    image_data = f.read()

# Detect MIME type from magic bytes
if h[:4] == b'\x89PNG':
    mime = 'image/png'
elif h[:3] == b'\xff\xd8\xff':
    mime = 'image/jpeg'
elif h[:4] == b'RIFF' and h[8:12] == b'WEBP':
    mime = 'image/webp'
elif h[:4] == b'GIF8':
    mime = 'image/gif'
else:
    mime = 'image/png'

b64 = base64.b64encode(image_data).decode('ascii')
print(f'[analyze_image] MIME={mime}, b64_len={len(b64)}', file=sys.stderr)

payload = {
    'model': model,
    'messages': [{
        'role': 'user',
        'content': [
            {'type': 'text', 'text': prompt},
            {'type': 'image_url', 'image_url': {'url': f'data:{mime};base64,{b64}'}}
        ]
    }]
}
sys.stdout.write(json.dumps(payload))
" "$IMAGE_PATH" "$PROMPT" "$MODEL" | \
  curl -s -X POST "$ENDPOINT" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $API_KEY" \
    --data-binary @-)

echo "[analyze_image] Response length: ${#RESPONSE}" >&2
echo "[analyze_image] Response preview: ${RESPONSE:0:200}" >&2

# Extract the response content
echo "$RESPONSE" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    content = d.get('choices', [{}])[0].get('message', {}).get('content', '')
    if content:
        print(content)
    else:
        error = d.get('error', {}).get('message', json.dumps(d))
        print(f'Error: {error}', file=sys.stderr)
        sys.exit(1)
except Exception as e:
    print(f'Error parsing response: {e}', file=sys.stderr)
    sys.exit(1)
"
