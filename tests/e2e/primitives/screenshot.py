# AUTO-GENERATED — DO NOT EDIT
# Re-run: python tests/e2e/generate.py
#
# Spec: https://github.com/sudoprivacy/human-browser-primitives
# Source: WebDriver §18.1 — Take Screenshot

from ai_dev_browser.core.page import screenshot as _core_screenshot

async def screenshot(tab) -> dict:
    """WebDriver §18.1 — Take Screenshot."""
    result = await _core_screenshot(tab)
    return {"screenshot": True, "path": result.get("path", ""), **result}
