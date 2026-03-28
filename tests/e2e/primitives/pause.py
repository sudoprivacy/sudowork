# AUTO-GENERATED — DO NOT EDIT
# Re-run: python tests/e2e/generate.py
#
# Spec: https://github.com/sudoprivacy/human-browser-primitives
# Source: WebDriver §15.4.5 — Null actions

import asyncio

async def pause(tab, duration: int) -> dict:
    """WebDriver §15.4.5 — Null actions."""
    await asyncio.sleep(duration / 1000.0)
    return {"paused": True, "duration": duration}
