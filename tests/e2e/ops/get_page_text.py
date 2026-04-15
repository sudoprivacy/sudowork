"""Get visible text content from the main conversation area.

Sudowork renders messages inside Shadow DOM (markdown-shadow),
so we need to traverse shadowRoots to get the actual text.
"""

from ai_dev_browser.core.page import js_evaluate


async def get_page_text(tab) -> dict:
    """Get text from conversation messages, including Shadow DOM content.

    Returns:
        {"text": str}
    """
    r = await js_evaluate(tab, """(() => {
        const texts = [];

        function collect(root) {
            if (!root) return;
            const walker = document.createTreeWalker(
                root, NodeFilter.SHOW_TEXT, null
            );
            while (walker.nextNode()) {
                const t = walker.currentNode.textContent.trim();
                if (t) texts.push(t);
            }
            // Traverse into shadow roots
            root.querySelectorAll('*').forEach(el => {
                if (el.shadowRoot) collect(el.shadowRoot);
            });
        }

        collect(document.body);
        return texts.join(' ');
    })()""")
    return {"text": r.get("result", "")}
