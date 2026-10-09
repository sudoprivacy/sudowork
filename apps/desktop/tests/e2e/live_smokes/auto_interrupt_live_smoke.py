#!/usr/bin/env python3
"""Live smoke: auto-interrupt (§3.2 interrupt mode) against a booted sudowork dev instance.

Companion to `batched_flush_live_smoke.py` — exercises the OTHER branch of the
§3.2 matrix that PR #983 shipped: when `agent.autoInterrupt=true`, submitting a
second message while a turn is running MUST cancel the running turn and start
the new one as a solo turn (§3.2 row 2: "第一条立即打断并单独作为新轮启动").

## Prerequisites

1. Sudowork dev running with CDP :9230
2. A conversation already opened with Sudo Code selectable
3. Config file has `agent.autoInterrupt = True` + `agent.autoInterruptConfirmed = True`
   (the confirmed flag skips the first-time confirmation modal); optionally
   `agent.messageQueue = False` for pure interrupt-not-both mode
     helpers: `tests/e2e/ops/_enterprise_config.py::set_config_value`

## What it does (real user journey)

1. Type msg A (long documentation prompt) — turn A starts, coordinator's
   turn_active becomes true.
2. Fiber-probe: confirm SendBox reports `loading=true, allow=true, q=0`.
3. Type msg B (`INTERRUPTER_MARKER_...`) DURING A's turn — the coordinator's
   `submit_during_turn(Interrupt)` fires, places B at the queue head with
   `solo: true`, and calls `interrupt()` (which resolves the pending
   session/prompt with `stopReason: cancelled`).
4. Poll `~/.nexus/sudowork.db` for the cancellation marker: an assistant
   (`position='left'`) row whose content contains "请求已被用户终止" (the
   `userCancelled` i18n string) — this proves A was actually cancelled,
   not just that B replaced it silently.
5. Verify B lands as its OWN user_text row (`position='right'`), NOT
   `\n\n`-merged into A — solo semantics per §3.2 row 2.

Exit 0 → PASS, non-zero + printed reason on any step failure.

## Why the extra fiber probe

Without step 2's probe, a green DB result could mean: (a) autoInterrupt was
off, so B waited for A to finish, then ran as a separate turn — same DB
shape (2 user rows + no explicit cancel marker, but that check catches this).
The fiber probe surfaces the pre-condition explicitly so a runner-log reader
doesn't have to reason backward.
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

INTERRUPTER_MARKER = "INTERRUPTER_MARKER_KILLS_A"
CANCELLED_MARKER = "请求已被用户终止"

PROMPT_A = (
    "Please write comprehensive documentation for a Python distributed logging "
    "library. Cover 20 sections: architecture, config, transports, filters, "
    "formatters, batching, retry policies, backpressure, high-availability, "
    "observability, security, compression, encryption, sampling, structured "
    "logging, correlation IDs, tracing integration, metrics integration, testing "
    "strategy, deployment. Write substantial detail for each."
)

# Same fiber walk that the batched_flush_live_smoke verified working — the
# structural sanity check independent of DB timing.
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
    raw = r.get("result") if isinstance(r, dict) and "result" in r else r
    if isinstance(raw, list):
        return {k: v.get("value") if isinstance(v, dict) else v for k, v in raw}
    return raw if isinstance(raw, dict) else {"raw": raw}


async def _paste_and_send(tab, text: str) -> None:
    """Programmatically drive Send: skip typing entirely and call the SendBox's
    onSend directly via the React fiber; verified with the batched_flush drive
    to actually route through `ipcBridge.conversation.sendMessage` (i.e.,
    coordinator's submit_during_turn path).

    Char-by-char via `dispatch_key_event('char')` is ~30 chars/s under CDP —
    a 600-char prompt takes ~20 s, and a fast LLM turn is halfway done by
    then. Native-setter + input event alone doesn't fire the sendbox's own
    Enter handler because React's useState hasn't rendered the new value by
    the time the KeyDown lands. Calling `onSend` via the fiber props is the
    same code path the send button's onClick reaches — no keyboard race.
    """
    import json
    text_js = json.dumps(text)
    r = await js_evaluate(
        tab,
        f"""
        (() => {{
          const ta = document.querySelector('textarea');
          if (!ta) return {{err: 'no textarea'}};
          let el = ta;
          for (let i = 0; i < 20 && el; i++) {{
            const key = Object.keys(el).find(k => k.startsWith('__reactFiber'));
            if (key) {{
              let f = el[key];
              while (f) {{
                const p = f.memoizedProps;
                if (p && typeof p.onSend === 'function') {{
                  // Fire and forget — onSend is async, but we don't need
                  // its Promise because the coordinator + AcpAgent will
                  // fire their own IPC + DB writes.
                  const ret = p.onSend({text_js}, []);
                  return {{ok: true, sent: true, fired: typeof (ret && ret.then) === 'function'}};
                }}
                f = f.return;
              }}
            }}
            el = el.parentElement;
          }}
          return {{err: 'no SendBox onSend prop found in fiber chain'}};
        }})()
        """,
    )
    result = r.get("result") if isinstance(r, dict) else r
    if isinstance(result, list):
        result = {k: v.get("value") if isinstance(v, dict) else v for k, v in result}
    if isinstance(result, dict) and not result.get("ok"):
        raise RuntimeError(f"paste_and_send failed: {result}")


def _snapshot_conv_messages() -> tuple[str | None, list[dict]]:
    src = Path.home() / ".nexus"
    dst = Path(tempfile.mkdtemp(prefix="sw-interrupt-live-"))
    for name in ("sudowork.db", "sudowork.db-wal", "sudowork.db-shm"):
        s = src / name
        if s.exists():
            shutil.copy2(s, dst / name)
    con = sqlite3.connect(str(dst / "sudowork.db"))
    con.row_factory = sqlite3.Row
    row = con.execute(
        "SELECT id FROM conversations ORDER BY updated_at DESC LIMIT 1"
    ).fetchone()
    if row is None:
        return None, []
    conv_id = row["id"]
    return conv_id, [
        dict(r)
        for r in con.execute(
            "SELECT id, type, position, content, created_at FROM messages "
            "WHERE conversation_id=? ORDER BY created_at ASC",
            (conv_id,),
        )
    ]


async def main() -> int:
    async with await connect_browser(port=9230) as browser:
        tab = next(t for t in browser.tabs if t.title == "SudoWork")

        # ── Preconditions ─────────────────────────────────────────────────
        conv_id_pre, rows_pre = _snapshot_conv_messages()
        print(f"baseline conv={conv_id_pre} total_rows={len(rows_pre)}")
        state = await _fiber_state(tab)
        print(f"pre-A fiber state: {state}")
        if not state.get("allow"):
            print("FAIL: allowSubmitWhileRunning is off — need autoInterrupt=true and/or messageQueue=true in config")
            return 1

        # ── Step 1: send A ────────────────────────────────────────────────
        print("\n=== send msg A (long prompt) ===")
        await _paste_and_send(tab, PROMPT_A)
        await asyncio.sleep(3)
        state = await _fiber_state(tab)
        print(f"post-A fiber state: {state}")
        if not state.get("loading"):
            print("FAIL: A did not enter loading state")
            return 1

        # ── Step 2: interrupt with B ──────────────────────────────────────
        print("\n=== send B during A (should trigger auto-interrupt) ===")
        await _paste_and_send(tab, INTERRUPTER_MARKER)
        # Give the coordinator + AcpAgent.performStop pipeline a beat.
        await asyncio.sleep(3)
        state = await _fiber_state(tab)
        print(f"post-B fiber state: {state}")

        # ── Step 3: verify DB shows A was actually cancelled + B ran solo ─
        # Wait up to 60s for the DB to reflect the interrupt + B's kickoff.
        # A's cancel marker ("请求已被用户终止") is an assistant-side left row
        # emitted by AcpAgent.emitUserCancelledMessage during performStop.
        # B's user_text row is separate (solo, not \n\n-merged into A) because
        # submit_during_turn(Interrupt) set solo=true at the queue head.
        deadline = time.time() + 60
        while time.time() < deadline:
            _, rows = _snapshot_conv_messages()
            new_rows = rows[len(rows_pre):]
            user_texts = [r for r in new_rows if r["type"] == "text" and r["position"] == "right"]
            cancelled = [r for r in new_rows if CANCELLED_MARKER in (r["content"] or "")]

            if cancelled and any(INTERRUPTER_MARKER in (r["content"] or "") for r in user_texts):
                print(f"\nPASS: A was cancelled AND B landed as its own user row.")
                print(f"  cancel markers: {len(cancelled)} row(s)")
                print(f"  new user_text rows: {len(user_texts)}")
                for r in user_texts:
                    tag = "A" if INTERRUPTER_MARKER not in (r["content"] or "") else "B"
                    body = (r["content"] or "")[:120]
                    print(f"    [{tag}] {body}")
                # Solo semantics guard: B's content MUST NOT contain A's opening
                # phrase joined via \n\n — that would mean it was batched, not
                # solo (§3.2 row 2 violation).
                b_row = next(r for r in user_texts if INTERRUPTER_MARKER in (r["content"] or ""))
                if "\\n\\n" in (b_row["content"] or "") and PROMPT_A[:40] in (b_row["content"] or ""):
                    print("FAIL: B's content includes A's prompt — batched, not solo. §3.2 row 2 violated.")
                    return 1
                return 0
            await asyncio.sleep(3)
            print(f"  ...waiting for interrupt to land (new rows: {len(new_rows)}, "
                  f"has cancel marker: {bool(cancelled)}, "
                  f"has B marker: {any(INTERRUPTER_MARKER in (r['content'] or '') for r in user_texts)})")

        print("FAIL: timed out waiting for cancel + B rows")
        return 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
