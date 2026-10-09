# AUTO-GENERATED — DO NOT EDIT
# Re-run: python tests/e2e/generate.py
#
# Spec: https://github.com/sudoprivacy/human-browser-primitives
# Source: WebDriver §12.4.2 — Get Element Attribute

from primitives.get_attribute import get_attribute as _core


async def get_attribute(tab, element: str, name: str) -> dict:
    """WebDriver §12.4.2 — Get Element Attribute."""
    result = await _core(tab, element=element, name=name)
    return result
