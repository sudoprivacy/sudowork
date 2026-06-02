#!/usr/bin/env python3
"""Managed Agent IPC bridge integration test.

Verifies that managed-agent.start-session, managed-agent.get-session, and
managed-agent.cancel-session IPC channels are registered and return the
expected response shape.

Requires Sudowork running with CDP enabled.

Usage:
    python tests/integration/managed_agent_ipc.py
    python tests/integration/managed_agent_ipc.py --port 9232
"""

import argparse
import asyncio
import json
import sys


async def run_test(port: int = 9230) -> tuple[bool, str]:
    """Connect to Sudowork via CDP and test managed-agent IPC channels."""
    from ai_dev_browser.core.connection import connect_browser

    try:
        browser = await connect_browser(port=port)
    except Exception as e:
        return False, f"Cannot connect to Sudowork CDP on {port}: {e}"

    tab = browser.tabs[0] if browser.tabs else None
    if not tab:
        return False, "No tabs found"

    failures = []

    # Inject bridgeInvoke helper
    r = await tab.evaluate("""
        (function() {
            var e = window.__bridgeEmitter;
            if (!e) return 'no __bridgeEmitter';
            window.__bridgeInvoke = function(ch, data) {
                var id = ch + Math.random().toString(16).slice(2, 10);
                return new Promise(function(resolve) {
                    var key = 'subscribe.callback-' + ch + id;
                    var h = function(r) { e.off(key, h); resolve(r); };
                    e.on(key, h);
                    window.electronAPI.emit('subscribe-' + ch, {id: id, data: data});
                });
            };
            return 'ok';
        })()
    """, await_promise=True, return_by_value=True, timeout=10)

    if r != "ok":
        return False, f"Failed to inject bridgeInvoke: {r}"

    # Test startSession
    r = await tab.evaluate("""
        (async function() {
            var r = await window.__bridgeInvoke('managed-agent.start-session',
                {agentId: 'e2e-test', repos: ['/tmp'], model: 'test'});
            if (typeof r.success !== 'boolean')
                throw new Error('bad response shape: ' + JSON.stringify(r));
            return JSON.stringify(r);
        })()
    """, await_promise=True, return_by_value=True, timeout=20)
    parsed = json.loads(r) if isinstance(r, str) else r
    if not isinstance(parsed, dict) or "success" not in parsed:
        failures.append(f"startSession: bad shape: {r}")
    else:
        print(f"  startSession: success={parsed['success']}")

    # Test getSession
    r = await tab.evaluate("""
        (async function() {
            var r = await window.__bridgeInvoke('managed-agent.get-session',
                {sessionId: 'nonexistent'});
            if (typeof r.success !== 'boolean')
                throw new Error('bad response shape: ' + JSON.stringify(r));
            return JSON.stringify(r);
        })()
    """, await_promise=True, return_by_value=True, timeout=20)
    parsed = json.loads(r) if isinstance(r, str) else r
    if not isinstance(parsed, dict) or "success" not in parsed:
        failures.append(f"getSession: bad shape: {r}")
    else:
        print(f"  getSession: success={parsed['success']}")

    # Test cancelSession
    r = await tab.evaluate("""
        (async function() {
            var r = await window.__bridgeInvoke('managed-agent.cancel-session',
                {sessionId: 'nonexistent', mode: 'graceful'});
            if (typeof r.success !== 'boolean')
                throw new Error('bad response shape: ' + JSON.stringify(r));
            return JSON.stringify(r);
        })()
    """, await_promise=True, return_by_value=True, timeout=20)
    parsed = json.loads(r) if isinstance(r, str) else r
    if not isinstance(parsed, dict) or "success" not in parsed:
        failures.append(f"cancelSession: bad shape: {r}")
    else:
        print(f"  cancelSession: success={parsed['success']}")

    if failures:
        return False, "; ".join(failures)
    return True, "All 3 IPC channels respond with correct shape"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Managed Agent IPC integration test")
    parser.add_argument("--port", type=int, default=9230, help="Sudowork CDP port")
    args = parser.parse_args()

    print("=" * 60)
    print("  Managed Agent IPC Bridge Test")
    print("=" * 60)

    passed, message = asyncio.run(run_test(args.port))

    status = "PASS" if passed else "FAIL"
    print(f"\n  {status}: {message}")
    print("=" * 60)
    sys.exit(0 if passed else 1)
