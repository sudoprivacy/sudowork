# AUTO-GENERATED — DO NOT EDIT
# Re-run: python tests/e2e/generate.py
#
# Spec: https://github.com/sudoprivacy/human-browser-primitives
# Source: WebDriver §15.4.1 — Key actions

from primitives.key_up import key_up as _core


async def key_up(tab, value: str) -> dict:
    """WebDriver §15.4.1 — Key actions."""
    result = await _core(tab, value=value)
    return result
