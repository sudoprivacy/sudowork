"""Wait for agent to finish responding."""

import asyncio

from ai_dev_browser.core.page import js_exec


async def wait_for_response(tab, timeout: float = 60) -> dict:
    """Poll until the loading indicator disappears.

    Returns:
        {"done": True, "text": str} or {"timeout": True, "text": str}
    """
    text = ""
    for _ in range(int(timeout / 2)):
        await asyncio.sleep(2)
        r = await js_exec(tab, "document.body.innerText")
        text = r.get("result", "")
        if "正在处理中" not in text:
            return {"done": True, "text": text}

    return {"timeout": True, "text": text}
