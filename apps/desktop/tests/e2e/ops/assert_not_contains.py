"""Negative assertion — fail if any of the given substrings appears in the
visible page text (Shadow DOM included).

Complement of `judge`'s positive keyword matcher: for tests where the invariant
is "this specific error string MUST NOT appear," a positive judge is brittle
(the assistant's reply wording varies). This op reads the DOM directly and
fails hard when a forbidden token is present.

Args:
  forbidden: Either a single substring, or a list of substrings. Match is
             case-sensitive; wrap in `.lower()`-friendly text upstream if you
             need loose matching.
  reason:    Human-readable note included in the failure report.
"""

from ai_dev_browser.core.page import js_evaluate


async def assert_not_contains(tab, forbidden=None, reason: str = "") -> dict:
    if forbidden is None:
        return {"pass": False, "error": "no `forbidden` provided"}

    needles = [forbidden] if isinstance(forbidden, str) else list(forbidden)

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
    page_text = r.get("result", "") or ""

    hits = [n for n in needles if n in page_text]
    if hits:
        return {
            "pass": False,
            "reason": f"forbidden token(s) present on page: {hits}"
                      + (f" — {reason}" if reason else ""),
        }
    return {"pass": True, "reason": f"none of {needles} present"}
