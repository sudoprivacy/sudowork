"""Send a message in Sudowork chat."""

import asyncio

from ai_dev_browser.cdp import input_ as cdp_input
from ai_dev_browser.core.page import js_exec


async def send_message(tab, text: str, wait: float = 5) -> dict:
    """Type a message and press Enter to send.

    Uses React-compatible native setter + CDP Enter key for human-like behavior.

    Returns:
        {"sent": True} or {"error": str}
    """
    # Focus textarea
    await js_exec(tab, "document.querySelector('textarea')?.focus()")
    await asyncio.sleep(0.3)

    # Set value via React-compatible native setter
    js = """(() => {
        const ta = document.querySelector('textarea');
        if (!ta) return 'no_textarea';
        const setter = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype, 'value'
        ).set;
        setter.call(ta, %s);
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        return 'ok';
    })()""" % repr(text)

    r = await js_exec(tab, js)
    if r.get("result") != "ok":
        return {"error": f"Could not type message: {r.get('result')}"}

    await asyncio.sleep(0.3)

    # Press Enter via CDP (human-like)
    await tab.send(cdp_input.dispatch_key_event(
        "keyDown", key="Enter", code="Enter", windows_virtual_key_code=13
    ))
    await tab.send(cdp_input.dispatch_key_event(
        "keyUp", key="Enter", code="Enter", windows_virtual_key_code=13
    ))

    await asyncio.sleep(wait)
    return {"sent": True}
