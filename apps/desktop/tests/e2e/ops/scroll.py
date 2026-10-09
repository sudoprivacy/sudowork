# AUTO-GENERATED — DO NOT EDIT
# Re-run: python tests/e2e/generate.py
#
# Spec: https://github.com/sudoprivacy/human-browser-primitives
# Source: WebDriver §15.4.4 — Wheel actions

from primitives.scroll import scroll as _core


async def scroll(tab, x: int, y: int, delta_x: int, delta_y: int, duration: int = 0) -> dict:
    """WebDriver §15.4.4 — Wheel actions."""
    result = await _core(tab, x=x, y=y, delta_x=delta_x, delta_y=delta_y, duration=duration)
    return result
