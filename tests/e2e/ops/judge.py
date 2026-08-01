"""Judge test results — Phase 2: Sudowork agent visual judgment.

Takes a screenshot, saves to ./screenshots/, then sends it to
Sudowork's own agent for PASS/FAIL visual verification.

Falls back to keyword matching if agent judgment fails.
"""

import asyncio
import os

from ai_dev_browser.core.page import js_evaluate

from .screenshot import screenshot
from .type_text import type_text
from .press_key import press_key


async def _get_shadow_text(tab):
    """Get on-screen text: text nodes, Shadow DOM, and user-visible attributes.

    Some visible text lives in attributes, not text nodes — a truncated agent
    chip renders "S..." while the full "Sudo Code" is only in the send-box
    placeholder. The judge checks keyword presence, so including placeholder /
    value / aria-label / title avoids false negatives without risking false
    positives (the text is genuinely on screen).
    """
    r = await js_evaluate(tab, """(() => {
        const texts = [];
        function collect(root) {
            if (!root) return;
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
            while (walker.nextNode()) {
                const t = walker.currentNode.textContent.trim();
                if (t) texts.push(t);
            }
            root.querySelectorAll('*').forEach(el => {
                ['placeholder', 'aria-label', 'title'].forEach(attr => {
                    const v = el.getAttribute && el.getAttribute(attr);
                    if (v && v.trim()) texts.push(v.trim());
                });
                if (el.value && String(el.value).trim()) texts.push(String(el.value).trim());
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

    await type_text(tab, prompt, wait=0.5)
    await press_key(tab, key='Enter', wait=20)

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
