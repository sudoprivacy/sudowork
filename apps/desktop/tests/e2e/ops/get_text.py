# AUTO-GENERATED — DO NOT EDIT
# Re-run: python tests/e2e/generate.py
#
# Spec: https://github.com/sudoprivacy/human-browser-primitives
# Source: WebDriver §12.4.4 — Get Element Text

from primitives.get_text import get_text as _core


async def get_text(tab, element: str = None, shadow_dom: bool = True) -> dict:
    """WebDriver §12.4.4 — Get Element Text."""
    result = await _core(tab, element=element)
    return result
