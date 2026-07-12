"""Evaluate arbitrary JavaScript in the renderer and return the result.

Supports async expressions (Promises are awaited automatically). A thrown
JS error inside the expression maps to `pass: False` — that's what makes
`js_eval` useful as an assertion op (`throw new Error(...)` from inside
the code becomes a hard case failure). Without this, ai-dev-browser's
tab.evaluate would return the ExceptionDetails object as a plain value
and the runner would silently score it OK.
"""

from ai_dev_browser.cdp import runtime


async def js_eval(tab, code: str = "", timeout: float = 30) -> dict:
    """Evaluate JS code in the renderer process.

    Args:
        tab: CDP tab handle.
        code: JavaScript expression to evaluate. Async expressions
              (returning a Promise) are awaited automatically.
        timeout: Max seconds for the evaluation.

    Returns:
        {"result": <evaluated value>, "pass": True} on success,
        {"error": <message>, "pass": False} on JS throw / CDP error.
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
    except Exception as e:
        return {"error": str(e), "pass": False}

    # tab.evaluate hands back the CDP ExceptionDetails object (NOT a raised
    # Python exception) when the JS body throws. Detect + demote to failure.
    if isinstance(result, runtime.ExceptionDetails):
        exc = getattr(result, "exception", None)
        message = (
            getattr(exc, "description", None)
            or getattr(result, "text", None)
            or "JS threw during evaluation"
        )
        return {"error": message, "pass": False}

    return {"result": result, "pass": True}
