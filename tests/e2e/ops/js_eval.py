"""Evaluate arbitrary JavaScript in the renderer and return the result.

Supports async expressions (Promises are awaited automatically).
Useful for testing IPC bridges and backend functionality without UI.
"""


async def js_eval(tab, code: str = "", timeout: float = 30) -> dict:
    """Evaluate JS code in the renderer process.

    Args:
        tab: CDP tab handle.
        code: JavaScript expression to evaluate. Async expressions
              (returning a Promise) are awaited automatically.
        timeout: Max seconds for the evaluation.

    Returns:
        {"result": <evaluated value>, "pass": True} on success,
        {"error": <message>, "pass": False} on failure.
    """
    if not code:
        return {"error": "no code provided", "pass": False}

    try:
        result = await tab.evaluate(
            code,
            await_promise=True,
            return_by_value=True,
            timeout=timeout,
        )
        return {"result": result, "pass": True}
    except Exception as e:
        return {"error": str(e), "pass": False}
