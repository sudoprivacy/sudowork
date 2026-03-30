# AUTO-GENERATED — DO NOT EDIT
# Re-run: python tests/e2e/generate.py
#
# Spec: https://github.com/sudoprivacy/human-browser-primitives
# Source: WebDriver §15.4.2 — Pointer actions

from ai_dev_browser.cdp import input_ as cdp_input

# Shared pointer position (module-level)
_last_pointer = [0, 0]

async def pointer_up(tab, button: int = 0) -> dict:
    """WebDriver §15.4.2 — Pointer actions."""
    _btn = cdp_input.MouseButton("left") if button == 0 else cdp_input.MouseButton("right") if button == 2 else cdp_input.MouseButton("middle")
    await tab.send(cdp_input.dispatch_mouse_event(
        "mouseReleased", x=float(_last_pointer[0]), y=float(_last_pointer[1]),
        button=_btn, click_count=1,
    ))
    return {"released": True, "button": button}
