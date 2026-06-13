"""sudowork F1 pwd-login filler.

Spawned by sudowork-main (pwdLoginService.dispatchPwdFill) to perform the actual
login form fill in the ALREADY-RUNNING browser the agent used to explore the site.

Security model (see docs/plans/2026-06-13-pwd-login-autofill-design.md):
  - The plaintext password arrives ONLY on stdin (never argv/disk/env). main reads
    it from the Vault and pipes it here; main is this process's parent.
  - We type it into the page via real input events and NEVER print it, never return
    it, never read the password field's value back. (Python can't truly zero a str,
    so an immutable-str residue is acknowledged — same as the TS side.)
  - The captcha image is NOT secret: we screenshot it and ask the configured vision
    model (sudowork's image-analysis path) to read the digits.

Non-secret config (url + CSS selectors + username + browser port + vision creds)
arrives via --config <json-file>. Result is a single JSON object on stdout:
  {"ok": true, "navigated": true, "url_after": "..."}  on success
  {"ok": false, "error": "..."}                          otherwise
Exit code mirrors ok (0/1). Must never hang.

Selectors are CSS (e.g. "#txtAccount"). Typing = focus the element (fires onfocus,
e.g. a type=text→password switch) + CDP Input.insertText (real input event); the
site's own submit JS (e.g. client-side password encryption) runs when we click the
real submit button.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import os
import sys
import tempfile
import urllib.request


def _eprint(*a: object) -> None:
    print(*a, file=sys.stderr, flush=True)


async def _eval(tab, expr: str):
    """Run JS, return the `result` value (js_evaluate wraps it in a dict)."""
    from ai_dev_browser.core import js_evaluate

    out = await js_evaluate(tab, expr)
    return out.get("result") if isinstance(out, dict) else out


async def _focus_and_type(tab, selector: str, text: str) -> bool:
    """Focus a CSS-selected input (fires onfocus), clear it, then type via real
    CDP insertText. Returns False if the element wasn't found."""
    from ai_dev_browser.cdp import input_ as cdp_input

    found = await _eval(
        tab,
        "(()=>{const el=document.querySelector(%s);"
        "if(!el)return false;el.scrollIntoView({block:'center'});el.focus();"
        "try{el.value='';}catch(e){}return true;})()" % json.dumps(selector),
    )
    if not found:
        return False
    await tab.send(cdp_input.insert_text(text=text))
    return True


async def _click(tab, selector: str) -> bool:
    """Click a CSS-selected element via its own .click() (runs onclick handlers,
    e.g. Login_Submit())."""
    return bool(
        await _eval(
            tab,
            "(()=>{const el=document.querySelector(%s);"
            "if(!el)return false;el.scrollIntoView({block:'center'});el.click();return true;})()"
            % json.dumps(selector),
        )
    )


async def _capture_element_png(tab, selector: str) -> str | None:
    """Screenshot just the captcha image element to a temp PNG (the captcha is
    session-bound, so it must be captured from the rendered page, not re-fetched).
    Returns the PNG path or None."""
    from ai_dev_browser.core import page_screenshot

    rect_json = await _eval(
        tab,
        "(()=>{const el=document.querySelector(%s);if(!el)return null;"
        "const b=el.getBoundingClientRect();"
        "return JSON.stringify({x:b.x,y:b.y,w:b.width,h:b.height,dpr:window.devicePixelRatio||1});})()"
        % json.dumps(selector),
    )
    if not rect_json:
        return None
    r = json.loads(rect_json)
    if r["w"] < 1 or r["h"] < 1:
        return None

    fd, full = tempfile.mkstemp(suffix=".png")
    os.close(fd)
    await page_screenshot(tab, path=full)
    try:
        from PIL import Image

        dpr = r.get("dpr", 1) or 1
        img = Image.open(full)
        box = (
            max(0, int(r["x"] * dpr)),
            max(0, int(r["y"] * dpr)),
            int((r["x"] + r["w"]) * dpr),
            int((r["y"] + r["h"]) * dpr),
        )
        crop = img.crop(box)
        fd2, out = tempfile.mkstemp(suffix=".png")
        os.close(fd2)
        crop.save(out)
        return out
    finally:
        try:
            os.remove(full)
        except OSError:
            pass


def _resolve_vision(cfg: dict) -> dict:
    """Resolve vision-model creds, mirroring the image-analysis skill: prefer
    explicit cfg['vision'], else read sudoclaw.json (sudorouter baseUrl/apiKey +
    agents.defaults.imageModel, falling back to a vision-capable default)."""
    v = dict(cfg.get("vision") or {})
    if v.get("baseUrl") and v.get("apiKey") and v.get("model"):
        return v
    path = cfg.get("sudoclawConfigPath") or os.environ.get("SUDOCLAW_CONFIG_PATH")
    if path and os.path.isfile(path):
        try:
            c = json.load(open(path, "r", encoding="utf-8"))
            sr = c.get("models", {}).get("providers", {}).get("sudorouter", {})
            m = c.get("agents", {}).get("defaults", {}).get("imageModel") or ""
            v.setdefault("baseUrl", (sr.get("baseUrl") or "").rstrip("/"))
            v.setdefault("apiKey", sr.get("apiKey") or "")
            v.setdefault("model", (m.split("/")[-1] if "/" in m else m) or "gemini-2.5-flash")
        except Exception as exc:  # noqa: BLE001
            _eprint(f"[pwd_fill] failed to read sudoclaw.json: {exc}")
    return v


def _solve_captcha(png_path: str, vision: dict) -> str | None:
    """Ask the configured vision model to read the captcha digits. Captcha is not
    secret. Mirrors the image-analysis skill's chat-completions call."""
    base_url = (vision.get("baseUrl") or "").rstrip("/")
    api_key = vision.get("apiKey") or ""
    model = vision.get("model") or ""
    if not base_url or not api_key or not model:
        _eprint("[pwd_fill] vision creds incomplete; skipping captcha solve")
        return None

    with open(png_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("ascii")
    prompt = (
        "这是一张登录验证码图片。只输出图片中的字符本身(通常是4位字母或数字),"
        "不要任何解释、空格或标点。"
    )
    payload = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
                ],
            }
        ],
    }
    req = urllib.request.Request(
        f"{base_url}/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8", "replace"))
        text = data.get("choices", [{}])[0].get("message", {}).get("content", "") or ""
    except Exception as exc:  # noqa: BLE001
        _eprint(f"[pwd_fill] captcha vision call failed: {type(exc).__name__}: {exc}")
        return None
    # Keep only alphanumerics — strip any stray explanation/punctuation/whitespace.
    code = "".join(ch for ch in text if ch.isalnum())
    return code or None


async def _run(cfg: dict, password: str) -> dict:
    from ai_dev_browser.core import connect_browser, get_active_tab, page_wait_ready

    browser = await connect_browser(port=cfg.get("port"))
    tab = await get_active_tab(browser)

    # If a login url is given and we're not already there, navigate.
    url = cfg.get("url")
    if url:
        cur = await _eval(tab, "window.location.href")
        if not cur or url.split("?")[0] not in str(cur):
            from ai_dev_browser.core import page_goto

            await page_goto(tab, url)
    await page_wait_ready(tab)

    if not await _focus_and_type(tab, cfg["usernameSelector"], cfg.get("username", "")):
        return {"ok": False, "error": f"username field not found: {cfg['usernameSelector']}"}
    if not await _focus_and_type(tab, cfg["passwordSelector"], password):
        return {"ok": False, "error": f"password field not found: {cfg['passwordSelector']}"}

    captcha_tried = False
    cap_sel = cfg.get("captchaSelector")
    cap_img = cfg.get("captchaImageSelector")
    if cap_sel and cap_img:
        for attempt in range(cfg.get("captchaRetries", 3)):
            png = await _capture_element_png(tab, cap_img)
            if not png:
                break
            code = _solve_captcha(png, _resolve_vision(cfg))
            try:
                os.remove(png)
            except OSError:
                pass
            if not code:
                break
            captcha_tried = True
            await _focus_and_type(tab, cap_sel, code)
            break  # one solve per run; main can re-invoke to retry a wrong code

    url_before = await _eval(tab, "window.location.href")
    if not await _click(tab, cfg["submitSelector"]):
        return {"ok": False, "error": f"submit button not found: {cfg['submitSelector']}", "captcha_tried": captcha_tried}

    # Give the submit (and any client-side encryption + navigation) a moment.
    await asyncio.sleep(2.0)
    url_after = await _eval(tab, "window.location.href")
    navigated = bool(url_after and url_after != url_before)
    return {"ok": True, "navigated": navigated, "url_after": url_after, "captcha_tried": captcha_tried}


def main() -> int:
    ap = argparse.ArgumentParser(description="sudowork pwd-login filler")
    ap.add_argument("--config", required=True, help="path to non-secret JSON config")
    args = ap.parse_args()

    with open(args.config, "r", encoding="utf-8") as f:
        cfg = json.load(f)

    # Password: stdin only. Read raw bytes, decode transiently, zero the buffer.
    raw = bytearray(sys.stdin.buffer.read())
    password = raw.decode("utf-8").rstrip("\r\n")
    for i in range(len(raw)):
        raw[i] = 0

    try:
        result = asyncio.run(_run(cfg, password))
    except Exception as exc:  # noqa: BLE001 — surface as structured JSON, never leak
        result = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
    finally:
        # Best-effort: drop our reference to the plaintext (str residue acknowledged).
        password = "\x00" * len(password)
        del password

    print(json.dumps(result, ensure_ascii=False))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
