"""Type text into the focused textarea without sending (no Enter)."""

import asyncio

from ai_dev_browser.core.page import js_evaluate


async def type_text(tab, text: str, wait: float = 1) -> dict:
    """Type text into focused element using React-compatible setter.

    Supports both input and textarea. Does NOT press Enter.

    Returns:
        {"typed": True} or {"error": str}
    """
    await js_evaluate(tab, "document.querySelector('textarea, input')?.focus()")
    await asyncio.sleep(0.3)

    js = """(() => {
        const el = document.querySelector('textarea, input:not([type="hidden"])');
        if (!el) return 'no_input';

        // Reset React's _valueTracker so it detects the change
        const tracker = el._valueTracker;
        if (tracker) tracker.setValue('');

        const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        setter.call(el, %s);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return 'ok';
    })()""" % repr(text)

    r = await js_evaluate(tab, js)
    if r.get("result") != "ok":
        return {"error": f"Could not type: {r.get('result')}"}

    await asyncio.sleep(wait)
    return {"typed": True}
