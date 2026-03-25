"""Type text into the focused textarea without sending (no Enter)."""

import asyncio

from ai_dev_browser.core.page import js_exec


async def type_text(tab, text: str, wait: float = 1) -> dict:
    """Type text into textarea using React-compatible setter. Does NOT press Enter.

    Useful for testing autocomplete — type partial text and check dropdown.

    Returns:
        {"typed": True} or {"error": str}
    """
    await js_exec(tab, "document.querySelector('textarea')?.focus()")
    await asyncio.sleep(0.3)

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
        return {"error": f"Could not type: {r.get('result')}"}

    await asyncio.sleep(wait)
    return {"typed": True}
