# AUTO-GENERATED — DO NOT EDIT
# Re-run: python tests/e2e/generate.py
#
# Spec: https://github.com/sudoprivacy/human-browser-primitives
# Source: WebDriver §12.5.1 — Element Click

from primitives.click import click as _core


async def click(tab, x: int, y: int, button: int = 0) -> dict:
    """WebDriver §12.5.1 — Element Click."""
    result = await _core(tab, x=x, y=y, button=button)
    return result
