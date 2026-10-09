# AUTO-GENERATED — DO NOT EDIT
# Re-run: python tests/e2e/generate.py
#
# Spec: https://github.com/sudoprivacy/human-browser-primitives
# Source: WebDriver §12.5.1 — Element Click

from primitives.click import click as _core
from utils import resolve_element_center


async def click(tab, x: int = None, y: int = None, button: int = 0, screenshot: str = None, element: str = None) -> dict:
    """WebDriver §12.5.1 — Element Click."""
    if element is not None:
        x, y = await resolve_element_center(tab, element)
    result = await _core(tab, x=x, y=y, button=button, screenshot=screenshot)
    return result
