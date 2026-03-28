# AUTO-GENERATED — DO NOT EDIT
# Re-run: python tests/e2e/generate.py
#
# Spec: https://github.com/sudoprivacy/human-browser-primitives
# Source: WebDriver §18.1 — Take Screenshot

from ai_dev_browser.core.page import js_exec
import base64

async def screenshot(tab) -> dict:
    """WebDriver §18.1 — Take Screenshot."""
    r = await tab.send({"method": "Page.captureScreenshot", "params": {"format": "png"}})
    data = r.get("result", {}).get("data", "")
    return {"screenshot": True, "data_length": len(data), "base64": data}
