"""Stop a running conversation by clicking the stop button.

The stop button appears in the send box area when the agent is
actively generating. It's a circle button with a small square icon
(class 'bg-animate' + inner div 'size-12px bg-6').
"""

import asyncio

from ai_dev_browser.core.page import js_evaluate


async def stop_conversation(tab, wait: float = 2, timeout: float = 0) -> dict:
    """Click the stop button to halt the running agent.

    Args:
        tab: Browser tab
        wait: Seconds to wait after clicking stop
        timeout: If > 0, wait up to this many seconds for the stop button
                 to appear before clicking (useful when the agent hasn't
                 started streaming yet)

    Returns:
        {"stopped": True} or {"not_running": True}
    """
    # Optionally wait for the stop button to appear
    if timeout > 0:
        elapsed = 0.0
        step = 0.5
        while elapsed < timeout:
            r = await js_evaluate(tab, """(() => {
                const btn = document.querySelector('button.bg-animate');
                return btn ? 'found' : null;
            })()""")
            if r.get("result"):
                break
            await asyncio.sleep(step)
            elapsed += step

    # Click the stop button
    r = await js_evaluate(tab, """(() => {
        // Primary selector: the animated circle button with the square icon
        const btn = document.querySelector('button.bg-animate');
        if (btn) {
            btn.click();
            return 'stopped';
        }
        // Fallback: find a secondary circle button whose child is a small square div
        const buttons = document.querySelectorAll('button.arco-btn-secondary.arco-btn-shape-circle');
        for (const b of buttons) {
            const inner = b.querySelector('div.size-12px, div.bg-6');
            if (inner) {
                b.click();
                return 'stopped (fallback)';
            }
        }
        return null;
    })()""")

    result = r.get("result")
    if result:
        await asyncio.sleep(wait)
        return {"stopped": True, "method": result}
    return {"not_running": True}
