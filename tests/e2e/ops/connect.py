"""Connect to Sudowork via CDP."""

from ai_dev_browser.core.connection import connect_browser


async def connect(port: int = 9232):
    """Connect and return (browser, tab) for the Sudowork renderer.

    Returns:
        tuple: (browser, tab)
    """
    browser = await connect_browser(port=port)

    # Find the localhost renderer tab (skip devtools)
    for t in browser.tabs:
        url = getattr(t._target, "url", "") or ""
        if "localhost" in url:
            return browser, t

    if browser.tabs:
        return browser, browser.tabs[0]

    raise ConnectionError("No Sudowork tabs found")
