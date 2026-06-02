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
import time
from pathlib import Path

import yaml

import state
from ops.registry import discover_ops, invoke_op

OPS = discover_ops()

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

    # Mark case start so ops like db_audit can filter messages "since this run"
    state.CASE_START_MS = int(time.time() * 1000)
    state.CASE_NAME = name

    print(f"\n{'='*60}")
    print(f"  {name}")
    print(f"{'='*60}")

    for i, step in enumerate(steps):
        op_name = step.get("op")
        if op_name not in OPS:
            print(f"  [{i+1}] SKIP: unknown op '{op_name}'")
            continue

        # Build kwargs from step (exclude 'op')
        kwargs = {k: v for k, v in step.items() if k != "op"}

        # Use shared invoke_op (same code path as run_op.py)
        result = await invoke_op(tab, op_name, OPS, **kwargs)

        # Check result — ops with a "pass" key are assertions (judge, db_audit,
        # check_port_isolation, etc.); everything else is a plain action.
        if "pass" in result:
            if result["pass"]:
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


async def main(port: int, case_filter: str = None, tag: str = None):
    """Run E2E tests."""
    from ops.connect import connect
    print(f"Connecting to Sudowork CDP on port {port}...")
    browser, tab = await connect(port=port)
    print(f"Connected: {getattr(tab._target, 'url', '')}")

    # Find cases to run
    case_files = sorted(CASES_DIR.glob("*.yaml"))
    if case_filter:
        case_files = [f for f in case_files if case_filter in f.stem]

    # Filter by tag if specified
    if tag:
        filtered = []
        for f in case_files:
            with open(f) as fh:
                case = yaml.safe_load(fh)
            tags = case.get("tags", [])
            if tag in tags:
                filtered.append(f)
        case_files = filtered

    if not case_files:
        print(f"No test cases found in {CASES_DIR}" + (f" with tag '{tag}'" if tag else ""))
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
    parser.add_argument("--tag", type=str, help="Run only cases with this tag (e.g. no-api, smoke)")
    args = parser.parse_args()

    success = asyncio.run(main(port=args.port, case_filter=args.case, tag=args.tag))
    sys.exit(0 if success else 1)
