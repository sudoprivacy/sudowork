# AUTO-GENERATED — DO NOT EDIT
# Re-run: python tests/e2e/generate.py
#
# Spec: https://github.com/sudoprivacy/human-browser-primitives
# Source: WebDriver §15.4.4 — Wheel actions

from ai_dev_browser.cdp import input_ as cdp_input

async def scroll(tab, x: int, y: int, delta_x: int, delta_y: int, duration: int = 0) -> dict:
    """WebDriver §15.4.4 — Wheel actions."""
    await tab.send(cdp_input.dispatch_mouse_event(
        "mouseWheel", x=x, y=y, delta_x=delta_x, delta_y=delta_y,
    ))
    return {"scrolled": True, "x": x, "y": y, "delta_x": delta_x, "delta_y": delta_y}
