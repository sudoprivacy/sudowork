"""Switch to a conversation by clicking its title in the sidebar."""

import asyncio

from ai_dev_browser.core.page import js_exec


async def switch_conversation(tab, title: str, wait: float = 2) -> dict:
    """Click a conversation in the sidebar by its title text.

    Returns:
        {"switched": True} or {"not_found": True}
    """
    r = await js_exec(tab, """(() => {
        const items = document.querySelectorAll('span');
        for (const s of items) {
            if (s.textContent.trim() === %s) {
                s.click();
                return 'ok';
            }
        }
        return 'not_found';
    })()""" % repr(title))

    if r.get("result") != "ok":
        return {"not_found": True}

    await asyncio.sleep(wait)
    return {"switched": True}
