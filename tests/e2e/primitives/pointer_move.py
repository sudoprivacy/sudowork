# AUTO-GENERATED — DO NOT EDIT
# Re-run: python tests/e2e/generate.py
#
# Spec: https://github.com/sudoprivacy/human-browser-primitives
# Source: WebDriver §15.4.2 — Pointer actions



# Shared pointer position (module-level)
_last_pointer = [0, 0]

async def pointer_move(tab, x: int, y: int, duration: int = 0, origin: str = "viewport") -> dict:
    """WebDriver §15.4.2 — Pointer actions."""
    await tab.mouse_move(float(x), float(y), steps=1)
    return {"moved": True, "x": x, "y": y}
