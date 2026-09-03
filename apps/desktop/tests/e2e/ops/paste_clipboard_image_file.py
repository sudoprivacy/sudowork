"""Attach an image to the chat textarea by synthesizing a real ClipboardEvent.

Bridges the gap left by `acp-image-vlm-fallback.yaml`'s "GATED on a new e2e op"
note. Uses the same technique proven interactively 2026-07-01 via
ai-dev-browser: read the image from disk on the harness side, base64 it,
reconstruct as a `File` in the renderer, wrap in a `DataTransfer`, and
dispatch `paste` on the focused chat textarea. Sudowork's PasteService
(`packages/renderer/src/services/PasteService.ts`) picks up `event.clipboardData.files`
and drives the same IPC path a human paste triggers.

Rejects `type="file"` <input> approach: sudowork's chat textarea has no such
element; only the paste / drag-drop code paths reach the PasteService.

Args:
  path: Absolute path to a local image file on the harness machine.
  wait: Seconds to wait after paste for sudowork's temp-file write to settle.
"""

import asyncio
import base64
import mimetypes
from pathlib import Path

from ai_dev_browser.core.page import js_evaluate


async def paste_clipboard_image_file(tab, path: str, wait: float = 2.0) -> dict:
    p = Path(path)
    if not p.exists():
        return {"error": f"file not found: {path}", "pass": False}

    mime, _ = mimetypes.guess_type(p.name)
    if not mime or not mime.startswith("image/"):
        mime = "image/png"
    b64 = base64.b64encode(p.read_bytes()).decode("ascii")
    label = p.name

    js = f"""(async () => {{
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const bin = atob({b64!r});
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], {{ type: {mime!r} }});
      const file = new File([blob], {label!r}, {{ type: {mime!r} }});
      const ta = Array.from(document.querySelectorAll('textarea'))
        .find(t => t.offsetHeight > 0 && t.offsetWidth > 0);
      if (!ta) return {{ pass: false, error: 'no visible chat textarea' }};
      ta.focus();
      const dt = new DataTransfer();
      dt.items.add(file);
      ta.dispatchEvent(new ClipboardEvent('paste', {{ clipboardData: dt, bubbles: true, cancelable: true }}));
      await wait(200);
      return {{ pass: true, fileSize: file.size, name: file.name }};
    }})()"""

    r = await tab.evaluate(js, await_promise=True, return_by_value=True, timeout=60)
    await asyncio.sleep(wait)
    if isinstance(r, dict) and r.get("pass"):
        return {"pasted": True, "file_size": r.get("fileSize"), "name": r.get("name"), "pass": True}
    return {"error": (r.get("error") if isinstance(r, dict) else str(r)), "pass": False}
