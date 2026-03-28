# AUTO-GENERATED — DO NOT EDIT
# Re-run: python tests/e2e/generate.py
#
# Spec: https://github.com/sudoprivacy/human-browser-primitives
# Source: WebDriver §12.4.8 — Is Element Displayed

from primitives.is_displayed import is_displayed as _core


async def is_displayed(tab, element: str) -> dict:
    """WebDriver §12.4.8 — Is Element Displayed."""
    result = await _core(tab, element=element)
    return result
