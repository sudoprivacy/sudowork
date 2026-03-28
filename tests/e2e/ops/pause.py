# AUTO-GENERATED — DO NOT EDIT
# Re-run: python tests/e2e/generate.py
#
# Spec: https://github.com/sudoprivacy/human-browser-primitives
# Source: WebDriver §15.4.5 — Null actions

from primitives.pause import pause as _core


async def pause(tab, duration: int) -> dict:
    """WebDriver §15.4.5 — Null actions."""
    result = await _core(tab, duration=duration)
    return result
