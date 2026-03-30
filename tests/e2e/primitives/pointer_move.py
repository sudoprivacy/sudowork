# AUTO-GENERATED — DO NOT EDIT
# Re-run: python tests/e2e/generate.py
#
# Spec: https://github.com/sudoprivacy/human-browser-primitives
# Source: WebDriver §15.4.2 — Pointer actions

from ai_dev_browser.cdp import input_ as cdp_input

# Shared pointer position (module-level)
_last_pointer = [0, 0]

async def pointer_move(tab, x: int, y: int, duration: int = 0, origin: str = "viewport") -> dict:
    """WebDriver §15.4.2 — Pointer actions."""
    await tab.send(cdp_input.dispatch_mouse_event(
        "mouseMoved", x=float(x), y=float(y),
    ))
    _last_pointer[0] = x
    _last_pointer[1] = y
    return {"moved": True, "x": x, "y": y}
