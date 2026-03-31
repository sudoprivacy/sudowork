"""Wait for the app to finish its startup/setup screen.

Uses the init IPC API (phase === 'ready') rather than text polling.
"""

import asyncio

from ai_dev_browser.core.page import js_exec


async def wait_for_app_ready(tab, timeout: float = 300) -> dict:
    """Poll init.getStatus IPC until phase is 'ready'.

    Falls back to DOM text check if IPC is unavailable.

    Returns:
        {"ready": True} or {"timeout": True}
    """
    for _ in range(int(timeout / 2)):
        await asyncio.sleep(2)

        # Try IPC first
        r = await js_exec(tab, """
            (async function() {
                try {
                    if (window.electronAPI && window.electronAPI.invoke) {
                        const result = await window.electronAPI.invoke('init.get-status');
                        if (result && result.data) return result.data.phase;
                    }
                } catch(e) {}
                // Fallback: check DOM
                const text = document.body.innerText || '';
                if (text.includes('正在准备运行环境')) return 'pending';
                if (text.includes('新会话') || text.includes('Hi')) return 'ready';
                return 'unknown';
            })()
        """)
        phase = r.get("result", "unknown")
        if phase == "ready":
            return {"ready": True}

    return {"timeout": True}
