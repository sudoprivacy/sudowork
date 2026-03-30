# AUTO-GENERATED — DO NOT EDIT
# Re-run: python tests/e2e/generate.py
#
# Spec: https://github.com/sudoprivacy/human-browser-primitives
# Source: WebDriver §18.1 — Take Screenshot

from primitives.screenshot import screenshot as _core


async def screenshot(tab, path: str = None) -> dict:
    """WebDriver §18.1 — Take Screenshot."""
    result = await _core(tab)
    if path is not None and result.get("base64"):
        import base64 as b64
        from pathlib import Path as P
        P(path).parent.mkdir(parents=True, exist_ok=True)
        P(path).write_bytes(b64.b64decode(result["base64"]))
        result["saved"] = path
    return result
