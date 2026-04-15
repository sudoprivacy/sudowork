# AUTO-GENERATED — DO NOT EDIT
# Re-run: python tests/e2e/generate.py
#
# Spec: https://github.com/sudoprivacy/human-browser-primitives
# Source: WebDriver §12.4.8 — Is Element Displayed

from ai_dev_browser.core.page import js_evaluate
import json as _json

async def is_displayed(tab, element: str) -> dict:
    """WebDriver §12.4.8 — Is Element Displayed."""
    _sel = _json.dumps(element)
    r = await js_evaluate(tab, f"""(() => {{
        const el = document.querySelector({_sel});
        if (!el) return false;
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetHeight > 0;
    }})()""")
    return {"displayed": r.get("result", False)}
