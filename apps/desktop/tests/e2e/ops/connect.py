"""Connect to Sudowork via CDP."""

import re

from ai_dev_browser.core.connection import connect_browser


# Sudowork's Vite dev server binds to a port in the 5170-5999 range (preferred
# 5173, auto-detected fallbacks up to 5999 when earlier ports are in use on
# Windows due to port reservations). Matching on the exact port range lets us
# tell the sudowork renderer apart from any `<webview>` embeds that happen to
# be on other ports, from third-party `localhost` services, and from the
# DevTools pages that can also appear in `/json/list`.
_SUDOWORK_RENDERER_RE = re.compile(
    r"^https?://(127\.0\.0\.1|localhost):5\d{3}(?:/|$)", re.IGNORECASE
)


async def connect(port: int = 9232):
    """Connect and return (browser, tab) for the Sudowork renderer.

    Returns:
        tuple: (browser, tab)

    The CDP target list on sudowork's Electron can contain more than just the
    main renderer — conversations that previously referenced an external URL
    spawn `<webview>` preview panes (via `packages/renderer/src/.../URLViewer.tsx` and
    `WebviewHost.tsx`) that each attach as their own `page` target. Those
    previews commonly end up FIRST in `browser.tabs`, so a naive "grab the
    first tab" fallback drives the wrong DOM — we observed this causing
    mouse_click / type_text to miss the sudowork chat input and instead
    interact with a lis8.sinosoft.ltd preview. Matching the Vite renderer's
    URL pattern avoids that confusion.
    """
    browser = await connect_browser(port=port)

    # Prefer an exact Vite-dev renderer match — stable against webview noise.
    for t in browser.tabs:
        url = getattr(t._target, "url", "") or ""
        if _SUDOWORK_RENDERER_RE.match(url):
            return browser, t

    # Secondary: a more permissive localhost match. This covers packaged
    # builds that might host the renderer on a non-Vite port, while still
    # excluding `devtools://`, `chrome-extension://`, and external https
    # webview previews.
    for t in browser.tabs:
        url = getattr(t._target, "url", "") or ""
        if "localhost" in url or "127.0.0.1" in url:
            return browser, t

    # Last resort: first non-DevTools page. Better than blindly grabbing
    # `tabs[0]` which could be a third-party https webview.
    for t in browser.tabs:
        url = getattr(t._target, "url", "") or ""
        if not url.startswith("devtools://"):
            return browser, t

    raise ConnectionError("No Sudowork tabs found")
