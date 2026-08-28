"""Op registry — shared discovery and invocation for runner and CLI.

Both runner.py and run_op.py use this module. ONE code path.
"""

import asyncio
import importlib
import inspect
from pathlib import Path

OPS_DIR = Path(__file__).parent

# Hard-timeout backstop for a single op. An op is expected to honour its own
# `timeout` (the wait_* family, restart_app), but a stalled CDP call can hang
# *below* that limit and never return — which used to wedge the whole suite
# with zero output. This ceiling is the one place that guarantees forward
# progress: it is derived from the step's own `timeout` (SSOT — no competing
# second number), plus a grace window for teardown/settle; ops with no declared
# timeout get a flat default that comfortably exceeds any legitimate single-op
# runtime (the longest non-wait op is a sub-second pause).
HARD_TIMEOUT_GRACE = 30
DEFAULT_HARD_TIMEOUT = 120


def discover_ops() -> dict:
    """Scan ops/*.py and register each module's eponymous async function."""
    ops = {}
    skip = {"__init__", "__pycache__", "registry"}
    for f in sorted(OPS_DIR.glob("*.py")):
        name = f.stem
        if name in skip:
            continue
        mod = importlib.import_module(f"ops.{name}")
        fn = getattr(mod, name, None)
        if fn and (asyncio.iscoroutinefunction(fn) or callable(fn)):
            ops[name] = fn
    return ops


async def invoke_op(tab, op_name: str, ops: dict, **kwargs) -> dict:
    """Invoke a named op with kwargs, filtering to accepted params.

    Returns:
        Op result dict, or {"error": str} on failure.
    """
    if op_name not in ops:
        return {"error": f"Unknown op: {op_name}"}

    fn = ops[op_name]
    sig = inspect.signature(fn)

    # Build kwargs: always pass tab, plus caller kwargs filtered to accepted params
    accepted = set(sig.parameters.keys())
    call_kwargs = {"tab": tab, **kwargs}
    valid_kwargs = {k: v for k, v in call_kwargs.items() if k in accepted}
    unknown = {k: v for k, v in kwargs.items() if k not in accepted}

    if unknown:
        params = [p for p in accepted if p != "tab"]
        return {
            "error": f"Unknown params for {op_name}: {list(unknown.keys())}. "
                     f"Available params: {params}. "
                     f"Tip: use screenshot first to determine coordinates."
        }

    declared = valid_kwargs.get("timeout")
    ceiling = (declared + HARD_TIMEOUT_GRACE) if isinstance(declared, (int, float)) else DEFAULT_HARD_TIMEOUT

    try:
        return await asyncio.wait_for(fn(**valid_kwargs), timeout=ceiling)
    except asyncio.TimeoutError:
        return {"error": f"{op_name}: hard timeout after {ceiling}s "
                         "(op exceeded its own limit — likely a stalled CDP call; "
                         "cancelled so the suite keeps moving)"}
    except Exception as e:
        return {"error": f"{op_name}: {e}"}
