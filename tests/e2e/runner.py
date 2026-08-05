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

    # Lint: e2e cases must contain at least one UI interaction op.
    # Pure js_eval / IPC tests belong in tests/integration/, not here.
    UI_OPS = {"click", "type_text", "mouse_click", "press_key",
              "pointer_down", "pointer_up", "pointer_move", "scroll",
              "key_down", "key_up", "wait_for_response"}
    step_ops = {s.get("op") for s in steps}
    if not step_ops & UI_OPS:
        print(f"  SKIP: {name} — no UI ops (belongs in tests/integration/, not e2e)")
        return {"name": name, "passed": 0, "failed": 1,
                "results": [{"step": 0, "op": "lint",
                             "error": "e2e case has no UI ops — move to tests/integration/"}]}

    # Mark case start so ops like db_audit can filter messages "since this run"
    state.CASE_START_MS = int(time.time() * 1000)
    state.CASE_NAME = name

    print(f"\n{'='*60}")
    print(f"  {name}")
    print(f"{'='*60}")

    # Settle the startup gate before driving the UI. In CI the Nexus runtime
    # install fails (no napi toolchain) and raises the "Starting Core Services"
    # dialog; Skip enters the app — the documented product behaviour. On a
    # healthy box the dialog never renders and this is a no-op. Done here so
    # every UI case is robust to the gate without repeating the step; cases that
    # settle it explicitly (dismiss_init_dialog in their steps) opt out.
    if "dismiss_init_dialog" in OPS and "dismiss_init_dialog" not in step_ops:
        settle = await invoke_op(tab, "dismiss_init_dialog", OPS)
        if isinstance(settle, dict) and settle.get("pass") is False:
            print(f"  [0] FAIL: dismiss_init_dialog — {settle.get('reason', '')}")
            return {"name": name, "passed": 0, "failed": 1,
                    "results": [{"step": 0, "op": "dismiss_init_dialog", **settle}]}

    for i, step in enumerate(steps):
        op_name = step.get("op")
        if op_name not in OPS:
            print(f"  [{i+1}] SKIP: unknown op '{op_name}'")
            continue

        # Build kwargs from step (exclude 'op')
        kwargs = {k: v for k, v in step.items() if k != "op"}

        # Use shared invoke_op (same code path as run_op.py)
        result = await invoke_op(tab, op_name, OPS, **kwargs)

        # An op can hand back a fresh connection (e.g. restart_app relaunches
        # Electron, which kills the old tab). Swap it in for the remaining
        # steps and keep the non-serializable Tab object out of the results log.
        if isinstance(result, dict):
            new_tab = result.pop("_new_tab", None)
            if new_tab is not None:
                tab = new_tab

        # Check result — ops with a "pass" key are assertions (judge, db_audit,
        # check_port_isolation, etc.); everything else is a plain action.
        #
        # An action that reports "error" FAILS the case. It used to only print
        # ERROR and leave the counters alone, which meant a case could report
        # green with broken steps in the middle: `mouse_click` not finding its
        # target, `type_text` hitting `no_input`, etc. all scored as nothing at
        # all. A case only went red if it happened to carry a separate
        # assertion op that noticed the damage downstream — so the honesty of
        # the whole suite rested on the author remembering to add one. An op
        # that could not do its job is a failure; that is the whole contract.
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
            failed += 1
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
