#!/usr/bin/env python3
"""
Sudowork E2E test runner.

Reads YAML test cases from cases/, executes ops, reports results.

Usage:
    python tests/e2e/runner.py --port 9232
    python tests/e2e/runner.py --port 9232 --case model-command
"""

import argparse
import asyncio
import sys
from pathlib import Path

import yaml

# Ops registry — maps op names to async functions
from ops.connect import connect
from ops.new_conversation import new_conversation
from ops.send_message import send_message
from ops.type_text import type_text
from ops.screenshot import screenshot
from ops.get_page_text import get_page_text
from ops.click_allow import click_allow
from ops.switch_conversation import switch_conversation
from ops.wait_for_response import wait_for_response
from ops.judge import judge

OPS = {
    "new_conversation": new_conversation,
    "send_message": send_message,
    "switch_conversation": switch_conversation,
    "wait_for_response": wait_for_response,
    "type_text": type_text,
    "screenshot": screenshot,
    "get_page_text": get_page_text,
    "click_allow": click_allow,
    "judge": judge,
}

CASES_DIR = Path(__file__).parent / "cases"


async def run_case(tab, case_path: Path) -> dict:
    """Run a single YAML test case.

    Returns:
        {"name": str, "passed": int, "failed": int, "results": list}
    """
    with open(case_path) as f:
        case = yaml.safe_load(f)

    name = case.get("name", case_path.stem)
    steps = case.get("steps", [])
    results = []
    passed = 0
    failed = 0

    print(f"\n{'='*60}")
    print(f"  {name}")
    print(f"{'='*60}")

    for i, step in enumerate(steps):
        op_name = step.get("op")
        if op_name not in OPS:
            print(f"  [{i+1}] SKIP: unknown op '{op_name}'")
            continue

        op_fn = OPS[op_name]

        # Build kwargs from step (exclude 'op')
        kwargs = {k: v for k, v in step.items() if k != "op"}
        # Always pass tab as first arg
        kwargs_for_call = {"tab": tab, **kwargs}

        # Filter kwargs to only those the function accepts
        import inspect
        sig = inspect.signature(op_fn)
        valid_kwargs = {k: v for k, v in kwargs_for_call.items() if k in sig.parameters}

        try:
            result = await op_fn(**valid_kwargs)
        except Exception as e:
            result = {"error": str(e)}

        # Check result
        if op_name == "judge":
            if result.get("pass"):
                passed += 1
                status = "PASS"
            else:
                failed += 1
                status = "FAIL"
            reason = result.get("reason", "")
            print(f"  [{i+1}] {status}: {op_name} — {reason}")
        elif "error" in result:
            print(f"  [{i+1}] ERROR: {op_name} — {result['error']}")
        else:
            print(f"  [{i+1}] OK: {op_name}")

        results.append({"step": i + 1, "op": op_name, **result})

    return {"name": name, "passed": passed, "failed": failed, "results": results}


async def main(port: int, case_filter: str = None):
    """Run E2E tests."""
    print(f"Connecting to Sudowork CDP on port {port}...")
    browser, tab = await connect(port=port)
    print(f"Connected: {getattr(tab._target, 'url', '')}")

    # Find cases to run
    case_files = sorted(CASES_DIR.glob("*.yaml"))
    if case_filter:
        case_files = [f for f in case_files if case_filter in f.stem]

    if not case_files:
        print(f"No test cases found in {CASES_DIR}")
        return False

    total_passed = 0
    total_failed = 0

    for case_file in case_files:
        result = await run_case(tab, case_file)
        total_passed += result["passed"]
        total_failed += result["failed"]

    print(f"\n{'='*60}")
    print(f"  TOTAL: {total_passed} passed, {total_failed} failed")
    print(f"{'='*60}")

    return total_failed == 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Sudowork E2E test runner")
    parser.add_argument("--port", type=int, default=9232, help="CDP port")
    parser.add_argument("--case", type=str, help="Run specific case (name filter)")
    args = parser.parse_args()

    success = asyncio.run(main(port=args.port, case_filter=args.case))
    sys.exit(0 if success else 1)
