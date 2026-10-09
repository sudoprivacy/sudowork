"""Wait for agent to finish responding.

Three modes:
- db (default): poll sudowork.db for activity gap + no in_progress tool_call
- programmatic: DOM-based (text stability + loading indicator) — legacy,
  false-positive when spinner blinks between tool calls
- llm: send screenshot to conversation agent for completion judgment
"""

import asyncio
import json
import shutil
import sqlite3
import tempfile
import time
from pathlib import Path

from ai_dev_browser.core.page import js_evaluate

import state

from .screenshot import screenshot


async def _get_page_text(tab) -> str:
    r = await js_evaluate(tab, "document.body.innerText")
    return r.get("result", "")


def _copy_wal(nexus_dir: Path) -> Path:
    """Copy .db + .db-wal + .db-shm to tmpdir and return tmp .db path."""
    dst = Path(tempfile.mkdtemp(prefix="sudowork_wait_"))
    for name in ("sudowork.db", "sudowork.db-wal", "sudowork.db-shm"):
        s = nexus_dir / name
        if s.exists():
            shutil.copy2(s, dst / name)
    return dst / "sudowork.db"


async def wait_for_response(tab, timeout: float = 120, mode: str = "db",
                            expect: str = None, expect_text=None,
                            expect_min_count: int = 1, idle_seconds: float = 30,
                            poll_interval: float = 3) -> dict:
    """Wait for agent to finish responding.

    Args:
        tab: Browser tab
        timeout: Max seconds to wait
        mode: "db" (default — polls sudowork.db for activity),
              "programmatic" (legacy DOM-based), or
              "llm" (send screenshot to conversation agent)
        expect: For llm mode — what completion looks like
        expect_text: For db mode — a substring or list of substrings that must
              appear in THIS turn's assistant `text` reply (the DB ground truth).
              When set, the turn-done signals (task_status/idle) are not enough:
              the wait holds until the answer actually contains this content,
              stepping past intermediate narrations ("I'll fetch it…") that a
              reasoning-heavy model emits as separate text rows before its real
              answer. Doubles as the content assertion — a timeout fails.
        expect_min_count: db mode — min number of expect_text entries required.
        idle_seconds: DB mode — consider done after this long with no new messages
        poll_interval: DB mode — seconds between DB snapshots

    Returns:
        {"done": True/False, "mode": str, ...}
    """
    if mode == "llm":
        return await _wait_llm(tab, timeout, expect)
    if mode == "programmatic":
        return await _wait_programmatic(tab, timeout)
    return await _wait_db(timeout, idle_seconds, poll_interval, tab=tab,
                          expect_text=expect_text, expect_min_count=expect_min_count)


def _assistant_answer_has(cur, conv_id, since_ts, needles, min_count) -> bool:
    """True when >= min_count of `needles` appear in assistant `text` bodies
    at/after `since_ts` (this turn's answer). Reads the DB — robust where a live
    DOM walk misses a streamed reply."""
    rows = cur.execute(
        "SELECT content FROM messages WHERE conversation_id = ? AND type = 'text' "
        "AND position = 'left' AND created_at >= ?",
        (conv_id, since_ts),
    ).fetchall()
    hay_parts = []
    for (content,) in rows:
        try:
            hay_parts.append(str(json.loads(content or "{}").get("content", "") or ""))
        except Exception:
            hay_parts.append(content or "")
    hay = " ".join(hay_parts).lower()
    hits = [n for n in needles if str(n).lower() in hay]
    return len(hits) >= min_count


async def _wait_db(timeout: float, idle_seconds: float,
                   poll_interval: float, tab=None,
                   expect_text=None, expect_min_count: int = 1) -> dict:
    """Poll agent task status + DB activity. Done when:
      (a) agent task status is 'finished' (via IPC bridge), OR
      (b) no new messages for `idle_seconds` AND no in_progress tool_call
          (fallback when IPC is unavailable)

    When `expect_text` is set, the ONLY success condition is that content
    appearing in this turn's assistant reply — the done signals above are not
    accepted on their own, since a chatty model reaches 'finished'/idle only
    after several intermediate narration rows that precede the real answer.

    Primary signal: `ipcBridge.conversation.get` returns status from the
    live task object (WorkerManage). This is the ground truth — the agent
    sets status='finished' when its turn ends.

    Fallback: DB message activity gap (for cases where tab is unavailable).
    """
    needles = None
    if expect_text is not None:
        needles = [expect_text] if isinstance(expect_text, str) else list(expect_text)
    if state.CASE_START_MS == 0:
        return {"pass": False, "mode": "db",
                "reason": "state.CASE_START_MS is 0 — wait_for_response needs runner context"}

    nexus_dir = Path.home() / ".nexus"
    deadline = time.time() + timeout
    last_max_ts = state.CASE_START_MS
    idle_start = None
    conv_id = None
    poll_count = 0

    while time.time() < deadline:
        await asyncio.sleep(poll_interval)
        poll_count += 1

        # ── Step 1: Find the conversation ID from DB ──
        db_path = _copy_wal(nexus_dir)
        try:
            con = sqlite3.connect(str(db_path))
            cur = con.cursor()

            if conv_id is None:
                row = cur.execute(
                    "SELECT conversation_id, MAX(created_at) FROM messages "
                    "WHERE created_at > ? "
                    "GROUP BY conversation_id ORDER BY 2 DESC LIMIT 1",
                    (state.CASE_START_MS,),
                ).fetchone()
                if row:
                    conv_id = row[0]

            if conv_id is None:
                con.close()
                continue

            latest = cur.execute(
                "SELECT MAX(created_at) FROM messages WHERE conversation_id = ?",
                (conv_id,),
            ).fetchone()
            latest_ts = latest[0] if latest and latest[0] else state.CASE_START_MS

            in_progress = cur.execute(
                "SELECT 1 FROM messages WHERE conversation_id = ? "
                "AND type = 'acp_tool_call' AND status = 'in_progress' LIMIT 1",
                (conv_id,),
            ).fetchone()

            # Has THIS turn produced an assistant reply yet? position 'right' =
            # user, 'left' = assistant. A reasoning-heavy model (claude-opus via
            # 'auto') emits `thought`/`acp_tool_call` rows for many seconds before
            # its final `text` answer; meanwhile task.status can still read
            # 'finished' from the PRIOR turn, which returned mid-think. Require a
            # `text` assistant row at/after the latest user message before
            # accepting completion.
            last_user = cur.execute(
                "SELECT MAX(created_at) FROM messages "
                "WHERE conversation_id = ? AND position = 'right'",
                (conv_id,),
            ).fetchone()
            last_user_ts = last_user[0] if last_user and last_user[0] else 0
            saw_reply = cur.execute(
                "SELECT 1 FROM messages WHERE conversation_id = ? AND type = 'text' "
                "AND position = 'left' AND created_at >= ? LIMIT 1",
                (conv_id, last_user_ts),
            ).fetchone() is not None
            expect_ok = needles is None or _assistant_answer_has(
                cur, conv_id, last_user_ts, needles, expect_min_count)
            con.close()
        finally:
            shutil.rmtree(db_path.parent, ignore_errors=True)

        # ── Content gate: when expect_text is set, the awaited answer arriving
        # in the DB is the only success signal (a chatty model reaches
        # 'finished'/idle only after intermediate narration rows). ──
        if needles is not None:
            if expect_ok:
                return {"done": True, "mode": "db", "conversation_id": conv_id,
                        "signal": "expect_text_present", "polls": poll_count}
            continue

        # ── Step 2: Check agent task status via IPC (primary signal) ──
        # Query task.status through the renderer's IPC bridge. When the
        # agent finishes its turn, WorkerManage sets status='finished'.
        # Uses tab.evaluate with await_promise=True (js_evaluate doesn't
        # await Promises).
        #
        # Gate on `not in_progress`: right after a send, or between tool calls,
        # task.status can still read 'finished' from the PREVIOUS turn before the
        # new one registers — which returned mid-turn (judged while a tool_call
        # was still running). If a tool_call is in_progress the turn is not done,
        # whatever the status says, so don't accept 'finished' yet.
        if tab and conv_id and not in_progress and saw_reply:
            try:
                task_status = await tab.evaluate(f"""
                    (async function() {{
                        var e = window.__bridgeEmitter;
                        if (!e) return 'no_emitter';
                        return new Promise(function(resolve) {{
                            var ch = 'get-conversation';
                            var id = ch + '_' + Date.now();
                            var key = 'subscribe.callback-' + ch + id;
                            var h = function(r) {{ e.off(key, h); resolve(r && r.status ? r.status : 'unknown'); }};
                            e.on(key, h);
                            window.electronAPI.emit('subscribe-' + ch, {{id: id, data: {{id: '{conv_id}'}}}});
                            setTimeout(function() {{ e.off(key, h); resolve('ipc_timeout'); }}, 3000);
                        }});
                    }})()
                """, await_promise=True, return_by_value=True, timeout=5)
                if task_status == "finished":
                    return {"done": True, "mode": "db", "conversation_id": conv_id,
                            "signal": "task_status=finished",
                            "polls": poll_count}
            except Exception:
                pass  # fall through to DB-based check

        # ── Step 3: Fallback — DB activity gap check ──
        if in_progress:
            idle_start = None
            last_max_ts = latest_ts
            continue

        if latest_ts > last_max_ts:
            last_max_ts = latest_ts
            idle_start = None
            continue

        if idle_start is None:
            idle_start = time.time()
        elif saw_reply and time.time() - idle_start >= idle_seconds:
            return {"done": True, "mode": "db", "conversation_id": conv_id,
                    "signal": "idle_timeout",
                    "idle_seconds": round(time.time() - idle_start, 1),
                    "polls": poll_count}

    if needles is not None:
        return {"pass": False, "mode": "db", "conversation_id": conv_id,
                "reason": f"expected content {needles} (>= {expect_min_count}) did not "
                          f"appear in the assistant reply within {timeout}s (polls={poll_count})"}
    return {"pass": False, "mode": "db", "conversation_id": conv_id,
            "reason": f"agent turn did not complete within {timeout}s (polls={poll_count})"}


async def _wait_programmatic(tab, timeout: float) -> dict:
    """Legacy DOM-based wait. Kept for cases where DB isn't available.

    False-positives when the loading spinner blinks between tool calls,
    which is why db mode is the new default.
    """
    prev_text = ""
    stable_count = 0

    for _ in range(int(timeout / 3)):
        await asyncio.sleep(3)
        text = await _get_page_text(tab)

        has_loading = "正在处理中" in text
        has_permission = "Always Allow" in text and "Reject" in text

        spinner_check = await js_evaluate(tab, """(() => {
            const spinner = document.querySelector('.loading-spinner, .ant-spin, [class*="spinner"], [class*="loading"]');
            const sendBtn = document.querySelector('[class*="send"]');
            const isProcessing = sendBtn && sendBtn.closest('[class*="processing"], [class*="disabled"]');
            return !!(spinner || isProcessing);
        })()""")
        has_spinner = spinner_check.get("result", False)

        if has_loading or has_permission or has_spinner:
            stable_count = 0
            prev_text = text
            continue

        if text == prev_text:
            stable_count += 1
        else:
            stable_count = 0
            prev_text = text

        if stable_count >= 3:
            return {"done": True, "mode": "programmatic", "text": text}

    return {"pass": False, "mode": "programmatic", "text": prev_text,
            "reason": f"page text did not stabilise within {timeout}s"}


async def _wait_llm(tab, timeout: float, expect: str = None) -> dict:
    """Send screenshot to conversation agent and ask if task is complete."""
    from .type_text import type_text
    from .press_key import press_key

    for _ in range(10):
        await asyncio.sleep(3)
        text = await _get_page_text(tab)
        if "正在处理中" not in text:
            break

    ss = await screenshot(tab)
    import os
    abs_path = os.path.abspath(ss.get("path", ""))

    prompt = expect or "Has the agent completed its task? Look at the conversation."
    judgment_prompt = (
        f"@{abs_path} "
        f"[E2E Completion Check] {prompt} "
        f"Reply EXACTLY: DONE or WORKING"
    )

    await type_text(tab, judgment_prompt, wait=0.5)
    await press_key(tab, key='Enter', wait=15)

    text = await _get_page_text(tab)
    if "DONE" in text[-500:]:
        return {"done": True, "mode": "llm", "text": text}

    return {"done": False, "mode": "llm", "text": text}
