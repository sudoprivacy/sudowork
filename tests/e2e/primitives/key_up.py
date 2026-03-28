# AUTO-GENERATED — DO NOT EDIT
# Re-run: python tests/e2e/generate.py
#
# Spec: https://github.com/sudoprivacy/human-browser-primitives
# Source: WebDriver §15.4.1 — Key actions

from ai_dev_browser.cdp import input_ as cdp_input

_KEY_CODES = {
    "Enter": 13, "Escape": 27, "Tab": 9, "Backspace": 8, "Delete": 46,
    "ArrowUp": 38, "ArrowDown": 40, "ArrowLeft": 37, "ArrowRight": 39,
    "Shift": 16, "Control": 17, "Alt": 18, "Meta": 91,
    " ": 32, "Home": 36, "End": 35, "PageUp": 33, "PageDown": 34,
}

async def key_up(tab, value: str) -> dict:
    """WebDriver §15.4.1 — Key actions."""
    await tab.send(cdp_input.dispatch_key_event(
        "keyUp", key=value, code=f"Key{value.upper()}" if len(value) == 1 else value,
        windows_virtual_key_code=ord(value.upper()) if len(value) == 1 else _KEY_CODES.get(value, 0),
        modifiers=0,
    ))
    return {"released": True, "value": value}
