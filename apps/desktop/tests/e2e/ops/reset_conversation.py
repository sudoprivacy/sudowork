"""Return to a fresh new-conversation view before a case runs.

E2E cases must be independent, but they share one long-lived app instance.
Without a reset, a case inherits whatever the previous case left on screen —
an open `/conversation/:id`, a half-finished turn, a non-default agent
selection — and its first selector (e.g. the "Sudo Code" agent chip on the
new-chat landing) is simply not there. That was the cross-talk behind
scode-code-and-run's "Element not found: Sudo Code".

Reset navigates to the new-conversation landing (`/guid`, the route the
"New Chat" action targets) via the HashRouter, then waits for the send-box.
Navigation is by route, not a text-clicked button, so it is locale-independent
and cannot itself miss on a translated label.
"""

import asyncio

from ai_dev_browser.core.page import js_evaluate

from ._ui_ready import has_visible_sendbox


async def reset_conversation(tab, timeout: float = 15) -> dict:
    """Navigate to a clean new-conversation view and confirm it is interactive.

    Returns:
        {"pass": True, "reset": True} once the new-chat send-box is visible.
        {"pass": False, "reason": ...} if it did not become interactive.
    """
    await js_evaluate(tab, "window.location.hash = '#/guid'")

    deadline = asyncio.get_running_loop().time() + timeout
    while asyncio.get_running_loop().time() < deadline:
        await asyncio.sleep(0.5)
        if await has_visible_sendbox(tab):
            return {"pass": True, "reset": True}

    return {"pass": False,
            "reason": f"new-conversation send-box not interactive within {timeout}s after navigating to /guid"}
