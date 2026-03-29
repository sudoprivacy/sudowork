# AUTO-GENERATED — DO NOT EDIT
# Re-run: python tests/e2e/generate.py
#
# Spec: https://github.com/sudoprivacy/human-browser-primitives
# Source: WebDriver §12.4.8 — Is Element Displayed

from ai_dev_browser.core.page import js_exec

async def is_displayed(tab, element: str) -> dict:
    """WebDriver §12.4.8 — Is Element Displayed."""
    r = await js_exec(tab, f"""(() => {{
        const el = document.querySelector('{element}');
        if (!el) return false;
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetHeight > 0;
    }})()""")
    return {"displayed": r.get("result", False)}
