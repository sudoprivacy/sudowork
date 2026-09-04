# AUTO-GENERATED — DO NOT EDIT
# Re-run: python tests/e2e/generate.py
#
# Spec: https://github.com/sudoprivacy/human-browser-primitives
# Source: WebDriver §12.4.4 — Get Element Text

from ai_dev_browser.core.page import js_evaluate

async def get_text(tab, element: str = None) -> dict:
    """WebDriver §12.4.4 — Get Element Text."""
    r = await js_evaluate(tab, """(() => {
        function walk(root) {
            let text = '';
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            while (walker.nextNode()) { text += walker.currentNode.textContent; }
            root.querySelectorAll('*').forEach(el => {
                if (el.shadowRoot) { text += walk(el.shadowRoot); }
            });
            return text;
        }
        return walk(document.body);
    })()""")
    return {"text": r.get("result", "")}
