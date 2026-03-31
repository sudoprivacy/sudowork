#!/usr/bin/env bash
# Sudowork built-in image analysis script
# Usage: analyze_image.sh <image_path> [prompt]
# Requires env vars: SUDOROUTER_BASE_URL, SUDOROUTER_API_KEY, SUDOROUTER_MODEL

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

# Require env vars — no fallback to config files
if [ -z "${SUDOROUTER_BASE_URL:-}" ] || [ -z "${SUDOROUTER_API_KEY:-}" ]; then
  echo "Error: SUDOROUTER_BASE_URL and SUDOROUTER_API_KEY env vars are required" >&2
  exit 1
fi

BASE_URL="${SUDOROUTER_BASE_URL}"
API_KEY="${SUDOROUTER_API_KEY}"
MODEL="${SUDOROUTER_MODEL:-gemini-2.5-flash}"

echo "[analyze_image] IMAGE_PATH=$IMAGE_PATH" >&2
echo "[analyze_image] BASE_URL=$BASE_URL" >&2
echo "[analyze_image] MODEL=$MODEL" >&2
echo "[analyze_image] File size: $(wc -c < "$IMAGE_PATH") bytes" >&2

# Detect MIME type from magic bytes
MIME_TYPE=$(python3 -c "
import sys
with open(sys.argv[1], 'rb') as f:
    h = f.read(12)
if h[:4] == b'\x89PNG':
    print('image/png')
elif h[:3] == b'\xff\xd8\xff':
    print('image/jpeg')
elif h[:4] == b'RIFF' and h[8:12] == b'WEBP':
    print('image/webp')
elif h[:4] == b'GIF8':
    print('image/gif')
else:
    print('image/png')
" "$IMAGE_PATH")

# Base64-encode the image
B64_IMAGE=$(base64 < "$IMAGE_PATH" | tr -d '\n')
echo "[analyze_image] MIME_TYPE=$MIME_TYPE" >&2
echo "[analyze_image] Base64 length: ${#B64_IMAGE}" >&2

ENDPOINT="${BASE_URL}/chat/completions"

echo "[analyze_image] Endpoint: $ENDPOINT" >&2
echo "[analyze_image] Prompt: $PROMPT" >&2

# Build JSON payload via python and pipe to curl to avoid shell arg size limits
RESPONSE=$(python3 -c "
import json, sys
prompt = sys.argv[1]
mime = sys.argv[2]
b64 = sys.argv[3]
model = sys.argv[4]
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
" "$PROMPT" "$MIME_TYPE" "$B64_IMAGE" "$MODEL" | \
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
