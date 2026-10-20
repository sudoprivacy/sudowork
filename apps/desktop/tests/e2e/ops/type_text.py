"""Type text into the focused textarea without sending (no Enter)."""

import asyncio

from ai_dev_browser.cdp import input_ as cdp_input
from ai_dev_browser.core.page import js_evaluate


async def type_text(tab, text: str, wait: float = 1) -> dict:
    """Type text into focused element using React-compatible setter.

    Supports both input and textarea. Does NOT press Enter.

    Returns:
        {"typed": True} or {"error": str}
    """
    prepared = await js_evaluate(tab, """(() => {
        const el = document.querySelector('textarea') ||
            document.querySelector('input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"])');
        if (!el) return 'no_input';

        el.focus();
        el.setSelectionRange(0, el.value.length);
        return el.tagName;
    })()""")
    if prepared.get("result") not in {"TEXTAREA", "INPUT"}:
        return {"error": f"Could not type: {prepared.get('result')}"}

    # CDP insertText follows the browser's real beforeinput/input path. The old
    # prototype-setter shortcut stopped updating React 19 controlled inputs:
    # it reported success while the composer stayed empty, producing false E2E
    # passes against unrelated text elsewhere on the page.
    await tab.send(cdp_input.insert_text(text=text))

    verified = await js_evaluate(
        tab,
        "(document.querySelector('textarea') || document.querySelector('input:not([type=\"hidden\"]):not([type=\"radio\"]):not([type=\"checkbox\"])'))?.value",
    )
    if verified.get("result") != text:
        return {"error": "Could not type: controlled input rejected the text"}

    await asyncio.sleep(wait)
    return {"typed": True}
