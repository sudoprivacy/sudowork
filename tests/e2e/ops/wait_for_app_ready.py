"""Wait for the app to finish its startup/setup screen.

Uses the init IPC API (phase === 'ready') rather than text polling.
"""

import asyncio

from ai_dev_browser.core.page import js_evaluate


async def wait_for_app_ready(tab, timeout: float = 300) -> dict:
    """Poll DOM until the app is ready to accept input.

    "Ready" means the send-box textarea is present AND visible (offsetHeight
    > 0), not just any textarea in the DOM. The InitLoading dialog and the
    login screen can both contain hidden inputs — checking existence alone
    was letting downstream ops race past into "no_input" errors.

    Returns:
        {"pass": True, "ready": True} on success — case can proceed.
        {"pass": False, "reason": "timeout"} on timeout — case fails loudly
        rather than silently sliding past (the old {"timeout": True} shape
        was scored OK by the runner and masked real boot regressions).
    """
    for _ in range(int(timeout / 2)):
        await asyncio.sleep(2)

        r = await js_evaluate(tab, """
            (function() {
                var text = document.body.innerText || '';
                if (text.includes('正在准备运行环境')) return 'pending';
                var ta = document.querySelector('textarea');
                var visible = !!(ta && ta.offsetHeight > 0 && ta.offsetWidth > 0);
                if (visible && (text.includes('新会话') || text.includes('Hi'))) return 'ready';
                return 'unknown';
            })()
        """)
        phase = r.get("result", "unknown")
        if phase == "ready":
            return {"pass": True, "ready": True}

    return {"pass": False, "reason": f"app not ready after {timeout}s (no visible send-box textarea)"}
