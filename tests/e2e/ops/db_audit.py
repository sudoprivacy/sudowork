"""Post-run DB audit — count agent tool calls and assert thresholds.

App-specific e2e verification op. Reads ~/.nexus/sudowork.db after the
agent finishes responding and counts tool-call patterns that matter for
whatever we're testing (anti-pattern regressions, v0.8.x feature reach).

Sits in the "叫外援" slot at the END of a yaml case — it's not part of the
human UI drive-through, it's external ground-truth verification. Shape
matches judge.py ({pass, reason, ...}) so runner.py can count it as a
verification step.

WAL note: the DB is WAL-mode; reading the bare .db file misses in-flight
writes. We copy .db + .db-wal + .db-shm to a tmpdir before opening.
"""

import json
import operator
import re
import shutil
import sqlite3
import tempfile
from pathlib import Path

import state


_CMP = {">=": operator.ge, "<=": operator.le, "==": operator.eq,
        "!=": operator.ne, ">": operator.gt, "<": operator.lt}
_RULE_RE = re.compile(r"^(>=|<=|==|!=|>|<)\s*(-?\d+)$")


def _copy_wal_snapshot(src_dir: Path) -> Path:
    """Copy .db + .db-wal + .db-shm to a tmpdir and return the tmp .db path."""
    dst = Path(tempfile.mkdtemp(prefix="sudowork_audit_"))
    for name in ("sudowork.db", "sudowork.db-wal", "sudowork.db-shm"):
        s = src_dir / name
        if s.exists():
            shutil.copy2(s, dst / name)
    return dst / "sudowork.db"


def _extract_tool_output_text(content) -> str:
    """Pull the text payload out of an acp_tool_call content array."""
    if not isinstance(content, list):
        return ""
    for c in content:
        inner = c.get("content") if isinstance(c, dict) else None
        if isinstance(inner, dict) and inner.get("type") == "text":
            return inner.get("text", "") or ""
    return ""


def _count_metrics(rows):
    """rows: list of (id, type, content, status, created_at, position) tuples.

    Returns (counts_dict, trace_lines, user_text_bodies).
    `user_text_bodies` is the ordered list of user-typed text row bodies —
    exposed so tests can assert on content (e.g. batched-flush proving the
    LAST user_text row contains all three queued markers in ONE row).
    """
    m = {
        "total_messages": 0,
        "tool_calls": 0,
        # For the interrupt+queue e2e (§3.2 batched flush): a queue-mode drain of N
        # inputs must produce exactly ONE combined user message, not N. Count only
        # first-in-turn user messages (position=='right', type=='text', not a
        # continuation of a tool loop), and record the longest user message so a
        # test can also assert "did the combined batched turn make it in as one row".
        "user_text_messages": 0,
        "user_text_max_len": 0,
        "hint_field_seen": 0,          # v0.8.3 Failure: auto-inject
        "click_by_text_fails": 0,
        "find_by_text_calls": 0,
        "find_by_text_found": 0,
        "click_by_ref_calls": 0,
        "js_evaluate_calls": 0,
        "js_evaluate_with_navigated": 0,  # v0.8.4 rich-return usage
        "js_evaluate_with_console": 0,
        "js_evaluate_with_error": 0,
        "mouse_click_coord": 0,
        "python_scripts": 0,
        "browser_start_calls": 0,
        "page_screenshot_calls": 0,
        "read_calls": 0,
    }
    trace_lines = []
    user_text_bodies: list[str] = []
    for idx, (_id, rtype, content, status, _ts, position) in enumerate(rows):
        m["total_messages"] += 1
        if rtype != "acp_tool_call":
            snip = (content or "").replace("\n", " ")[:160]
            # User-typed text (position='right', type='text') for the batched-flush test.
            if rtype == "text" and position == "right":
                try:
                    payload_ = json.loads(content or "{}")
                    body = str(payload_.get("content", "") or "")
                except Exception:
                    body = ""
                m["user_text_messages"] += 1
                if len(body) > m["user_text_max_len"]:
                    m["user_text_max_len"] = len(body)
                user_text_bodies.append(body)
            trace_lines.append(f"[#{idx} {rtype} {position}] {snip}")
            continue
        try:
            payload = json.loads(content or "{}")
        except Exception:
            trace_lines.append(f"[#{idx} parse-err]")
            continue

        # `position` is bound from the outer tuple destructuring; unused for tool_call rows
        # but explicitly ignored here to keep the loop's structure symmetric.
        _ = position
        m["tool_calls"] += 1
        update = payload.get("update") or {}
        raw = update.get("rawInput") or {}
        cmd = (raw.get("command") or raw.get("path")
               or raw.get("file_path") or "")
        cmd_s = str(cmd)
        out = _extract_tool_output_text(update.get("content", []))

        if '"hint"' in out:
            m["hint_field_seen"] += 1
        # Match both `browser X` (CLI wrapper) and
        # `python -m ai_dev_browser.tools.X` (direct module invocation).
        # LLM uses both forms interchangeably, so treat them the same.
        def tool_ran(name: str) -> bool:
            return bool(re.search(
                rf"(?:^|\s)browser {name}\b|ai_dev_browser\.tools\.{name}\b",
                cmd_s,
            ))

        if tool_ran("find_by_text"):
            m["find_by_text_calls"] += 1
            if '"found": true' in out or '"found":true' in out:
                m["find_by_text_found"] += 1
        if tool_ran("click_by_text"):
            if '"clicked": false' in out or '"clicked":false' in out:
                m["click_by_text_fails"] += 1
        if tool_ran("click_by_ref"):
            m["click_by_ref_calls"] += 1
        if tool_ran("js_evaluate"):
            m["js_evaluate_calls"] += 1
            if '"navigated"' in out:
                m["js_evaluate_with_navigated"] += 1
            if '"console"' in out:
                m["js_evaluate_with_console"] += 1
            if '"error"' in out and re.search(r'"error"\s*:\s*\{', out):
                m["js_evaluate_with_error"] += 1
        if tool_ran("mouse_click"):
            m["mouse_click_coord"] += 1
        if tool_ran("browser_start"):
            m["browser_start_calls"] += 1
        if tool_ran("page_screenshot"):
            m["page_screenshot_calls"] += 1
        if re.search(r"python\b.*\.py", cmd_s):
            m["python_scripts"] += 1
        _title = update.get("title", "") or ""
        if _title == "read" or _title.startswith("read "):
            m["read_calls"] += 1

        title = update.get("title", "?")
        st = update.get("status", "?")
        out_snip = out[:120].replace("\n", " ")
        trace_lines.append(
            f"[#{idx} {title} {st}] CMD: {cmd_s[:120]} | OUT: {out_snip}"
        )
    return m, trace_lines, user_text_bodies


def _check_rule(value: int, rule: str) -> tuple:
    mat = _RULE_RE.match(str(rule).strip())
    if not mat:
        return False, f"bad rule '{rule}'"
    op, n = mat.group(1), int(mat.group(2))
    ok = _CMP[op](value, n)
    return ok, f"{value} {op} {n}"


async def db_audit(
    tab,
    conversation: str = "latest",
    since: str = "case_start",
    max_tool_calls: int = None,
    assert_metrics: dict = None,
    assert_last_user_text_regex: str = None,
    print_trace: bool = True,
    nexus_dir: str = None,
) -> dict:
    """Query sudowork DB, count metrics since cutoff, assert thresholds.

    Args:
        tab: Browser tab (unused — DB is source of truth; kept for op-signature parity)
        conversation: "latest" (default, picks most recently active) or
            an explicit conversation_id (exact match)
        since: "case_start" (uses state.CASE_START_MS set by runner) or
            an explicit ms-epoch as a string
        max_tool_calls: if set, fail when tool_calls > this
        assert_metrics: dict of {metric_name: rule_str}, e.g.
            {"hint_field_seen": ">= 1", "click_by_text_fails": "== 0"}
        assert_last_user_text_regex: pattern (re.DOTALL) that MUST match the
            LAST user-typed text row's body. Purpose: batched-flush case needs
            to prove that N queued messages merged into ONE user row containing
            ALL N markers — a shape assertion `user_text_messages == 2` alone
            passes even if the "batched" row is empty or contains one marker.
        print_trace: dump per-tool-call trace to stdout
        nexus_dir: override DB dir (default ~/.nexus)

    Returns:
        {"pass": bool, "reason": str, "counts": dict, "trace": str}
    """
    src = Path(nexus_dir) if nexus_dir else (Path.home() / ".nexus")
    if not (src / "sudowork.db").exists():
        return {"pass": False,
                "reason": f"DB not found at {src / 'sudowork.db'}",
                "counts": {}, "trace": ""}

    if since == "case_start":
        if state.CASE_START_MS == 0:
            return {"pass": False,
                    "reason": "state.CASE_START_MS is 0 — runner didn't mark case start",
                    "counts": {}, "trace": ""}
        cutoff_ms = state.CASE_START_MS
    else:
        cutoff_ms = int(since)

    db_path = _copy_wal_snapshot(src)
    con = sqlite3.connect(str(db_path))
    cur = con.cursor()

    if conversation == "latest":
        row = cur.execute(
            "SELECT conversation_id, MAX(created_at) FROM messages "
            "GROUP BY conversation_id ORDER BY 2 DESC LIMIT 1"
        ).fetchone()
        if not row:
            con.close()
            return {"pass": False, "reason": "no conversations in DB",
                    "counts": {}, "trace": ""}
        conv_id = row[0]
    else:
        conv_id = conversation

    rows = cur.execute(
        "SELECT id, type, content, status, created_at, position FROM messages "
        "WHERE conversation_id = ? AND created_at > ? ORDER BY created_at ASC",
        (conv_id, cutoff_ms),
    ).fetchall()
    con.close()

    counts, trace_lines, user_text_bodies = _count_metrics(rows)
    counts["conversation_id"] = conv_id
    counts["cutoff_ms"] = cutoff_ms

    failures = []
    if max_tool_calls is not None and counts["tool_calls"] > max_tool_calls:
        failures.append(
            f"tool_calls={counts['tool_calls']} > max_tool_calls={max_tool_calls}"
        )
    if assert_metrics:
        for metric, rule in assert_metrics.items():
            if metric not in counts:
                failures.append(f"unknown metric: {metric}")
                continue
            ok, desc = _check_rule(counts[metric], rule)
            if not ok:
                failures.append(f"{metric}: {desc}")
    if assert_last_user_text_regex:
        if not user_text_bodies:
            failures.append(
                f"assert_last_user_text_regex: no user_text rows found "
                f"(pattern={assert_last_user_text_regex!r})"
            )
        else:
            last_body = user_text_bodies[-1]
            if not re.search(assert_last_user_text_regex, last_body, re.DOTALL):
                snip = last_body.replace("\n", "\\n")[:200]
                failures.append(
                    f"assert_last_user_text_regex: pattern {assert_last_user_text_regex!r} "
                    f"did not match last user_text body {snip!r}"
                )

    passed = len(failures) == 0

    if print_trace:
        print("\n--- db_audit trace ---")
        for line in trace_lines:
            print("  " + line)
        print(f"--- counts: {json.dumps({k: v for k, v in counts.items() if k != 'conversation_id'})}")
        print(f"--- conversation: {conv_id}")

    reason = "all assertions passed" if passed else "; ".join(failures)
    return {
        "pass": passed,
        "reason": reason,
        "counts": counts,
        "trace": "\n".join(trace_lines),
    }
