# AUTO-GENERATED — DO NOT EDIT
# Re-run: python tests/e2e/generate.py
#
# Spec: https://github.com/sudoprivacy/human-browser-primitives
# Source: WebDriver §12.4.2 — Get Element Attribute

from ai_dev_browser.core.page import js_evaluate
import json as _json

async def get_attribute(tab, element: str, name: str) -> dict:
    """WebDriver §12.4.2 — Get Element Attribute."""
    _sel = _json.dumps(element)
    _attr = _json.dumps(name)
    r = await js_evaluate(tab, f"""(() => {{
        const el = document.querySelector({_sel});
        return el ? el.getAttribute({_attr}) : null;
    }})()""")
    return {"value": r.get("result")}
