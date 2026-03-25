"""Take a screenshot of the current Sudowork state.

Uses ai-dev-browser's default screenshot dir (./screenshots/).
"""

from ai_dev_browser.core.page import screenshot as _screenshot


async def screenshot(tab, name: str = "screenshot") -> dict:
    """Take a screenshot. Stored in ./screenshots/ by default.

    Returns:
        {"path": str, "width": int, "height": int}
    """
    result = await _screenshot(tab)
    return {
        "path": result.get("path", ""),
        "width": result.get("width", 0),
        "height": result.get("height", 0),
    }
