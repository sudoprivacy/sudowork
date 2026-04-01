# AUTO-GENERATED — DO NOT EDIT
# Re-run: python tests/e2e/generate.py
#
# Spec: https://github.com/sudoprivacy/human-browser-primitives
# Source: WebDriver §15.4.2 — Pointer actions

from ai_dev_browser.core.mouse import mouse_move as _mouse_move

# Shared pointer position (module-level)
_last_pointer = [0, 0]

async def pointer_move(tab, x: int, y: int, duration: int = 0, origin: str = "viewport", screenshot: str = None) -> dict:
    """WebDriver §15.4.2 — Pointer actions."""
    await _mouse_move(tab, float(x), float(y), screenshot=screenshot, steps=1)
    return {"moved": True, "x": x, "y": y}
