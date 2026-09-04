# AUTO-GENERATED — DO NOT EDIT
# Re-run: python tests/e2e/generate.py
#
# Spec: https://github.com/sudoprivacy/human-browser-primitives
# Source: WebDriver §15.4.2 — Pointer actions

from primitives.pointer_move import pointer_move as _core


async def pointer_move(tab, x: int, y: int, duration: int = 0, origin: str = "viewport", screenshot: str = None) -> dict:
    """WebDriver §15.4.2 — Pointer actions."""
    result = await _core(tab, x=x, y=y, duration=duration, origin=origin, screenshot=screenshot)
    return result
