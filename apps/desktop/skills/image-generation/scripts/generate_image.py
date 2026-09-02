#!/usr/bin/env python3
"""Cross-platform image generation/editing helper for Sudowork."""

from __future__ import annotations

import base64
import json
import math
import mimetypes
import os
from pathlib import Path
import sys
import tempfile
from typing import Any
from urllib import request


GEMINI_IMAGE_MODELS = {
    "gemini-3.1-flash-image",
    "gemini-3-pro-image",
    "gemini-2.5-flash-image",
}
DEFAULT_SIZE = "1024x1024"


class ImageGenerationError(Exception):
    """Raised for expected user-facing failures."""


def main(argv: list[str]) -> int:
    try:
        invocation = parse_invocation(argv)
        run(invocation)
        return 0
    except ImageGenerationError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


def parse_invocation(argv: list[str]) -> dict[str, str]:
    mode = argv[1] if len(argv) > 1 else ""
    if mode not in {"gen", "edit"}:
        raise ImageGenerationError(usage())

    if mode == "gen":
        prompt = argv[2] if len(argv) > 2 else ""
        arg3 = argv[3] if len(argv) > 3 else ""
        arg4 = argv[4] if len(argv) > 4 else ""
        filename, size = ("", arg3) if is_size(arg3) else (arg3, arg4 or DEFAULT_SIZE)
        image_path = ""
    else:
        prompt = argv[2] if len(argv) > 2 else ""
        image_path = argv[3] if len(argv) > 3 else ""
        arg4 = argv[4] if len(argv) > 4 else ""
        arg5 = argv[5] if len(argv) > 5 else ""
        filename, size = ("", arg4) if is_size(arg4) else (arg4, arg5 or DEFAULT_SIZE)

    if not prompt:
        raise ImageGenerationError("prompt is required")
    if mode == "edit" and not image_path:
        raise ImageGenerationError("image_path is required for edit mode")
    if mode == "edit" and not Path(image_path).is_file():
        raise ImageGenerationError(f"Image file not found: {image_path}")

    return {"mode": mode, "prompt": prompt, "image_path": image_path, "filename": filename, "size": size}


def run(invocation: dict[str, str]) -> None:
    config = resolve_runtime_config()
    model = normalize_model(config.get("image_model", ""))
    base_url = config.get("base_url", "").rstrip("/")
    api_key = config.get("api_key", "")

    if not model:
        raise ImageGenerationError(
            "Image generation is unavailable because no image model is configured. "
            "Please set the image model in Tools settings."
        )
    if not base_url or not api_key:
        raise ImageGenerationError("Could not resolve API credentials from config or env vars")

    mode = invocation["mode"]
    prompt = invocation["prompt"]
    size = invocation["size"]
    print(f"[generate_image] MODE={mode} MODEL={model} SIZE={size}", file=sys.stderr)
    print(f"[generate_image] BASE_URL={base_url}", file=sys.stderr)
    print(f"[generate_image] Prompt: {prompt[:80]}", file=sys.stderr)

    if mode == "gen":
        response = generate_image(base_url, api_key, model, prompt, size)
    else:
        response = edit_image(base_url, api_key, model, prompt, invocation["image_path"], size)

    response_text = json.dumps(response, ensure_ascii=False)
    print(f"[generate_image] Response length: {len(response_text)}", file=sys.stderr)
    print(f"[generate_image] Response preview: {response_text[:200]}", file=sys.stderr)

    saved_file = save_response_image(response, invocation["filename"])
    add_watermark(saved_file)
    print(saved_file)


def resolve_runtime_config() -> dict[str, str]:
    config = resolve_config()
    if is_complete_config(config):
        return config

    env_config = {
        "image_model": normalize_model(os.environ.get("IMAGE_MODEL", "")),
        "base_url": os.environ.get("PROVIDER_BASE_URL", "").rstrip("/"),
        "api_key": os.environ.get("PROVIDER_API_KEY", ""),
    }
    if is_complete_config(env_config):
        return env_config

    return {
        "image_model": config.get("image_model") or env_config.get("image_model", ""),
        "base_url": config.get("base_url") or env_config.get("base_url", ""),
        "api_key": config.get("api_key") or env_config.get("api_key", ""),
    }


def is_complete_config(config: dict[str, str]) -> bool:
    return bool(config.get("image_model") and config.get("base_url") and config.get("api_key"))


def generate_image(base_url: str, api_key: str, model: str, prompt: str, size: str) -> dict[str, Any]:
    if is_gemini_image_model(model):
        endpoint = f"{gemini_base_url(base_url)}/models/{model}:generateContent"
        print(f"[generate_image] POST {endpoint}", file=sys.stderr)
        payload = {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {"responseModalities": ["IMAGE"], "imageConfig": image_config(size)},
        }
        return post_json(endpoint, api_key, payload)

    endpoint = f"{base_url}/images/generations"
    print(f"[generate_image] POST {endpoint}", file=sys.stderr)
    return post_json(endpoint, api_key, {"model": model, "prompt": prompt, "n": 1, "size": size})


def edit_image(base_url: str, api_key: str, model: str, prompt: str, image_path: str, size: str) -> dict[str, Any]:
    padded_path = pad_to_square(image_path)
    should_cleanup = padded_path != image_path
    if should_cleanup:
        print(f"[generate_image] Padded non-square image to square: {padded_path}", file=sys.stderr)

    try:
        if is_gemini_image_model(model):
            endpoint = f"{gemini_base_url(base_url)}/models/{model}:generateContent"
            print(f"[generate_image] POST {endpoint} (image: {padded_path})", file=sys.stderr)
            with open(padded_path, "rb") as file:
                image_bytes = file.read()
            mime_type = mimetypes.guess_type(padded_path)[0] or "image/png"
            payload = {
                "contents": [
                    {
                        "role": "user",
                        "parts": [
                            {"text": prompt},
                            {
                                "inlineData": {
                                    "mimeType": mime_type,
                                    "data": base64.b64encode(image_bytes).decode("ascii"),
                                }
                            },
                        ],
                    }
                ],
                "generationConfig": {"responseModalities": ["IMAGE"], "imageConfig": image_config(size)},
            }
            return post_json(endpoint, api_key, payload)

        endpoint = f"{base_url}/images/edits"
        print(f"[generate_image] POST {endpoint} (image: {padded_path})", file=sys.stderr)
        return post_multipart(
            endpoint,
            api_key,
            fields={"prompt": prompt, "model": model, "n": "1", "size": size},
            files={"image": padded_path},
        )
    finally:
        if should_cleanup:
            Path(padded_path).unlink(missing_ok=True)


def resolve_config() -> dict[str, str]:
    config: dict[str, str] = {}
    sudocode_config = Path(os.environ.get("SUDOCODE_CONFIG_PATH", Path.home() / ".nexus/sudocode/sudocode.json"))
    sudocode_data: dict[str, Any] = {}
    if sudocode_config.is_file():
        sudocode_data = read_json(sudocode_config)
        image_model = str(sudocode_data.get("tools", {}).get("imageGenerationModel", ""))
        external_config = resolve_external_image_config(sudocode_data, image_model)
        if external_config:
            config.update(external_config)
        else:
            sudorouter = sudocode_data.get("auth_modes", {}).get("proxy", {}).get("sudorouter", {})
            config.update(
                {
                    "base_url": str(sudorouter.get("baseUrl", "")).rstrip("/"),
                    "api_key": str(sudorouter.get("apiKey", "")),
                    "image_model": image_model,
                }
            )

    sudoclaw_path = os.environ.get("SUDOCLAW_CONFIG_PATH")
    if not config.get("api_key") and sudoclaw_path and Path(sudoclaw_path).is_file():
        data = read_json(Path(sudoclaw_path))
        image_model = str(data.get("agents", {}).get("defaults", {}).get("imageGenerationModel", ""))
        external_config = resolve_external_image_config(sudocode_data, image_model)
        if external_config:
            config.update(external_config)
        else:
            sudorouter = data.get("models", {}).get("providers", {}).get("sudorouter", {})
            config.update(
                {
                    "base_url": str(sudorouter.get("baseUrl", "")).rstrip("/"),
                    "api_key": str(sudorouter.get("apiKey", "")),
                    "image_model": image_model,
                }
            )

    config["image_model"] = normalize_model(config.get("image_model", ""))
    return config


def resolve_external_image_config(data: dict[str, Any], image_model: str) -> dict[str, str] | None:
    model_ref = parse_custom_image_model_ref(image_model)
    if not model_ref:
        return None

    provider_id, model_id = model_ref
    provider = data.get("auth_modes", {}).get("api-key", {}).get(provider_id, {})
    base_url = str(provider.get("baseUrl", "")).strip().rstrip("/")
    api_key = str(provider.get("apiKey", "")).strip()
    if not base_url or not api_key:
        return None

    return {"base_url": base_url, "api_key": api_key, "image_model": model_id}


def parse_custom_image_model_ref(value: str) -> tuple[str, str] | None:
    index = value.find("/")
    if index <= 0 or index == len(value) - 1:
        return None
    return value[:index], value[index + 1 :]


def read_json(path: Path) -> dict[str, Any]:
    try:
        with path.open("r", encoding="utf-8") as file:
            data = json.load(file)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def post_json(endpoint: str, api_key: str, payload: dict[str, Any]) -> dict[str, Any]:
    data = json.dumps(payload).encode("utf-8")
    req = request.Request(
        endpoint,
        data=data,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
        method="POST",
    )
    return read_response(req)


def post_multipart(endpoint: str, api_key: str, fields: dict[str, str], files: dict[str, str]) -> dict[str, Any]:
    boundary = f"----sudowork-{os.urandom(12).hex()}"
    chunks: list[bytes] = []
    for name, value in fields.items():
        chunks.extend(
            [
                f"--{boundary}\r\n".encode("utf-8"),
                f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode("utf-8"),
                str(value).encode("utf-8"),
                b"\r\n",
            ]
        )
    for name, path in files.items():
        file_path = Path(path)
        mime_type = mimetypes.guess_type(path)[0] or "application/octet-stream"
        chunks.extend(
            [
                f"--{boundary}\r\n".encode("utf-8"),
                (
                    f'Content-Disposition: form-data; name="{name}"; '
                    f'filename="{file_path.name}"\r\nContent-Type: {mime_type}\r\n\r\n'
                ).encode("utf-8"),
                file_path.read_bytes(),
                b"\r\n",
            ]
        )
    chunks.append(f"--{boundary}--\r\n".encode("utf-8"))
    req = request.Request(
        endpoint,
        data=b"".join(chunks),
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}", "Authorization": f"Bearer {api_key}"},
        method="POST",
    )
    return read_response(req)


def read_response(req: request.Request) -> dict[str, Any]:
    try:
        with request.urlopen(req, timeout=180) as resp:
            body = resp.read()
    except Exception as exc:
        raise ImageGenerationError(str(exc)) from exc

    try:
        parsed = json.loads(body.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise ImageGenerationError(f"API returned non-JSON response: {body[:200]!r}") from exc
    if not isinstance(parsed, dict):
        raise ImageGenerationError("API returned an unexpected response shape")
    return parsed


def save_response_image(response: dict[str, Any], filename_stem: str) -> str:
    if "error" in response:
        error = response["error"]
        if isinstance(error, dict):
            raise ImageGenerationError(str(error.get("message") or json.dumps(error, ensure_ascii=False)))
        raise ImageGenerationError(str(error))

    image_bytes = extract_image_bytes(response)
    if image_bytes is None:
        raise ImageGenerationError("No image data in response")

    ext = detect_extension(image_bytes)
    filename = f"{filename_stem}.{ext}" if filename_stem else f"image.{ext}"
    path = avoid_overwrite(Path(filename))
    if str(path.parent) not in {"", "."}:
        path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(image_bytes)
    print(f"[generate_image] Saved: {path} ({len(image_bytes)} bytes)", file=sys.stderr)
    return str(path)


def extract_image_bytes(response: dict[str, Any]) -> bytes | None:
    data = response.get("data", [])
    if isinstance(data, list) and data:
        item = data[0]
        if isinstance(item, dict):
            if item.get("b64_json"):
                return base64.b64decode(item["b64_json"])
            if item.get("url"):
                print(f"[generate_image] Downloading from URL: {str(item['url'])[:80]}", file=sys.stderr)
                with request.urlopen(str(item["url"]), timeout=180) as resp:
                    return resp.read()

    for candidate in response.get("candidates", []):
        if not isinstance(candidate, dict):
            continue
        parts = candidate.get("content", {}).get("parts", [])
        for part in parts:
            if not isinstance(part, dict):
                continue
            inline = part.get("inlineData") or part.get("inline_data") or {}
            if inline.get("data"):
                return base64.b64decode(inline["data"])
    return None


def add_watermark(path: str) -> None:
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        print("[watermark] PIL not available, skipping watermark", file=sys.stderr)
        return

    text = os.environ.get("WATERMARK_TEXT", "Sudo Code")
    scale = float(os.environ.get("WATERMARK_SCALE", "0.8"))
    img = Image.open(path).convert("RGBA")
    width, height = img.size
    font_size = max(int(min(width, height) * scale * 0.05), 12)
    font = load_font(ImageFont, font_size)

    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    bbox = draw.textbbox((0, 0), text, font=font)
    text_width, text_height = bbox[2] - bbox[0], bbox[3] - bbox[1]
    padding = int(min(width, height) * 0.02)
    x = width - text_width - padding
    y = height - text_height - padding
    draw.text((x + 1, y + 1), text, font=font, fill=(0, 0, 0, 128))
    draw.text((x, y), text, font=font, fill=(255, 255, 255, 230))
    Image.alpha_composite(img, layer).convert("RGB").save(path)
    print(f'[watermark] Added "{text}" at {x},{y} font_size={font_size}', file=sys.stderr)


def load_font(image_font: Any, font_size: int) -> Any:
    font_candidates = [
        "/System/Library/Fonts/Helvetica.ttc",
        "C:/Windows/Fonts/arial.ttf",
        "C:/Windows/Fonts/segoeui.ttf",
    ]
    for candidate in font_candidates:
        try:
            return image_font.truetype(candidate, font_size)
        except Exception:
            pass
    return image_font.load_default()


def pad_to_square(path: str) -> str:
    try:
        from PIL import Image
    except ImportError:
        print("[generate_image] PIL not available, using source image without padding", file=sys.stderr)
        return path

    img = Image.open(path)
    width, height = img.size
    if width == height:
        return path

    side = max(width, height)
    mode = img.mode if img.mode in {"RGBA", "LA"} else "RGB"
    bg_color = (255, 255, 255, 0) if mode == "RGBA" else (255, 255, 255)
    canvas = Image.new(mode, (side, side), bg_color)
    offset = ((side - width) // 2, (side - height) // 2)
    canvas.paste(img, offset)

    suffix = Path(path).suffix or ".png"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as temp:
        temp_path = temp.name
    save_format = "PNG" if mode == "RGBA" else None
    canvas.save(temp_path, format=save_format)
    return temp_path


def image_config(size: str) -> dict[str, str]:
    try:
        width, height = [int(value) for value in size.lower().split("x", 1)]
        if width <= 0 or height <= 0:
            raise ValueError
        divisor = math.gcd(width, height)
        image_size = "2K" if max(width, height) > 1024 else "1K"
        return {"aspectRatio": f"{width // divisor}:{height // divisor}", "imageSize": image_size}
    except Exception:
        return {"aspectRatio": "1:1", "imageSize": "1K"}


def avoid_overwrite(path: Path) -> Path:
    if not path.exists():
        return path
    stem = path.with_suffix("")
    suffix = path.suffix
    index = 2
    while True:
        candidate = Path(f"{stem}_{index}{suffix}")
        if not candidate.exists():
            return candidate
        index += 1


def detect_extension(image_bytes: bytes) -> str:
    if image_bytes[:3] == b"\xff\xd8\xff":
        return "jpg"
    if image_bytes[:4] == b"RIFF" and image_bytes[8:12] == b"WEBP":
        return "webp"
    return "png"


def gemini_base_url(base_url: str) -> str:
    base = base_url.rstrip("/")
    if base.endswith("/v1"):
        return f"{base[:-3]}/v1beta"
    if base.endswith("/v1beta"):
        return base
    return f"{base}/v1beta"


def is_gemini_image_model(model: str) -> bool:
    return model in GEMINI_IMAGE_MODELS


def normalize_model(model: str) -> str:
    return model.strip()


def is_size(value: str) -> bool:
    if "x" not in value:
        return False
    width, height = value.split("x", 1)
    return width.isdigit() and height.isdigit()


def usage() -> str:
    return (
        'Usage:\n'
        '  generate_image.py gen "<prompt>" [<filename_no_ext>] [size]\n'
        '  generate_image.py edit "<prompt>" "<image_path>" [<filename_no_ext>] [size]'
    )


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
