"""Wait for the app to finish its startup/setup screen."""

import asyncio

from ._ui_ready import has_visible_sendbox


async def wait_for_app_ready(tab, timeout: float = 300) -> dict:
    """Poll until the app is ready to accept input.

    "Ready" means the send-box textarea is present AND visible — the
    locale-independent signal from `_ui_ready`. The InitLoading dialog and the
    login screen carry only hidden inputs, so a visible send-box means we are
    in a usable conversation view; readiness never depends on a localized
    greeting (which silently never matched under a forced en-US run).

    Returns:
        {"pass": True, "ready": True} on success — case can proceed.
        {"pass": False, "reason": ...} on timeout — case fails loudly rather
        than silently sliding past into downstream "no_input" errors.
    """
    for _ in range(int(timeout / 2)):
        await asyncio.sleep(2)
        if await has_visible_sendbox(tab):
            return {"pass": True, "ready": True}

    return {"pass": False, "reason": f"app not ready after {timeout}s (no visible send-box textarea)"}
