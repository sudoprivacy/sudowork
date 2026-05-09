#!/usr/bin/env bash
# Sudowork image generation/editing script
# Usage:
#   generate_image.sh gen "<prompt>" [<filename_no_ext>] [size]
#   generate_image.sh edit "<prompt>" "<image_path>" [<filename_no_ext>] [size]
# Reads config from sudoclaw.json via SUDOCLAW_CONFIG_PATH env var.
# IMAGE_MODEL is read from agents.defaults.imageGenerationModel in sudoclaw.json.
# (Note: agents.defaults.imageModel is the image *parsing* model for the gateway;
#  image generation uses the separate imageGenerationModel field.)
# Any leading "provider/" prefix is stripped before sending to /images/generations.
# Overrides: PROVIDER_BASE_URL, PROVIDER_API_KEY, IMAGE_MODEL

set -euo pipefail

MODE="${1:-}"
if [ "$MODE" != "gen" ] && [ "$MODE" != "edit" ]; then
  echo "Usage:" >&2
  echo "  generate_image.sh gen \"<prompt>\" [<filename_no_ext>] [size]" >&2
  echo "  generate_image.sh edit \"<prompt>\" \"<image_path>\" [<filename_no_ext>] [size]" >&2
  exit 1
fi

# Helper: detect if an arg looks like a size (e.g. 1024x1024)
is_size() { [[ "$1" =~ ^[0-9]+x[0-9]+$ ]]; }

if [ "$MODE" = "gen" ]; then
  PROMPT="${2:-}"
  IMAGE_PATH=""
  # arg3: filename or size
  ARG3="${3:-}"
  ARG4="${4:-}"
  if is_size "$ARG3"; then
    FILENAME=""
    SIZE="$ARG3"
  else
    FILENAME="$ARG3"
    SIZE="${ARG4:-1024x1024}"
  fi
else
  PROMPT="${2:-}"
  IMAGE_PATH="${3:-}"
  # arg4: filename or size
  ARG4="${4:-}"
  ARG5="${5:-}"
  if is_size "$ARG4"; then
    FILENAME=""
    SIZE="$ARG4"
  else
    FILENAME="$ARG4"
    SIZE="${ARG5:-1024x1024}"
  fi
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

# Read BASE_URL, API_KEY, and IMAGE_MODEL from config files (with env var overrides)
# Priority: sudocode.json (new), fallback to sudoclaw.json (legacy)
_SUDOCODE_CFG="${SUDOCODE_CONFIG_PATH:-$HOME/.nexus/sudocode/sudocode.json}"
if [ -f "$_SUDOCODE_CFG" ]; then
  eval "$(python3 -c "
import json, sys
try:
    c = json.load(open(sys.argv[1]))
    sr = c.get('auth_modes',{}).get('proxy',{}).get('sudorouter',{})
    base_url = sr.get('baseUrl','')
    api_key = sr.get('apiKey','')
    image_model = c.get('tools',{}).get('imageGenerationModel','')
    if isinstance(image_model, str) and '/' in image_model:
        image_model = image_model.rsplit('/', 1)[-1]
    print(f'_CFG_BASE_URL={repr(base_url.rstrip(\"/\"))}')
    print(f'_CFG_API_KEY={repr(api_key)}')
    print(f'_CFG_IMAGE_MODEL={repr(image_model)}')
except: pass
" "$_SUDOCODE_CFG" 2>/dev/null)"
fi

# Fallback: sudoclaw.json (legacy)
if [ -z "${_CFG_API_KEY:-}" ] && [ -n "${SUDOCLAW_CONFIG_PATH:-}" ] && [ -f "$SUDOCLAW_CONFIG_PATH" ]; then
  eval "$(python3 -c "
import json, sys
try:
    c = json.load(open(sys.argv[1]))
    sr = c.get('models',{}).get('providers',{}).get('sudorouter',{})
    base_url = sr.get('baseUrl','')
    api_key = sr.get('apiKey','')
    image_model = c.get('agents',{}).get('defaults',{}).get('imageGenerationModel','')
    if isinstance(image_model, str) and '/' in image_model:
        image_model = image_model.rsplit('/', 1)[-1]
    print(f'_CFG_BASE_URL={repr(base_url.rstrip(\"/\"))}')
    print(f'_CFG_API_KEY={repr(api_key)}')
    print(f'_CFG_IMAGE_MODEL={repr(image_model)}')
except: pass
" "$SUDOCLAW_CONFIG_PATH" 2>/dev/null)"
fi

BASE_URL="${PROVIDER_BASE_URL:-${_CFG_BASE_URL:-}}"
API_KEY="${PROVIDER_API_KEY:-${_CFG_API_KEY:-}}"
MODEL="${IMAGE_MODEL:-${_CFG_IMAGE_MODEL:-}}"

# Strip any leading "provider/" prefix; sudorouter /images/generations expects the bare model id.
# (Defensive: handles IMAGE_MODEL env overrides and any future writer that keeps the prefix.)
if [[ "$MODEL" == */* ]]; then
  MODEL="${MODEL##*/}"
fi

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

  # Pad non-square images to a square with white background so the full image
  # fits in the output without cropping (letterbox for landscape, pillarbox for portrait).
  PADDED_PATH=$(python3 -c "
import sys
from PIL import Image

src = sys.argv[1]
img = Image.open(src)
w, h = img.size

if w == h:
    print(src)
    sys.exit(0)

side = max(w, h)
# Use RGBA if source has alpha, else RGB
mode = img.mode if img.mode in ('RGBA', 'LA') else 'RGB'
bg_color = (255, 255, 255, 0) if mode == 'RGBA' else (255, 255, 255)
canvas = Image.new(mode, (side, side), bg_color)
offset = ((side - w) // 2, (side - h) // 2)
canvas.paste(img, offset)

import tempfile, os
ext = os.path.splitext(src)[1] or '.png'
tmp = tempfile.NamedTemporaryFile(suffix=ext, delete=False)
# PNG preserves transparency; for JPEG use RGB
save_fmt = 'PNG' if mode == 'RGBA' else None
canvas.save(tmp.name, format=save_fmt)
print(tmp.name)
" "$IMAGE_PATH")

  CLEANUP_PADDED=""
  if [ "$PADDED_PATH" != "$IMAGE_PATH" ]; then
    echo "[generate_image] Padded non-square image to square: $PADDED_PATH" >&2
    CLEANUP_PADDED="$PADDED_PATH"
  fi

  RESPONSE=$(curl -s -X POST "$ENDPOINT" \
    -H "Authorization: Bearer $API_KEY" \
    -F "image=@${PADDED_PATH}" \
    -F "prompt=${PROMPT}" \
    -F "model=${MODEL}" \
    -F "n=1" \
    -F "size=${SIZE}")

  [ -n "$CLEANUP_PADDED" ] && rm -f "$CLEANUP_PADDED"
fi

echo "[generate_image] Response length: ${#RESPONSE}" >&2
echo "[generate_image] Response preview: ${RESPONSE:0:200}" >&2

WATERMARK_TEXT="${WATERMARK_TEXT:-Sudo Code}"

# Add watermark to image
add_watermark() {
  python3 -c "
import sys, os
try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    print('[watermark] PIL not available, skipping watermark', file=sys.stderr)
    sys.exit(0)

path = sys.argv[1]
text = sys.argv[2]
scale = float(sys.argv[3])

img = Image.open(path).convert('RGBA')
w, h = img.size

# Font size scales with image size, min 12px
font_size = max(int(min(w, h) * scale * 0.05), 12)

try:
    font = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', font_size)
except:
    font = ImageFont.load_default()

# Add text shadow for readability on any background
txt_layer = Image.new('RGBA', img.size, (0, 0, 0, 0))
draw = ImageDraw.Draw(txt_layer)

# Position: bottom-right with padding
bbox = draw.textbbox((0, 0), text, font=font)
tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
padding = int(min(w, h) * 0.02)
x = w - tw - padding
y = h - th - padding

# Shadow
draw.text((x + 1, y + 1), text, font=font, fill=(0, 0, 0, 128))
# Main text (white with dark outline)
draw.text((x, y), text, font=font, fill=(255, 255, 255, 230))

out = Image.alpha_composite(img, txt_layer)
out.convert('RGB').save(path)
print(f'[watermark] Added \"{text}\" at {x},{y} font_size={font_size}', file=sys.stderr)
" "$1" "$WATERMARK_TEXT" "${WATERMARK_SCALE:-0.8}"
}

# Extract image data, save to file, and print the path
# Response is piped via stdin to avoid OS command-line arg size limits (b64 data can be 2.5MB+)
SAVED_FILE=$(echo "$RESPONSE" | python3 -c "
import json, sys, base64, os, urllib.request

response = json.load(sys.stdin)
filename_stem = sys.argv[1]  # may be empty string

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

if filename_stem:
    dirpart = os.path.dirname(filename_stem)
    if dirpart:
        os.makedirs(dirpart, exist_ok=True)
    filename = f'{filename_stem}.{ext}'
else:
    filename = f'image.{ext}'

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
" "$FILENAME")

# Add watermark after save (non-fatal — skip if PIL unavailable)
if [ -f "$SAVED_FILE" ]; then
  add_watermark "$SAVED_FILE" || echo "[generate_image] Watermark skipped (PIL unavailable)" >&2
fi

# Print saved file path to stdout so the caller (scode) can display the image
echo "$SAVED_FILE"
