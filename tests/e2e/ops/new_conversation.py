"""Start a new conversation in Sudowork."""

import asyncio

from ai_dev_browser.core.page import js_exec


async def new_conversation(tab, wait: float = 3, wait_ready: float = 30) -> dict:
    """Click '+ 新会话' to start a fresh conversation.

    Waits for ACP agent to initialize (detects '会话活跃中' text).

    Returns:
        {"ok": True} or {"error": str}
    """
    r = await js_exec(tab, """(() => {
        const spans = document.querySelectorAll('span');
        for (const s of spans) {
            if (s.textContent.includes('新会话')) { s.click(); return 'ok'; }
        }
        return 'not_found';
    })()""")

    if r.get("result") != "ok":
        return {"error": "Could not find '新会话' button"}

    await asyncio.sleep(wait)

    # Wait for ACP agent to be ready (polls for '会话活跃中' text)
    for _ in range(int(wait_ready / 2)):
        r = await js_exec(tab, "document.body.innerText")
        text = r.get("result", "")
        if "会话活跃中" in text:
            return {"ok": True}
        await asyncio.sleep(2)

    # Timed out but still return ok — agent may work without the indicator
    return {"ok": True, "warning": "ACP ready indicator not detected"}
