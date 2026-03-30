"""Hand-written utility functions for ops convenience params.

These are referenced by ops-spec.yaml resolvers. They convert
app-specific parameters (text, selector) into core primitive
parameters (x, y coordinates, etc).
"""

import json

from ai_dev_browser.core.page import js_exec



async def resolve_by_selector(tab, selector: str) -> tuple[int, int]:
    """Find element by CSS selector, return center (x, y) coordinates."""
    r = await js_exec(tab, """JSON.stringify((() => {
        const el = document.querySelector(%s);
        if (el && el.offsetHeight > 0) {
            const rect = el.getBoundingClientRect();
            return {x: Math.round(rect.left + rect.width/2),
                    y: Math.round(rect.top + rect.height/2)};
        }
        return null;
    })())""" % repr(selector))

    coords = json.loads(r.get("result", "null"))
    if not coords:
        raise ValueError(f"Element '{selector}' not found or not visible")
    return coords["x"], coords["y"]


async def react_key_fallback(tab, value: str) -> dict:
    """Fall back to React-compatible text injection when key events don't work.

    For React controlled inputs, individual key events don't trigger
    state updates. This function uses the native property setter to
    append the character to the current textarea value.
    """
    r = await js_exec(tab, """(() => {
        const ta = document.querySelector('textarea') || document.querySelector('input[type="text"]');
        if (!ta) return JSON.stringify({"error": "no input element found"});
        const setter = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype, 'value'
        )?.set || Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value'
        )?.set;
        if (!setter) return JSON.stringify({"error": "no setter found"});
        setter.call(ta, ta.value + %s);
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        return JSON.stringify({"ok": true, "value_length": ta.value.length});
    })()""" % repr(value))

    result = json.loads(r.get("result", "{}"))
    if result.get("error"):
        return {"error": result["error"]}
    return {"pressed": True, "value": value}
