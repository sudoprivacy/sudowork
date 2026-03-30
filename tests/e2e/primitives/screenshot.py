# AUTO-GENERATED — DO NOT EDIT
# Re-run: python tests/e2e/generate.py
#
# Spec: https://github.com/sudoprivacy/human-browser-primitives
# Source: WebDriver §18.1 — Take Screenshot

from ai_dev_browser.cdp import page as cdp_page
import base64

async def screenshot(tab) -> dict:
    """WebDriver §18.1 — Take Screenshot."""
    data = await tab.send(cdp_page.capture_screenshot(format_='png'))
    return {"screenshot": True, "data_length": len(data), "base64": data}
