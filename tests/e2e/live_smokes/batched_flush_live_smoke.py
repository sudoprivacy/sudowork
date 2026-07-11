#!/usr/bin/env python3
"""Live smoke: batched-flush (§3.2 queue mode) against a booted sudowork dev instance.

Reproduces the ai-dev-browser drive-through I hand-verified on 2026-07-11.
Use this any time PR #983 (`turnInputCoordinator.run(tail?)` batched flush) is
touched — it exercises the coordinator on the ACTUAL renderer + ACP + scode path,
which the vitest unit tests do not.

## Prerequisites

1. Sudowork dev running with CDP :9230
     bash: `SUDOWORK_SKIP_PREREQ_CHECK=1 bun run start` from repo root
2. A conversation already opened OR a working "Sudo Code" assistant selectable
3. `agent.messageQueue = True` in `~/.nexus/config/sudowork-config.txt`
     (helpers: `tests/e2e/ops/_enterprise_config.py::set_config_value`)

## What it does

1. Types a very long prompt (msg A) that keeps the LLM busy for ~2 min
2. Fiber-walks the SendBox to confirm `loading=true` + `allowSubmitWhileRunning=true`
3. Queues B (`MARKER_B_...`) and C (`MARKER_C_...`) during A's turn
4. Fiber-walks again to confirm the coordinator queue grew to 2
5. Polls `~/.nexus/sudowork.db` until A's turn ends
6. Verifies the last user_text row for the conversation is the
   `\n\n`-joined combined B+C content (batched flush landed one row, not two)

Exit 0 → PASS, exit 1 → FAIL with the reason printed to stdout.

The YAML case `tests/e2e/cases/scode-interrupt-queue-batched-flush.yaml`
mirrors the same journey for the CI runner once #35 (seed CI e2e state) lands
— this Python script is the pre-#35 hand-verifiable equivalent, borrowing the
same fiber-probe pattern.
"""
from __future__ import annotations

import asyncio
import shutil
import sqlite3
import sys
import tempfile
import time
from pathlib import Path

from ai_dev_browser.cdp import input_ as cdp_input
from ai_dev_browser.core.connection import connect_browser
from ai_dev_browser.core.page import js_evaluate

MARKER_B = "MARKER_B_DURING_A_TURN"
MARKER_C = "MARKER_C_DURING_A_TURN"

# Long enough to reliably keep the LLM busy through B+C submission on any tier.
# Verified on 2026-07-11: kept turn active ~155 s under sudorouter `auto`.
PROMPT_A = (
    "Please write comprehensive documentation for a Python distributed logging "
    "library. Cover 20 sections: architecture, config, transports, filters, "
    "formatters, batching, retry policies, backpressure, high-availability, "
    "observability, security, compression, encryption, sampling, structured "
    "logging, correlation IDs, tracing integration, metrics integration, testing "
    "strategy, deployment. Write substantial detail for each."
)


FIBER_PROBE_JS = r"""
(() => {
  const ta = document.querySelector('textarea');
  let el = ta;
  for (let i = 0; i < 20 && el; i++) {
    const key = Object.keys(el).find(k => k.startsWith('__reactFiber'));
    if (key) {
      let f = el[key];
      while (f) {
        const p = f.memoizedProps;
        if (p && ('allowSubmitWhileRunning' in p || 'queuedInputs' in p)) {
          return {
            loading: !!p.loading,
            allow: !!p.allowSubmitWhileRunning,
            q: (p.queuedInputs || []).length,
            q_texts: (p.queuedInputs || []).map(x => x.preview),
          };
        }
        f = f.return;
      }
    }
    el = el.parentElement;
  }
  return {err: 'sendbox fiber not found'};
})()
"""


async def _fiber_state(tab):
    r = await js_evaluate(tab, FIBER_PROBE_JS)
    if isinstance(r, dict) and "result" in r:
        raw = r["result"]
    else:
        raw = r
    # ai-dev-browser returns CDP-shaped lists; normalize to plain dict.
    if isinstance(raw, list):
        return {k: v.get("value") if isinstance(v, dict) else v for k, v in raw}
    return raw if isinstance(raw, dict) else {"raw": raw}


async def _type_and_send(tab, text: str) -> None:
    await js_evaluate(
        tab,
        "(() => { const ta = document.querySelector('textarea'); if (ta) ta.focus(); })()",
    )
    await asyncio.sleep(0.15)
    for ch in text:
        await tab.send(cdp_input.dispatch_key_event(type_="char", text=ch))
    await asyncio.sleep(0.15)
    await tab.send(
        cdp_input.dispatch_key_event(
            type_="keyDown",
            key="Enter",
            code="Enter",
            windows_virtual_key_code=13,
            native_virtual_key_code=13,
        )
    )
    await tab.send(
        cdp_input.dispatch_key_event(
            type_="keyUp",
            key="Enter",
            code="Enter",
            windows_virtual_key_code=13,
            native_virtual_key_code=13,
        )
    )


def _copy_wal_snapshot() -> Path:
    src = Path.home() / ".nexus"
    dst = Path(tempfile.mkdtemp(prefix="sw-batched-flush-live-"))
    for name in ("sudowork.db", "sudowork.db-wal", "sudowork.db-shm"):
        s = src / name
        if s.exists():
            shutil.copy2(s, dst / name)
    return dst / "sudowork.db"


def _latest_conv_user_text_rows() -> list[dict]:
    con = sqlite3.connect(str(_copy_wal_snapshot()))
    con.row_factory = sqlite3.Row
    row = con.execute(
        "SELECT id FROM conversations ORDER BY updated_at DESC LIMIT 1"
    ).fetchone()
    if row is None:
        return []
    conv_id = row["id"]
    return [
        dict(r)
        for r in con.execute(
            "SELECT id, content, created_at FROM messages "
            "WHERE conversation_id=? AND type='text' AND position='right' "
            "ORDER BY created_at ASC",
            (conv_id,),
        )
    ]


async def main() -> int:
    async with await connect_browser(port=9230) as browser:
        tab = next(t for t in browser.tabs if t.title == "SudoWork")

        baseline_rows = len(_latest_conv_user_text_rows())
        print(f"baseline user_text rows: {baseline_rows}")

        state = await _fiber_state(tab)
        print(f"pre-A fiber state: {state}")
        if not state.get("allow"):
            print("FAIL: allowSubmitWhileRunning is off — enable messageQueue in config first")
            return 1

        print("\n=== sending msg A (long prompt) ===")
        await _type_and_send(tab, PROMPT_A)
        await asyncio.sleep(3)
        state = await _fiber_state(tab)
        print(f"post-A fiber state: {state}")
        if not state.get("loading"):
            print("FAIL: turn A did not enter loading state — check ACP setup")
            return 1

        print("\n=== queuing B during A ===")
        await _type_and_send(tab, MARKER_B)
        await asyncio.sleep(1)
        state = await _fiber_state(tab)
        print(f"post-B fiber state: {state}")
        if state.get("q", 0) < 1:
            print(f"FAIL: queue did not grow after B (q={state.get('q')})")
            return 1

        print("\n=== queuing C during A ===")
        await _type_and_send(tab, MARKER_C)
        await asyncio.sleep(1)
        state = await _fiber_state(tab)
        print(f"post-C fiber state: {state}")
        if state.get("q", 0) < 2:
            print(f"FAIL: queue did not grow after C (q={state.get('q')})")
            return 1

        print("\n=== polling DB for turn end + batched flush ===")
        deadline = time.time() + 300  # up to 5 min for the LLM to finish
        while time.time() < deadline:
            rows = _latest_conv_user_text_rows()
            if len(rows) >= baseline_rows + 2:
                # Baseline (A wasn't submitted yet) + A + combined B+C = baseline + 2
                combined = rows[-1]["content"]
                if MARKER_B in combined and MARKER_C in combined:
                    print(f"\nPASS: last user_text row contains both markers combined:")
                    print(f"  {combined[:300]}")
                    return 0
                print(f"FAIL: last user_text row missing markers; got: {combined[:200]}")
                return 1
            await asyncio.sleep(5)
            print(f"  ...still waiting (rows now {len(rows)}, want >= {baseline_rows + 2})")

        print("FAIL: timed out waiting for turn A + batched flush")
        return 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
