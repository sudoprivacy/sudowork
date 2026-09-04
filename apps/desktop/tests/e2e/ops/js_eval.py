"""Evaluate arbitrary JavaScript in the renderer and return the result.

Supports async expressions (Promises are awaited automatically).

Assertion contract: a `throw` inside `code` fails the step. ai-dev-browser
>= 0.13.0 raises `JsEvaluationError` (carrying the JS message, stack, the
expression, and any console output before the throw) instead of handing the
CDP ExceptionDetails object back through the value channel. That makes
`js_eval` usable directly as an assertion op:

    - op: js_eval
      code: |
        (() => { if (bad) throw new Error('why'); return {ok: true}; })()

The `>= 0.13.0` floor is enforced in the workflow's pip install — on older
versions a thrown Error came back as a *successful* return value and the
step scored OK, which silently masked failing assertions.
"""


async def js_eval(tab, code: str = "", timeout: float = 30) -> dict:
    """Evaluate JS code in the renderer process.

    Args:
        tab: CDP tab handle.
        code: JavaScript expression to evaluate. Async expressions
              (returning a Promise) are awaited automatically. Throwing
              fails the step.
        timeout: Max seconds for the evaluation.

    Returns:
        {"result": <evaluated value>, "pass": True} on success,
        {"error": <message>, "pass": False} on JS throw / CDP error / timeout.
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
        # JsEvaluationError (page threw), CommandTimeout, protocol errors.
        return {"error": str(e), "pass": False}

    return {"result": result, "pass": True}
