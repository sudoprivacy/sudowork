"""Evaluate arbitrary JavaScript in the renderer and return the result.

This op is useful for testing IPC bridges and backend functionality
that doesn't have a UI yet.
"""

from ai_dev_browser.core.page import js_evaluate


async def js_eval(tab, code: str = "", timeout: float = 10) -> dict:
    """Evaluate JS code in the renderer process.

    Args:
        tab: CDP tab handle.
        code: JavaScript expression to evaluate (should return a value).
        timeout: Max seconds (unused for now, js_evaluate is synchronous).

    Returns:
        {"result": <evaluated value>, "pass": True} on success,
        {"error": <message>, "pass": False} on failure.
    """
    if not code:
        return {"error": "no code provided", "pass": False}

    try:
        r = await js_evaluate(tab, code)
        return {"result": r.get("result"), "pass": True}
    except Exception as e:
        return {"error": str(e), "pass": False}
