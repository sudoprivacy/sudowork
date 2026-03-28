"""Press a key or key combination (Enter, Ctrl+Enter, Escape, etc).

Uses CDP Input.dispatchKeyEvent for human-like keyboard input.
"""

import asyncio

from ai_dev_browser.cdp import input_ as cdp_input


# Modifier flags for CDP
_MODIFIERS = {
    'ctrl': 2,
    'alt': 1,
    'shift': 8,
    'meta': 4,
}

# Common key mappings
_KEYS = {
    'enter': ('Enter', 'Enter', 13),
    'escape': ('Escape', 'Escape', 27),
    'tab': ('Tab', 'Tab', 9),
    'backspace': ('Backspace', 'Backspace', 8),
    'delete': ('Delete', 'Delete', 46),
    'arrowup': ('ArrowUp', 'ArrowUp', 38),
    'arrowdown': ('ArrowDown', 'ArrowDown', 40),
    'arrowleft': ('ArrowLeft', 'ArrowLeft', 37),
    'arrowright': ('ArrowRight', 'ArrowRight', 39),
}


async def press_key(tab, key: str = 'Enter', wait: float = 1) -> dict:
    """Press a key or key combination.

    Args:
        tab: Browser tab
        key: Key name, optionally with modifiers separated by '+'.
             Examples: 'Enter', 'Ctrl+Enter', 'Escape', 'Ctrl+Shift+A'
        wait: Seconds to wait after key press

    Returns:
        {"pressed": True, "key": str} or {"error": str}
    """
    parts = [p.strip().lower() for p in key.split('+')]
    main_key = parts[-1]
    mod_names = parts[:-1]

    # Resolve modifiers
    modifiers = 0
    for m in mod_names:
        if m not in _MODIFIERS:
            return {"error": f"Unknown modifier: {m}. Valid: {list(_MODIFIERS.keys())}"}
        modifiers |= _MODIFIERS[m]

    # Resolve key
    if main_key in _KEYS:
        key_name, code, vk = _KEYS[main_key]
    elif len(main_key) == 1:
        key_name = main_key
        code = f'Key{main_key.upper()}'
        vk = ord(main_key.upper())
    else:
        return {"error": f"Unknown key: {main_key}"}

    # Dispatch keyDown + keyUp
    await tab.send(cdp_input.dispatch_key_event(
        "rawKeyDown", key=key_name, code=code,
        windows_virtual_key_code=vk, modifiers=modifiers
    ))
    await tab.send(cdp_input.dispatch_key_event(
        "keyUp", key=key_name, code=code,
        windows_virtual_key_code=vk, modifiers=modifiers
    ))

    await asyncio.sleep(wait)
    return {"pressed": True, "key": key}
