"""Positive existence assertion: pass when at least `min_count` of the given
substrings appear in the visible page text (Shadow DOM included).

The precise complement of `assert_not_contains`, and the right tool for
"the reply mentions at least N of these" checks. The keyword `judge` scores
60% of ALL the words it extracts from `expect`, so a prose expectation like
"Assistant reply mentions at least two of: red, blue, yellow" makes it hunt
for "assistant"/"reply"/"mentions" — words that never appear in the model's
answer — and false-negatives even when the reply is correct. This op asserts
the actual content tokens directly, with an explicit "at least N" threshold.

Args:
  expected:  A single substring, or a list of substrings. Case-insensitive.
  min_count: Minimum number of `expected` entries that must be present (default 1).
  reason:    Human-readable note included in the report.
"""

from ai_dev_browser.core.page import js_evaluate


async def assert_contains_any(tab, expected=None, min_count: int = 1, reason: str = "") -> dict:
    if expected is None:
        return {"pass": False, "error": "no `expected` provided"}

    needles = [expected] if isinstance(expected, str) else list(expected)

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
                if (el.shadowRoot) collect(el.shadowRoot);
            });
        }
        collect(document.body);
        return texts.join(' ');
    })()""")
    page_text = (r.get("result", "") or "").lower()

    hits = [n for n in needles if str(n).lower() in page_text]
    passed = len(hits) >= min_count
    return {
        "pass": passed,
        "reason": f"{len(hits)}/{len(needles)} present (need >={min_count}): {hits}"
                  + (f" — {reason}" if reason else ""),
    }
