# AUTO-GENERATED — DO NOT EDIT
# Re-run: python tests/e2e/generate.py
#
# Spec: https://github.com/sudoprivacy/human-browser-primitives
# Source: WebDriver §15.4.2 — Pointer actions

from primitives.pointer_up import pointer_up as _core


async def pointer_up(tab, button: int = 0) -> dict:
    """WebDriver §15.4.2 — Pointer actions."""
    result = await _core(tab, button=button)
    return result
