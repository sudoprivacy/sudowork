# AUTO-GENERATED — DO NOT EDIT
# Re-run: python tests/e2e/generate.py
#
# Spec: https://github.com/sudoprivacy/human-browser-primitives
# Source: WebDriver §12.4.2 — Get Element Attribute

from ai_dev_browser.core.page import js_exec

async def get_attribute(tab, element: str, name: str) -> dict:
    """WebDriver §12.4.2 — Get Element Attribute."""
    r = await js_exec(tab, f"""(() => {{
        const el = document.querySelector('{element}');
        return el ? el.getAttribute('{name}') : null;
    }})()""")
    return {"value": r.get("result")}
