"""Op registry — shared discovery and invocation for runner and CLI.

Both runner.py and run_op.py use this module. ONE code path.
"""

import asyncio
import importlib
import inspect
from pathlib import Path

OPS_DIR = Path(__file__).parent


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


async def invoke_op(tab, name: str, ops: dict, **kwargs) -> dict:
    """Invoke a named op with kwargs, filtering to accepted params.

    Returns:
        Op result dict, or {"error": str} on failure.
    """
    if name not in ops:
        return {"error": f"Unknown op: {name}"}

    fn = ops[name]
    sig = inspect.signature(fn)

    # Build kwargs: always pass tab, plus caller kwargs filtered to accepted params
    accepted = set(sig.parameters.keys())
    call_kwargs = {"tab": tab, **kwargs}
    valid_kwargs = {k: v for k, v in call_kwargs.items() if k in accepted}
    unknown = {k: v for k, v in kwargs.items() if k not in accepted}

    if unknown:
        params = [p for p in accepted if p != "tab"]
        return {
            "error": f"Unknown params for {name}: {list(unknown.keys())}. "
                     f"Available params: {params}. "
                     f"Tip: use screenshot first to determine coordinates."
        }

    try:
        return await fn(**valid_kwargs)
    except Exception as e:
        return {"error": f"{name}: {e}"}
