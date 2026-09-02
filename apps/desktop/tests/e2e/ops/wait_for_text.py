"""Poll the visible page text until at least `min_count` of `expected` appear.

The deterministic wait for content whose render time varies — e.g. an
intercepted slash-command result (/help, /model, /status, /cost), which posts a
`text` reply after a few seconds (longer on the first command, which spawns the
scode agent). A fixed `pause` races that render; this polls the DOM (Shadow DOM
included) until the content is actually there, then passes — or fails on timeout.

Doubles as the assertion: pass = the content rendered, fail = it never did.

Args:
  expected:  A single substring, or a list of substrings. Case-insensitive.
  min_count: Minimum number that must be present (default 1).
  timeout:   Max seconds to poll (default 30).
"""

import asyncio
import time

from ai_dev_browser.core.page import js_evaluate

_WALK_JS = """(() => {
    const texts = [];
    function collect(root) {
        if (!root) return;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
        while (walker.nextNode()) {
            const t = walker.currentNode.textContent.trim();
            if (t) texts.push(t);
        }
        root.querySelectorAll('*').forEach(el => { if (el.shadowRoot) collect(el.shadowRoot); });
    }
    collect(document.body);
    return texts.join(' ');
})()"""


async def wait_for_text(tab, expected=None, min_count: int = 1,
                        timeout: float = 30, poll_interval: float = 2) -> dict:
    if expected is None:
        return {"pass": False, "error": "no `expected` provided"}
    needles = [expected] if isinstance(expected, str) else list(expected)

    deadline = time.time() + timeout
    hits = []
    while time.time() < deadline:
        r = await js_evaluate(tab, _WALK_JS)
        page_text = (r.get("result", "") or "").lower()
        hits = [n for n in needles if str(n).lower() in page_text]
        if len(hits) >= min_count:
            return {"pass": True, "reason": f"{len(hits)}/{len(needles)} present: {hits}"}
        await asyncio.sleep(poll_interval)

    return {"pass": False,
            "reason": f"only {len(hits)}/{len(needles)} present after {timeout}s "
                      f"(need >={min_count}): {hits}"}
