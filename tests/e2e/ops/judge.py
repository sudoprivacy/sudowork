"""Judge test results by checking page text against expected keywords.

Phase 1: Pure text matching (zero tokens, deterministic).
Phase 2 (future): Send screenshot to Sudowork agent for visual judgment.

This is the only op that determines PASS/FAIL.
"""

from .get_page_text import get_page_text
from .screenshot import screenshot


async def judge(tab, expect: str) -> dict:
    """Check if page text contains expected content.

    The `expect` string is split into keywords. If the majority
    of keywords are found in the page text, the test passes.

    Args:
        tab: Browser tab
        expect: Space-separated keywords or phrases to look for.
                Use quotes for exact phrases: '"model switched" sonnet'

    Returns:
        {"pass": bool, "reason": str, "screenshot": str}
    """
    # 1. Capture state
    page_result = await get_page_text(tab)
    page_text = page_result["text"].lower()

    # 2. Screenshot for debugging
    ss = await screenshot(tab, name="judge")

    # 3. Parse expect into keywords (min length 2 to skip noise)
    keywords = [w.strip("\"'`，。") for w in expect.lower().split()
                if len(w.strip("\"'`，。")) >= 2]

    if not keywords:
        return {"pass": False, "reason": "No keywords in expect string",
                "screenshot": ss["path"]}

    # 4. Check each keyword
    found = [kw for kw in keywords if kw in page_text]
    missing = [kw for kw in keywords if kw not in page_text]
    ratio = len(found) / len(keywords)

    # Pass if >= 60% keywords found
    passed = ratio >= 0.6

    if passed:
        reason = f"PASS: {len(found)}/{len(keywords)} keywords matched"
    else:
        reason = f"FAIL: {len(found)}/{len(keywords)} matched, missing: {missing[:5]}"

    return {
        "pass": passed,
        "reason": reason,
        "screenshot": ss["path"],
    }
