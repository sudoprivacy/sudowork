# AUTO-GENERATED — DO NOT EDIT
# Re-run: python tests/e2e/generate.py
#
# Spec: https://github.com/sudoprivacy/human-browser-primitives
# Source: WebDriver §18.1 — Take Screenshot

from primitives.screenshot import screenshot as _core


async def screenshot(tab, path: str = None) -> dict:
    """WebDriver §18.1 — Take Screenshot."""
    result = await _core(tab, path=path)
    return result
