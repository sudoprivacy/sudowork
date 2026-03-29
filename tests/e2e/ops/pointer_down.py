# AUTO-GENERATED — DO NOT EDIT
# Re-run: python tests/e2e/generate.py
#
# Spec: https://github.com/sudoprivacy/human-browser-primitives
# Source: WebDriver §15.4.2 — Pointer actions

from primitives.pointer_down import pointer_down as _core
from utils import resolve_by_selector
from utils import resolve_by_text


async def pointer_down(tab, button: int = 0, text: str = None, selector: str = None) -> dict:
    """WebDriver §15.4.2 — Pointer actions."""
    if text is not None:
        x, y = await resolve_by_text(tab, text)
    if selector is not None:
        x, y = await resolve_by_selector(tab, selector)
    result = await _core(tab, button=button)
    return result
