# AUTO-GENERATED — DO NOT EDIT
# Re-run: python tests/e2e/generate.py
#
# Spec: https://github.com/sudoprivacy/human-browser-primitives
# Source: WebDriver §18.1 — Take Screenshot

from ai_dev_browser.core.page import page_screenshot as _take_screenshot

async def screenshot(tab, path: str = None) -> dict:
    """WebDriver §18.1 — Take Screenshot."""
    result = await _take_screenshot(tab, path=path, css_scale=True)
    return {"screenshot": True, **result}
