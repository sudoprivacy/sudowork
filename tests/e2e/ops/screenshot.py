"""Take a screenshot of the current Sudowork state."""

from datetime import datetime
from pathlib import Path

from ai_dev_browser.core.page import screenshot as _screenshot

SCREENSHOT_DIR = Path(__file__).parent.parent / "screenshots"
SCREENSHOT_DIR.mkdir(exist_ok=True)


async def screenshot(tab, name: str = "screenshot") -> dict:
    """Take a screenshot and save with timestamp prefix.

    Returns:
        {"path": str, "width": int, "height": int}
    """
    ts = datetime.now().strftime("%H%M%S")
    filename = f"{ts}_{name}.png"
    path = SCREENSHOT_DIR / filename

    result = await _screenshot(tab, path=str(path))
    return {
        "path": str(path),
        "width": result.get("width", 0),
        "height": result.get("height", 0),
    }
