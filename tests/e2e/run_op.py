#!/usr/bin/env python3
"""
Run a single E2E op from the command line.

Used by Doctor (and any shell-based agent) to invoke ops without
importing Python modules directly.

Usage:
    python tests/e2e/run_op.py --port 9230 --op screenshot
    python tests/e2e/run_op.py --port 9230 --op click_element --text "技能商店"
    python tests/e2e/run_op.py --port 9230 --op send_message --text "hello"
    python tests/e2e/run_op.py --port 9230 --op type_text --text "/model"
    python tests/e2e/run_op.py --port 9230 --op file_bug --title "bug title" --body "description"
    python tests/e2e/run_op.py --port 9230 --op stop_conversation
    python tests/e2e/run_op.py --list   # List all available ops
"""

import argparse
import asyncio
import json
import sys
from pathlib import Path

# Ensure tests/e2e is on sys.path so ops/ can be imported
sys.path.insert(0, str(Path(__file__).parent))

from ops.registry import discover_ops, invoke_op
from ops.connect import connect


def parse_value(v: str):
    """Try to parse a CLI string as int, float, bool, or keep as str."""
    if v.lower() == "true":
        return True
    if v.lower() == "false":
        return False
    try:
        return int(v)
    except ValueError:
        pass
    try:
        return float(v)
    except ValueError:
        pass
    return v


async def main():
    parser = argparse.ArgumentParser(description="Run a single E2E op")
    parser.add_argument("--port", type=int, default=9230, help="CDP port")
    parser.add_argument("--op", type=str, help="Op name to run")
    parser.add_argument("--list", action="store_true", help="List available ops")

    # Parse known args, treat the rest as op kwargs
    args, remaining = parser.parse_known_args()

    ops = discover_ops()

    if args.list:
        for name, fn in sorted(ops.items()):
            doc = (fn.__doc__ or "").strip().split("\n")[0]
            print(f"  {name:25s} {doc}")
        return

    if not args.op:
        parser.error("--op is required (or use --list)")

    # Parse remaining args as --key value pairs for the op
    kwargs = {}
    i = 0
    while i < len(remaining):
        if remaining[i].startswith("--"):
            key = remaining[i][2:].replace("-", "_")
            if i + 1 < len(remaining) and not remaining[i + 1].startswith("--"):
                kwargs[key] = parse_value(remaining[i + 1])
                i += 2
            else:
                kwargs[key] = True
                i += 1
        else:
            i += 1

    # Connect
    browser, tab = await connect(port=args.port)

    # Invoke
    result = await invoke_op(tab, args.op, ops, **kwargs)

    # Output as JSON
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
