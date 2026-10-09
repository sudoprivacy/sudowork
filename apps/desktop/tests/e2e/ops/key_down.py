# AUTO-GENERATED — DO NOT EDIT
# Re-run: python tests/e2e/generate.py
#
# Spec: https://github.com/sudoprivacy/human-browser-primitives
# Source: WebDriver §15.4.1 — Key actions

from primitives.key_down import key_down as _core
from utils import react_key_fallback


async def key_down(tab, value: str) -> dict:
    """WebDriver §15.4.1 — Key actions."""
    result = await _core(tab, **{k: v for k, v in locals().items() if k in _core.__code__.co_varnames and k != 'tab'})
    if result.get('error'):
        fb = await react_key_fallback(tab, value)
        return {**fb, "hint": "React controlled input detected — used setter-based injection"}
    return result
