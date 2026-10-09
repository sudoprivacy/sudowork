"""restart_app -- restart the Electron app in place, preserving user state.

Resume / session-continuity e2e cases need to prove the engine restores
conversation context across a REAL process restart (the in-memory scode
session is destroyed), not merely an in-process reconnect. This op:

  1. kills the running Electron (and its scode engine child),
  2. relaunches dev mode against the SAME user data dir -- no config reset,
     so the conversation DB, acpSessionId, and on-disk scode session files
     all survive,
  3. waits for the CDP endpoint, then reconnects and hands the runner a
     fresh tab (returned under ``_new_tab``; the runner swaps it in for the
     remaining steps).

State preservation is the whole point: unlike ``restart_electron.py``'s CLI
``main()`` (which clears enterprise/consumer config for clean-state tests),
this is a plain kill+relaunch that leaves every byte of user state in place.
"""

import asyncio
import os
import sys
import time

# tests/e2e (this file's grandparent) must be importable so the sibling
# `restart_electron` module resolves the same way the runner imports `ops.*`.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ai_dev_browser.core.page import js_evaluate  # noqa: E402

from restart_electron import kill_electron, launch_electron, wait_for_cdp  # noqa: E402

from ops.connect import connect  # noqa: E402
from ops._ui_ready import has_visible_sendbox  # noqa: E402


async def _settle_renderer(port: int, deadline_s: float = 90):
    """Reconnect after a dev relaunch and return a tab whose renderer has
    actually mounted.

    The Vite dev client races the first load: the relaunched renderer often
    mounts blank and then swaps its execution context when Vite hydrates, which
    kills the CDP target's websocket and makes every subsequent op fail with
    'server rejected WebSocket connection: HTTP 500'. wait_for_cdp only proves
    the endpoint is up, not that the renderer is stable. So reconnect, reload
    once past the race, and wait for the send-box before handing the tab back —
    then the case resumes on a live context. (The packaged app has no Vite race;
    this loop is a fast no-op there — the send-box is present on the first try.)
    """
    end = time.time() + deadline_s
    reloaded = False
    while time.time() < end:
        try:
            _browser, tab = await connect(port=port)
            if await has_visible_sendbox(tab):
                return tab
            if not reloaded:
                reloaded = True
                try:
                    await js_evaluate(tab, "location.reload()")
                except Exception:
                    pass  # reload tears down the ws — a fresh connect next loop
        except Exception:
            pass  # CDP target list still churning post-relaunch — retry
        await asyncio.sleep(2)
    return None


async def restart_app(tab, port: int = 9232, timeout: int = 120) -> dict:
    """Kill + relaunch Electron preserving state, then reconnect to a live tab.

    Args:
        tab: current (about-to-be-dead) tab -- unused; kept for op-signature parity.
        port: CDP port the relaunched app exposes (launch_electron uses 9232).
        timeout: seconds to wait for the CDP endpoint to come back.

    Returns:
        {"restarted": True, "_new_tab": <Tab>} on success -- the runner
        reassigns its tab to ``_new_tab`` for subsequent steps.
        {"error": str} if the app didn't come back up / the renderer never mounted.
    """
    kill_electron()
    launch_electron()
    if not wait_for_cdp(port, timeout=timeout):
        return {"error": f"restart_app: CDP not ready on port {port} within {timeout}s"}
    new_tab = await _settle_renderer(port)
    if new_tab is None:
        return {"error": f"restart_app: renderer did not mount after relaunch on port {port}"}
    return {"restarted": True, "_new_tab": new_tab}
