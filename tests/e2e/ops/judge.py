"""Judge test results — Phase 2: Sudowork agent visual judgment.

Takes a screenshot, saves to ./screenshots/, then sends it to
Sudowork's own agent for PASS/FAIL visual verification.

Falls back to keyword matching if agent judgment fails.
"""

import asyncio
import os

from ai_dev_browser.cdp import input_ as cdp_input
from ai_dev_browser.core.page import js_exec

from .screenshot import screenshot


async def _send_message(tab, text, wait=10):
    """Send a message in current conversation."""
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
    await js_exec(tab, js)
    await asyncio.sleep(0.3)
    await tab.send(cdp_input.dispatch_key_event(
        "keyDown", key="Enter", code="Enter", windows_virtual_key_code=13
    ))
    await tab.send(cdp_input.dispatch_key_event(
        "keyUp", key="Enter", code="Enter", windows_virtual_key_code=13
    ))
    await asyncio.sleep(wait)


async def _get_shadow_text(tab):
    """Get text including Shadow DOM content."""
    r = await js_exec(tab, """(() => {
        const texts = [];
        function collect(root) {
            if (!root) return;
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
            while (walker.nextNode()) {
                const t = walker.currentNode.textContent.trim();
                if (t) texts.push(t);
            }
            root.querySelectorAll('*').forEach(el => {
                if (el.shadowRoot) collect(el.shadowRoot);
            });
        }
        collect(document.body);
        return texts.join(' ');
    })()""")
    return r.get("result", "")


async def _keyword_judge(page_text, expect):
    """Fallback: keyword matching (Phase 1)."""
    keywords = [w.strip("\"'`，。") for w in expect.lower().split()
                if len(w.strip("\"'`，。")) >= 2]
    if not keywords:
        return False, "No keywords"
    found = [kw for kw in keywords if kw in page_text.lower()]
    missing = [kw for kw in keywords if kw not in page_text.lower()]
    ratio = len(found) / len(keywords)
    passed = ratio >= 0.6
    if passed:
        return True, f"PASS: {len(found)}/{len(keywords)} keywords matched"
    return False, f"FAIL: {len(found)}/{len(keywords)}, missing: {missing[:5]}"


async def judge(tab, expect: str, use_agent: bool = False) -> dict:
    """Judge test result by checking page content against expectation.

    Args:
        tab: Browser tab
        expect: What should be visible on screen
        use_agent: If True, send screenshot to Sudowork agent for visual judgment.
                   If False (default), use keyword matching.

    Returns:
        {"pass": bool, "reason": str, "screenshot": str}
    """
    # 1. Take screenshot
    ss = await screenshot(tab)
    screenshot_path = ss["path"]
    abs_path = os.path.abspath(screenshot_path)

    # 2. Get page text (with Shadow DOM)
    page_text = await _get_shadow_text(tab)

    if not use_agent:
        # Phase 1: keyword matching
        passed, reason = await _keyword_judge(page_text, expect)
        return {"pass": passed, "reason": reason, "screenshot": screenshot_path}

    # Phase 2: Send screenshot to agent for visual judgment
    prompt = (
        f"@{abs_path} "
        f"[E2E Judge] Look at this screenshot. "
        f"Does it show: {expect}? "
        f"Reply EXACTLY: PASS or FAIL: <reason>"
    )

    await _send_message(tab, prompt, wait=20)

    # Read agent's response
    response_text = await _get_shadow_text(tab)

    # Parse PASS/FAIL from response
    verdict = ""
    for line in reversed(response_text.split("\n")):
        line = line.strip()
        if line.startswith("PASS") or line.startswith("FAIL"):
            verdict = line
            break

    if not verdict:
        # Fallback: search last 500 chars
        tail = response_text[-500:]
        if "PASS" in tail:
            verdict = "PASS"
        elif "FAIL" in tail:
            for seg in tail.split("FAIL"):
                if seg:
                    verdict = "FAIL:" + seg.split("\n")[0]
                    break

    if verdict:
        passed = verdict.startswith("PASS")
        return {"pass": passed, "reason": verdict, "screenshot": screenshot_path}

    # Double fallback: keyword matching
    passed, reason = await _keyword_judge(page_text, expect)
    return {"pass": passed, "reason": f"(agent no verdict, keyword fallback) {reason}",
            "screenshot": screenshot_path}
