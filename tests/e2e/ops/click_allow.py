"""Click 'Always Allow' permission button in Sudowork."""

import asyncio
import json

from ai_dev_browser.cdp import input_ as cdp_input
from ai_dev_browser.core.page import js_exec


async def click_allow(tab, wait: float = 2) -> dict:
    """Find and click the 'Always Allow' permission button.

    Uses DOM traversal to find the exact coordinates, then CDP click.

    Returns:
        {"clicked": True} or {"not_found": True}
    """
    # Find Always Allow by its own text node
    r = await js_exec(tab, """JSON.stringify((() => {
        const all = document.querySelectorAll('*');
        for (const el of all) {
            const own = Array.from(el.childNodes)
                .filter(n => n.nodeType === 3)
                .map(n => n.textContent.trim()).join('');
            if (own === 'Always Allow') {
                const rect = el.getBoundingClientRect();
                return {x: Math.round(rect.left + rect.width/2),
                        y: Math.round(rect.top + rect.height/2)};
            }
        }
        return null;
    })())""")

    coords = json.loads(r.get("result", "null"))
    if not coords:
        return {"not_found": True}

    btn = cdp_input.MouseButton("left")
    await tab.send(cdp_input.dispatch_mouse_event(
        "mousePressed", x=coords["x"], y=coords["y"],
        button=btn, click_count=1,
    ))
    await tab.send(cdp_input.dispatch_mouse_event(
        "mouseReleased", x=coords["x"], y=coords["y"],
        button=btn, click_count=1,
    ))

    await asyncio.sleep(wait)
    return {"clicked": True}
