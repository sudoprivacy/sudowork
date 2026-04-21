"""Wait for agent to finish responding.

Three modes:
- db (default): poll sudowork.db for activity gap + no in_progress tool_call
- programmatic: DOM-based (text stability + loading indicator) — legacy,
  false-positive when spinner blinks between tool calls
- llm: send screenshot to conversation agent for completion judgment
"""

import asyncio
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
                            expect: str = None, idle_seconds: float = 30,
                            poll_interval: float = 3) -> dict:
    """Wait for agent to finish responding.

    Args:
        tab: Browser tab
        timeout: Max seconds to wait
        mode: "db" (default — polls sudowork.db for activity),
              "programmatic" (legacy DOM-based), or
              "llm" (send screenshot to conversation agent)
        expect: For llm mode — what completion looks like
        idle_seconds: DB mode — consider done after this long with no new messages
        poll_interval: DB mode — seconds between DB snapshots

    Returns:
        {"done": True/False, "mode": str, ...}
    """
    if mode == "llm":
        return await _wait_llm(tab, timeout, expect)
    if mode == "programmatic":
        return await _wait_programmatic(tab, timeout)
    return await _wait_db(timeout, idle_seconds, poll_interval)


async def _wait_db(timeout: float, idle_seconds: float,
                   poll_interval: float) -> dict:
    """Poll sudowork.db for activity. Done when:
      (a) no new messages in the latest conversation for `idle_seconds`, AND
      (b) no acp_tool_call message has status 'in_progress'.

    Stronger than DOM text stability because it's the DB's own state —
    the UI indicator can blink between tool calls but the DB tells the
    truth about what the agent is doing.

    Uses state.CASE_START_MS as the lower bound when picking "which
    conversation is this test run in." Falls back to "latest activity"
    if state is unset (e.g. run_op.py direct invocation).
    """
    if state.CASE_START_MS == 0:
        return {"timeout": True, "mode": "db",
                "error": "state.CASE_START_MS is 0 — wait_for_response needs runner context"}

    nexus_dir = Path.home() / ".nexus"
    deadline = time.time() + timeout
    last_max_ts = state.CASE_START_MS
    idle_start = None
    conv_id = None
    poll_count = 0

    while time.time() < deadline:
        await asyncio.sleep(poll_interval)
        poll_count += 1

        db_path = _copy_wal(nexus_dir)
        try:
            con = sqlite3.connect(str(db_path))
            cur = con.cursor()

            # Pick the conversation carrying this run's messages — pinned
            # to the first one we see, so late side-activity in other
            # convs (notifications etc) doesn't confuse us.
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
                continue  # agent hasn't written anything yet

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
            con.close()
        finally:
            shutil.rmtree(db_path.parent, ignore_errors=True)

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
        elif time.time() - idle_start >= idle_seconds:
            return {"done": True, "mode": "db", "conversation_id": conv_id,
                    "idle_seconds": round(time.time() - idle_start, 1),
                    "polls": poll_count}

    return {"timeout": True, "mode": "db", "conversation_id": conv_id,
            "polls": poll_count}


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

    return {"timeout": True, "mode": "programmatic", "text": prev_text}


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
