# AUTO-GENERATED — DO NOT EDIT
# Re-run: python tests/e2e/generate.py
#
# Spec: https://github.com/sudoprivacy/human-browser-primitives
# Source: WebDriver §12.5.1 — Element Click

from ai_dev_browser.core.mouse import mouse_click as _mouse_click

async def click(tab, x: int, y: int, button: int = 0, screenshot: str = None) -> dict:
    """WebDriver §12.5.1 — Element Click."""
    _btn_name = "left" if button == 0 else "right" if button == 2 else "middle"
    await _mouse_click(tab, float(x), float(y), screenshot=screenshot, button=_btn_name)
    return {"clicked": True, "x": x, "y": y, "button": button}
