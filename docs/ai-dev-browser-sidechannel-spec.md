# ai-dev-browser — optional sidechannel POST (drop-in spec)

Owner: ai-dev-browser team.
Purpose: optional defense-in-depth for sudowork's UI bypass of the openclaw exec wrapper. Sudowork already captures the full stdout of `python -m ai_dev_browser.tools.*` via a Node-level hook (`AdbStdoutCapture`) and posts it to a localhost sidechannel. This spec describes a parallel Python-side POST that makes the same handoff independent of the Node hook.

**Status**: optional. If the Node hook is working, applying this spec is pure redundancy. Apply when a future openclaw release changes the `spawn` pipeline in a way that breaks the Node hook, or when ai-dev-browser is used outside sudowork/openclaw and a similar consumer wants the same sidechannel contract.

## Contract

Environment variables the caller may set:

- `AI_DEV_BROWSER_SIDECHANNEL_URL` — e.g. `http://127.0.0.1:53712/capture`
- `AI_DEV_BROWSER_SIDECHANNEL_SECRET` — 32+ byte hex string
- `AI_DEV_BROWSER_CALL_ID` — optional, provided by sudowork's Node hook per-invocation; fall back to `uuid.uuid4().hex`

POST body shape (JSON, UTF-8):

```json
{
  "callId": "abcd1234…",
  "cmd": "python",
  "argv": ["-m", "ai_dev_browser.tools.page_info", "--url", "…"],
  "pid": 12345,
  "ppid": 12340,
  "startedAt": 1713345200123,
  "finishedAt": 1713345200456,
  "exitCode": 0,
  "stdoutRaw": "{\"path\": \"/tmp/shot.png\", ...}",
  "stdoutJson": { "path": "/tmp/shot.png" },
  "cmdHash": "<sha1 of `{cmd}\\n{cwd}`>"
}
```

Required headers: `X-Adb-Secret: <secret>`, `Content-Type: application/json`. The receiver authenticates with `hmac.compare_digest`-style constant-time comparison, and rejects bodies over 8 MB.

## Drop-in code

In `ai_dev_browser/_cli.py`, add a best-effort helper and call it from each `print(json.dumps(...))` site. Do **not** change stdout byte-for-byte — the sidechannel POST augments, never replaces, the printed output.

```python
# Near top of _cli.py, after the existing imports
import hashlib
import os
import sys
import time
import uuid
import json
from urllib import request as _urlreq
from urllib.error import URLError

_ADB_CALL_START: float | None = None
_ADB_CALL_ID: str | None = None


def _adb_call_id() -> str:
    global _ADB_CALL_ID
    if _ADB_CALL_ID is None:
        _ADB_CALL_ID = os.environ.get("AI_DEV_BROWSER_CALL_ID") or uuid.uuid4().hex
    return _ADB_CALL_ID


def _adb_cmd_hash() -> str:
    cmd = (sys.argv[0] if sys.argv else "").strip()
    cwd = os.getcwd()
    h = hashlib.sha1()
    h.update(cmd.encode("utf-8", errors="replace"))
    h.update(b"\n")
    h.update(cwd.encode("utf-8", errors="replace"))
    return h.hexdigest()


def _post_sidechannel(stdout_text: str, *, exit_code: int | None = 0) -> None:
    """Best-effort POST of the full tool result to the sudowork sidechannel.

    All errors are swallowed — the sidechannel is optional defense-in-depth.
    """
    url = os.environ.get("AI_DEV_BROWSER_SIDECHANNEL_URL")
    secret = os.environ.get("AI_DEV_BROWSER_SIDECHANNEL_SECRET")
    if not url or not secret:
        return
    global _ADB_CALL_START
    started_at = int((_ADB_CALL_START or time.time()) * 1000)
    finished_at = int(time.time() * 1000)
    try:
        stdout_json = json.loads(stdout_text) if stdout_text.strip() else None
    except Exception:
        stdout_json = None
    try:
        ppid = os.getppid()
    except Exception:
        ppid = -1
    payload = {
        "callId": _adb_call_id(),
        "cmd": sys.argv[0] if sys.argv else "",
        "argv": list(sys.argv[1:]),
        "pid": os.getpid(),
        "ppid": ppid,
        "startedAt": started_at,
        "finishedAt": finished_at,
        "exitCode": exit_code,
        "stdoutRaw": stdout_text,
        "stdoutJson": stdout_json,
        "cmdHash": _adb_cmd_hash(),
    }
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = _urlreq.Request(
        url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "X-Adb-Secret": secret,
        },
        method="POST",
    )
    try:
        _urlreq.urlopen(req, timeout=0.5).read()
    except (URLError, OSError):
        pass


def _emit_and_capture(payload: dict, *, exit_code: int | None = 0) -> None:
    """Print JSON to stdout (unchanged behavior) and POST to sidechannel."""
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    print(text)
    _post_sidechannel(text, exit_code=exit_code)
```

Then inside `cli_main()` (the function that dispatches each tool):

1. Record the start time once: `global _ADB_CALL_START; _ADB_CALL_START = time.time()` immediately before the dispatch.
2. Replace each bare `print(json.dumps(...))` emission with `_emit_and_capture({...}, exit_code=0)` (or `exit_code=1` on error paths).

Touch points (current `_cli.py` line numbers):

- **Success JSON dump around line 287** (`print(json.dumps(result, ensure_ascii=False, indent=2))` inside the async `run()` branch) — replace with `_emit_and_capture(result, exit_code=0)`.
- **Sync success dump around line 303** — same replacement.
- **Port-missing error around line 264** — `_emit_and_capture({"error": "No available Chrome found. ..."}, exit_code=1)` before `sys.exit(1)`.
- **Async exception catch around line 290** — `_emit_and_capture({"error": str(e)}, exit_code=1)`.
- **Sync exception catch around line 306** — same replacement.
- **`output()` helper at line 318** — mirror the same pattern: `_emit_and_capture({...}, exit_code=0)`.
- **`error()` helper at line 323** — call `_emit_and_capture({"error": message}, exit_code=code)` before `sys.exit(code)`.

## Non-goals

- Do not change the existing stdout format. Downstream tools (openclaw, sudowork) parse the printed JSON byte-for-byte.
- Do not add a new CLI flag or configuration file. The feature is purely env-var gated.
- Do not add a new dependency — use only stdlib (`urllib.request`, `json`, `hashlib`, `uuid`, `time`, `os`).
- Do not retry on failure. Sidechannel absence is expected and must not add latency.

## Verification

Minimal smoke test (from the sudowork repo after applying this spec):

```bash
AI_DEV_BROWSER_SIDECHANNEL_URL=http://127.0.0.1:9999/capture \
AI_DEV_BROWSER_SIDECHANNEL_SECRET=dummy \
python -m ai_dev_browser.tools.page_info --help
# Expected: stdout prints normally; one failed POST attempt (silently swallowed).
```

With a real receiver (for example a trivial `nc -l 9999`-style listener), verify the POST body matches the contract above and that removing the env vars returns the tool to pre-spec behavior with no overhead.

## Coordination

Sudowork tracks this behind `docs/plan-browser-bypass.md` (Phase 4). The matching Node hook lives at `hook/node/src/process/AdbStdoutCapture.ts` and is verified to work in the current build; this spec exists as redundancy that ai-dev-browser can apply on its own timeline without breaking sudowork.
