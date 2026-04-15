"""Click at coordinates or on an element using CDP mouse events.

This is a true human-like click — dispatches mousePressed + mouseReleased
through CDP, which triggers React synthetic events correctly.
"""

import asyncio
import json

from ai_dev_browser.cdp import input_ as cdp_input
from ai_dev_browser.core.page import js_evaluate


async def mouse_click(tab, x: int = None, y: int = None,
                      text: str = None, selector: str = None,
                      wait: float = 1) -> dict:
    """Click using CDP mouse events at coordinates or element center.

    Args:
        tab: Browser tab
        x, y: Explicit coordinates (CSS pixels)
        text: Find element by visible text, click its center
        selector: Find element by CSS selector, click its center
        wait: Seconds to wait after click

    Returns:
        {"clicked": True, "x": int, "y": int} or {"error": str}
    """
    # Resolve coordinates from text or selector
    if x is None or y is None:
        if text:
            r = await js_evaluate(tab, """JSON.stringify((() => {
                const all = document.querySelectorAll('*');
                for (const el of all) {
                    const own = Array.from(el.childNodes)
                        .filter(n => n.nodeType === 3)
                        .map(n => n.textContent.trim()).join('');
                    if (own === %s) {
                        const rect = el.getBoundingClientRect();
                        return {x: Math.round(rect.left + rect.width/2),
                                y: Math.round(rect.top + rect.height/2)};
                    }
                }
                // Fallback: match textContent
                for (const el of all) {
                    if (el.textContent?.trim() === %s && el.children.length < 3 && el.offsetHeight > 0) {
                        const rect = el.getBoundingClientRect();
                        return {x: Math.round(rect.left + rect.width/2),
                                y: Math.round(rect.top + rect.height/2)};
                    }
                }
                return null;
            })())""" % (repr(text), repr(text)))
        elif selector:
            r = await js_evaluate(tab, """JSON.stringify((() => {
                const el = document.querySelector(%s);
                if (el) {
                    const rect = el.getBoundingClientRect();
                    return {x: Math.round(rect.left + rect.width/2),
                            y: Math.round(rect.top + rect.height/2)};
                }
                return null;
            })())""" % repr(selector))
        else:
            return {"error": "Must provide x/y, text, or selector"}

        coords = json.loads(r.get("result", "null"))
        if not coords:
            return {"not_found": True, "text": text, "selector": selector}
        x, y = coords["x"], coords["y"]

    # CDP mouse click
    btn = cdp_input.MouseButton("left")
    await tab.send(cdp_input.dispatch_mouse_event(
        "mousePressed", x=x, y=y, button=btn, click_count=1,
    ))
    await tab.send(cdp_input.dispatch_mouse_event(
        "mouseReleased", x=x, y=y, button=btn, click_count=1,
    ))

    await asyncio.sleep(wait)
    return {"clicked": True, "x": x, "y": y}
