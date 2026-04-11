"""Wait for agent to finish responding.

Two modes:
- programmatic (default): checks for UI loading indicator absence + text stability
- llm: periodically screenshots and asks the conversation agent to judge completion
"""

import asyncio

from ai_dev_browser.core.page import js_exec

from .screenshot import screenshot


async def _get_page_text(tab) -> str:
    r = await js_exec(tab, "document.body.innerText")
    return r.get("result", "")


async def wait_for_response(tab, timeout: float = 120, mode: str = "programmatic",
                            expect: str = None) -> dict:
    """Wait for agent to finish responding.

    Args:
        tab: Browser tab
        timeout: Max seconds to wait
        mode: "programmatic" (UI indicator + text stability) or
              "llm" (send screenshot to conversation agent for judgment)
        expect: For llm mode — what completion looks like (sent to agent as judgment prompt)

    Returns:
        {"done": True/False, "mode": str, "text": str}
    """
    if mode == "llm":
        return await _wait_llm(tab, timeout, expect)
    return await _wait_programmatic(tab, timeout)


async def _wait_programmatic(tab, timeout: float) -> dict:
    """Check loading indicator + require text stability (no changes for 10s)."""
    prev_text = ""
    stable_count = 0

    for _ in range(int(timeout / 3)):
        await asyncio.sleep(3)
        text = await _get_page_text(tab)

        has_loading = "正在处理中" in text
        has_permission = "Always Allow" in text and "Reject" in text

        if has_loading or has_permission:
            stable_count = 0
            prev_text = text
            continue

        if text == prev_text:
            stable_count += 1
        else:
            stable_count = 0
            prev_text = text

        # Stable for 3 consecutive checks (9 seconds) with no loading
        if stable_count >= 3:
            return {"done": True, "mode": "programmatic", "text": text}

    return {"timeout": True, "mode": "programmatic", "text": prev_text}


async def _wait_llm(tab, timeout: float, expect: str = None) -> dict:
    """Send screenshot to conversation agent and ask if task is complete."""
    from .type_text import type_text
    from .press_key import press_key

    # First wait for initial response to start (programmatic)
    for _ in range(10):
        await asyncio.sleep(3)
        text = await _get_page_text(tab)
        if "正在处理中" not in text:
            break

    # Take screenshot and ask agent to judge completion
    ss = await screenshot(tab)
    import os
    abs_path = os.path.abspath(ss.get("path", ""))

    prompt = expect or "Has the agent completed its task? Look at the conversation."
    judgment_prompt = (
        f"@{abs_path} "
        f"[E2E Completion Check] {prompt} "
        f"Reply EXACTLY: DONE or WORKING"
    )

    await type_text(tab, judgment_prompt, wait=0.5)
    await press_key(tab, key='Enter', wait=15)

    # Read response
    text = await _get_page_text(tab)
    if "DONE" in text[-500:]:
        return {"done": True, "mode": "llm", "text": text}

    return {"done": False, "mode": "llm", "text": text}
