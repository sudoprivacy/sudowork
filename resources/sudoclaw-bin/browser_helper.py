"""sudowork `browser` dispatcher helper (sudowork-side).

Invoked by the thin `browser` (bash) / `browser.cmd` (Windows) wrappers as:

    python browser_helper.py <tool> [args]
    python browser_helper.py --list
    python browser_helper.py --help

Underlying runtime is the upstream `ai_dev_browser` Python package; we expose
it to the LLM as `browser` instead of `aidb` because the self-explanatory
name cuts down on LLM "what is aidb?" probing from the tool list alone.

Why a Python helper and not a pure shell dispatcher: sudowork's safety hook
(`AdbStdoutCapture`) can't tee the wrapper's stdout at the Node layer
without deadlocking openclaw's paused-mode stream reader on Windows —
attaching `.on('data')` flips the child pipe to flowing mode and cmd.exe
then blocks on its own write. So the wrapper captures and POSTs to the
sudowork sidechannel itself. The hook still covers direct `python -m
ai_dev_browser.tools.*` invocations that don't go through our wrapper.
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import pathlib
import runpy
import sys
import time
import urllib.request


def _browser_skill_dir() -> pathlib.Path:
    """The sudowork system-skills browser dir that holds the junction to
    the upstream ai_dev_browser package.

    We intentionally do NOT trust `PYTHONPATH` here: openclaw's exec tool
    sanitizes the host env and strips `PYTHONPATH` (along with other
    interpreter-path vars) before spawning children, so by the time this
    helper runs we're guaranteed to see an empty/absent PYTHONPATH even
    though sudowork sets it on the gateway process. Resolving the skill
    path directly from `~/.nexus/skills/_system/browser` makes the
    helper self-sufficient and decouples it from openclaw's env-security
    policy.
    """
    return pathlib.Path.home() / ".nexus" / "skills" / "_system" / "browser"


def _ensure_ai_dev_browser_on_sys_path() -> None:
    """Prepend the sudowork skill dir to `sys.path` so `import
    ai_dev_browser` resolves to the junction-linked upstream package
    rather than any stale pip-installed copy that might be sitting in
    the invoking Python's site-packages (e.g. a leftover
    `pip install ai-dev-browser` from earlier dev work).

    Without this, a developer who once ran `pip install -e` on the
    package into their venv gets that stale copy forever, and the
    LLM sees whatever docstrings / tool signatures were current when
    the install happened — not what the submodule is pinned to today.
    The breakage mode is subtle (no error, just wrong content) and was
    the root cause of the 2026-04-18 lis8 e2e investigation, so we fix
    it once and for all at import time.
    """
    skill_dir = _browser_skill_dir()
    if not skill_dir.is_dir():
        return
    skill_dir_str = str(skill_dir)
    if skill_dir_str in sys.path:
        return
    sys.path.insert(0, skill_dir_str)


_ensure_ai_dev_browser_on_sys_path()


def _tools_dir() -> pathlib.Path:
    return _browser_skill_dir() / "ai_dev_browser" / "tools"


def _emit(buf: io.StringIO, line: str = "") -> None:
    buf.write(line)
    buf.write("\n")


def _print_help() -> str:
    buf = io.StringIO()
    _emit(buf, "Usage: browser <tool> [args]")
    _emit(buf, "       browser --list              # list available tools")
    _emit(buf, "       browser <tool> --help       # tool-specific help")
    _emit(buf)
    _emit(buf, "Typical first-run sequence:")
    _emit(buf, "       browser browser_start       # spin up Chrome once per session")
    _emit(buf, "       browser page_goto --url …   # navigate the running browser")
    _emit(buf)
    _emit(buf, f"Tool files: {_tools_dir()}")
    out = buf.getvalue()
    sys.stdout.write(out)
    sys.stdout.flush()
    return out


def _list_tools() -> tuple[int, str, str]:
    """Emit each tool on its own line as `name  <first docstring line>`.

    The summary is read from `ai_dev_browser.core.<name>.__doc__` — upstream
    owns that text and updates it whenever a tool changes, so we pick up any
    new/changed descriptions automatically on the next upstream bump (no
    hand-maintained description table to drift against reality). Missing
    docstring falls back to the name alone.

    Cost: ~0.8s cold for ~45 tools (one `import ai_dev_browser.core` + 45
    `getattr` + `inspect.getdoc`); near-zero on warm calls.
    """
    td = _tools_dir()
    if not td.is_dir():
        err = f"Error: tools directory not found: {td}\n"
        sys.stderr.write(err)
        sys.stderr.flush()
        return 1, "", err
    import inspect

    try:
        from ai_dev_browser import core  # type: ignore[import-not-found]
    except Exception:
        core = None  # type: ignore[assignment]
    names = sorted(f.stem for f in td.glob("*.py") if not f.stem.startswith("_"))
    # Left-pad names for stable column alignment; floor at 20 so short names
    # still read cleanly against the summary column.
    name_col = max(20, max((len(n) for n in names), default=0))
    buf = io.StringIO()
    for name in names:
        summary = ""
        if core is not None:
            fn = getattr(core, name, None)
            if fn is not None:
                doc = (inspect.getdoc(fn) or "").strip()
                if doc:
                    summary = doc.split("\n", 1)[0].strip()
        _emit(buf, f"{name:<{name_col}}  {summary}".rstrip())
    # Append sudowork-provided entries AFTER the ai_dev_browser tool
    # block, with an explicit `(sudowork)` prefix on the summary so the
    # LLM can tell upstream tools from orchestrator extensions at a
    # glance — important because filing bugs for a `(sudowork)` tool
    # against ai-dev-browser upstream would be a wrong-blame. The
    # `repl` entry itself is the sole orchestrator-provided tool
    # today; its full usage is one `browser repl --help` away.
    _emit(
        buf,
        f"{'repl':<{name_col}}  "
        "(sudowork) Use when: chaining 4+ atomic ops (e.g. login form, multi-step nav) — define Python fns, state + `tab` persist across calls.",
    )
    out = buf.getvalue()
    sys.stdout.write(out)
    sys.stdout.flush()
    return 0, out, ""


def _post_sidechannel(
    *,
    argv: list[str],
    stdout: str,
    stderr: str,
    exit_code: int,
    started_ms: int,
    finished_ms: int,
) -> None:
    url = os.environ.get("AI_DEV_BROWSER_SIDECHANNEL_URL")
    secret = os.environ.get("AI_DEV_BROWSER_SIDECHANNEL_SECRET")
    if not url or not secret:
        return
    visible = stdout if stdout.strip() else stderr
    import hashlib

    # cmd and cmdHash are the correlation keys the sudowork side uses to
    # pop the right sidechannel entry for a given tool_call event. The
    # normalization here (collapse internal whitespace, strip ends) must
    # stay byte-identical to what sudowork's `OpenClawAgent` does on the
    # tool_call event's `args.command` field — they both feed the same
    # sha1. Any drift makes the hash miss and sudowork falls back to
    # global FIFO, which is racy when tool_calls parallelize (lis8 e2e
    # step 23/24 observed).
    cmd_str = "browser " + " ".join(argv)
    cmd_norm = " ".join(cmd_str.split())
    cmd_hash = hashlib.sha1(cmd_norm.encode("utf-8")).hexdigest()
    body = json.dumps(
        {
            "callId": os.environ.get(
                "AI_DEV_BROWSER_CALL_ID",
                f"browser-self-{os.urandom(8).hex()}",
            ),
            "cmd": cmd_norm,
            "argv": argv,
            "pid": os.getpid(),
            "ppid": os.getppid(),
            "startedAt": started_ms,
            "finishedAt": finished_ms,
            "exitCode": exit_code,
            "stdoutRaw": visible,
            "stdoutJson": None,
            "cmdHash": cmd_hash,
            "truncated": False,
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Content-Length": str(len(body)),
            "X-Adb-Secret": secret,
        },
    )
    try:
        urllib.request.urlopen(req, timeout=1.5).close()
    except Exception:
        # Sidechannel is best-effort; never fail the tool call because of
        # reporting trouble.
        pass


REPL_INFO_PATH = pathlib.Path.home() / ".nexus" / "sudoclaw" / "repl-server.json"


def _read_repl_info() -> dict | None:
    """Load the running REPL server's {pid, port, secret} info file.

    Returns None if the file is absent or malformed. Liveness is
    verified downstream by `_probe_repl_health`, which additionally
    confirms the PID on the port matches the file's PID — that
    combination is stronger than a pid-exists check and works
    uniformly on both POSIX and Windows (where `os.kill(pid, 0)`
    raises rather than returning a boolean).
    """
    try:
        info = json.loads(REPL_INFO_PATH.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return None
    if not isinstance(info.get("pid"), int):
        return None
    return info


def _probe_repl_health(info: dict, *, timeout: float = 0.5) -> bool:
    """Confirm the server at `info` is actually answering /health.

    Stale-pid mitigation isn't enough on its own: a PID can be recycled
    by the OS to an unrelated process in the same second that we
    crashed. A GET /health on the port settles it — either we get
    `{"ok": true, "pid": <expected>}` or we assume the slot is dead.
    """
    try:
        req = urllib.request.Request(
            f"http://127.0.0.1:{info['port']}/health",
            method="GET",
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if resp.status != 200:
                return False
            payload = json.loads(resp.read().decode("utf-8"))
            return payload.get("pid") == info.get("pid")
    except Exception:
        return False


def _spawn_repl_server() -> dict:
    """Start `browser_repl_server.py` as a detached child and poll the
    discovery file until it shows up. Returns the {pid, port, secret}
    dict or raises RuntimeError on timeout.

    We can't use `subprocess.run` + block — the server is long-lived.
    On POSIX we'd use `os.setsid`; on Windows we use the DETACHED_
    PROCESS creation flag so the child outlives this dispatcher.
    """
    import subprocess

    here = pathlib.Path(__file__).parent
    server_py = here / "browser_repl_server.py"

    kwargs: dict = {
        "stdin": subprocess.DEVNULL,
        "stdout": subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
        "close_fds": True,
    }
    if sys.platform == "win32":
        DETACHED_PROCESS = 0x00000008  # noqa: N806
        CREATE_NEW_PROCESS_GROUP = 0x00000200  # noqa: N806
        kwargs["creationflags"] = DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
    else:
        kwargs["start_new_session"] = True

    subprocess.Popen([sys.executable, str(server_py)], **kwargs)

    # Poll the info file for up to ~5s. Server needs time to bind a
    # port, write the file atomically, and become healthy.
    deadline = time.time() + 5.0
    while time.time() < deadline:
        info = _read_repl_info()
        if info and _probe_repl_health(info):
            return info
        time.sleep(0.1)
    raise RuntimeError("browser repl server failed to start within 5s")


def _ensure_repl_server() -> dict:
    """Return a live server's connection info, spawning one if needed."""
    info = _read_repl_info()
    if info and _probe_repl_health(info):
        return info
    return _spawn_repl_server()


_REPL_HELP = """\
Use when: you're about to chain 4+ atomic browser ops (e.g. login:
type user → type pw → type captcha → click submit) and the combined
cold-start overhead (~700ms × N calls) would dominate. The REPL keeps
one Python interpreter + one CDP connection alive across calls, so
every call after the first is ~10ms + the actual work.

Usage:
  browser repl '<python code>'

Pre-bound globals (no imports needed):
  tab                  ready-to-use Tab attached to the running Chrome
  type_by_html_id      every public function in ai_dev_browser.core
  click_by_ref         (type_by_ref, click_by_ref, page_discover,
  page_screenshot       page_screenshot, html_by_ref, page_goto, ...)
  ...                   ──────────────────────────────────────────
  asyncio              for asyncio.sleep, asyncio.gather, etc.
  _                    the last non-None expression value (REPL convention)

Semantics:
  - top-level `await` works directly (no asyncio.run wrapper)
  - last expression's repr() is returned as `=> ...` (Jupyter style)
  - exceptions render as a Python traceback
  - state persists: definitions in call N are callable in call N+1

Examples:
  # Define once, invoke twice (captcha retry doesn't redefine the fn):
  browser repl '
  async def login(user, pw, captcha):
      await type_by_html_id(tab, "UserCode2", user)
      await type_by_html_id(tab, "UserPass2", pw)
      await type_by_html_id(tab, "Captcha", captcha)
      await click_by_html_id(tab, "submit")
  '
  browser repl 'await login("alice", "secret", "9830")'
  browser repl 'await login("alice", "secret", "6726")'   # captcha was wrong, retry

  # Cache an expensive lookup for later use:
  browser repl 'elements = (await page_discover(tab))["elements"]; len(elements)'
  browser repl '[e for e in elements if e.get("role") == "button"]'

When NOT to use:
  - single-operation calls: `browser click_by_text --text "Sign in"` is
    already atomic, has its own per-action feedback (navigated/url_after),
    and doesn't pay the REPL-server startup cost. Don't use repl just
    because you could — use it when chaining saves meaningful steps.
  - exploration / probing: atomic tools print structured JSON per call;
    repr'd Python objects inside the REPL are less skimmable.
"""


def _run_repl(rest: list[str]) -> int:
    """POST the user's Python snippet to the persistent REPL server and
    print its JSON response in a LLM-friendly format.

    Input convention: everything after `browser repl` is joined as the
    Python source, same as `python -c "..."`. Empty input prints a
    usage hint; `--help` / `-h` prints the full doc (same shape as
    the ai_dev_browser tools' own --help, so the LLM's discovery
    flow is uniform: --list → pick tool → tool --help → invoke).
    """
    started = int(time.time() * 1000)
    if rest and rest[0] in ("--help", "-h"):
        sys.stdout.write(_REPL_HELP)
        sys.stdout.flush()
        _post_sidechannel(
            argv=["repl", "--help"],
            stdout=_REPL_HELP,
            stderr="",
            exit_code=0,
            started_ms=started,
            finished_ms=int(time.time() * 1000),
        )
        return 0
    code = " ".join(rest).strip() if rest else ""
    if not code:
        msg = (
            "Usage: browser repl '<python code>'  "
            "(run `browser repl --help` for the full doc)\n"
        )
        sys.stderr.write(msg)
        sys.stderr.flush()
        _post_sidechannel(
            argv=["repl"],
            stdout="",
            stderr=msg,
            exit_code=2,
            started_ms=started,
            finished_ms=int(time.time() * 1000),
        )
        return 2

    try:
        info = _ensure_repl_server()
    except Exception as exc:
        err = f"failed to start browser repl server: {exc}\n"
        sys.stderr.write(err)
        sys.stderr.flush()
        _post_sidechannel(
            argv=["repl"] + rest,
            stdout="",
            stderr=err,
            exit_code=1,
            started_ms=started,
            finished_ms=int(time.time() * 1000),
        )
        return 1

    body = json.dumps({"code": code}).encode("utf-8")
    req = urllib.request.Request(
        f"http://127.0.0.1:{info['port']}/exec",
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Content-Length": str(len(body)),
            "X-Repl-Secret": info["secret"],
        },
    )
    try:
        # No outer timeout: user code may legitimately run for minutes
        # (waiting on a page_wait_ready, a slow navigation, etc.). The
        # server-side asyncio loop is what bounds blocking CDP calls;
        # if the server itself wedges, openclaw's exec timeout will
        # catch us at a higher layer.
        with urllib.request.urlopen(req) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except Exception as exc:
        err = f"browser repl transport failure: {exc}\n"
        sys.stderr.write(err)
        sys.stderr.flush()
        _post_sidechannel(
            argv=["repl"] + rest,
            stdout="",
            stderr=err,
            exit_code=1,
            started_ms=started,
            finished_ms=int(time.time() * 1000),
        )
        return 1

    # Format for LLM consumption:
    #   - any user-side stdout passes through first (prints the LLM did
    #     inside their snippet)
    #   - then the repr of the last expression value, if any, preceded
    #     by a stable marker (`=> `) so the LLM can ignore prints and
    #     lock onto the result when the snippet was eval-style
    #   - stderr appended last, distinguished by the `[stderr] ` prefix
    #   - errors render as a Python-style traceback block the LLM
    #     already recognises from countless tracebacks in training data
    stdout_raw = payload.get("stdout") or ""
    stderr_raw = payload.get("stderr") or ""
    result_repr = payload.get("result")
    error_info = payload.get("error")

    out_parts: list[str] = []
    if stdout_raw:
        out_parts.append(stdout_raw if stdout_raw.endswith("\n") else stdout_raw + "\n")
    if result_repr is not None:
        out_parts.append(f"=> {result_repr}\n")
    combined_stdout = "".join(out_parts)

    err_parts: list[str] = []
    if stderr_raw:
        err_parts.append(stderr_raw if stderr_raw.endswith("\n") else stderr_raw + "\n")
    if error_info is not None:
        tb = error_info.get("traceback") or f"{error_info.get('type')}: {error_info.get('message')}"
        err_parts.append(tb if tb.endswith("\n") else tb + "\n")
    combined_stderr = "".join(err_parts)

    sys.stdout.write(combined_stdout)
    sys.stdout.flush()
    sys.stderr.write(combined_stderr)
    sys.stderr.flush()

    exit_code = 1 if error_info is not None else 0
    _post_sidechannel(
        argv=["repl"] + rest,
        stdout=combined_stdout,
        stderr=combined_stderr,
        exit_code=exit_code,
        started_ms=started,
        finished_ms=int(time.time() * 1000),
    )
    return exit_code


def _run_tool(tool: str, rest: list[str]) -> int:
    # Map hyphens to underscores to match the ai_dev_browser module naming
    # convention (e.g. `aidb page-info` → `ai_dev_browser.tools.page_info`).
    module = f"ai_dev_browser.tools.{tool.replace('-', '_')}"
    # Emulate `python -m <module>` argv layout: argv[0] is the module path.
    original_argv = sys.argv
    sys.argv = [module] + rest
    out_buf, err_buf = io.StringIO(), io.StringIO()
    started = int(time.time() * 1000)
    try:
        with contextlib.redirect_stdout(out_buf), contextlib.redirect_stderr(err_buf):
            try:
                runpy.run_module(module, run_name="__main__")
                exit_code = 0
            except SystemExit as ex:
                code = ex.code
                exit_code = code if isinstance(code, int) else (0 if code is None else 1)
            except Exception as ex:  # pragma: no cover — surface tracebacks in stderr
                import traceback

                traceback.print_exc(file=err_buf)
                exit_code = 1
    finally:
        sys.argv = original_argv
    finished = int(time.time() * 1000)
    stdout = out_buf.getvalue()
    stderr = err_buf.getvalue()
    # Pass through — preserve byte-for-byte (text-mode newlines stay LF/CRLF
    # as captured; no recoding).
    sys.stdout.write(stdout)
    sys.stdout.flush()
    sys.stderr.write(stderr)
    sys.stderr.flush()
    _post_sidechannel(
        argv=[tool] + rest,
        stdout=stdout,
        stderr=stderr,
        exit_code=exit_code,
        started_ms=started,
        finished_ms=finished,
    )
    return exit_code


def main() -> int:
    argv = sys.argv[1:]
    started = int(time.time() * 1000)
    if not argv or argv[0] in ("-h", "--help"):
        out = _print_help()
        _post_sidechannel(
            argv=argv or ["--help"],
            stdout=out,
            stderr="",
            exit_code=0,
            started_ms=started,
            finished_ms=int(time.time() * 1000),
        )
        return 0
    if argv[0] == "--list":
        code, out, err = _list_tools()
        _post_sidechannel(
            argv=["--list"],
            stdout=out,
            stderr=err,
            exit_code=code,
            started_ms=started,
            finished_ms=int(time.time() * 1000),
        )
        return code
    if argv[0] == "repl":
        # `repl` is a sudowork-side orchestration tool (persistent
        # Python interpreter for batching atomic ops + state reuse)
        # rather than an ai_dev_browser.tools.* module, so it's
        # handled before the upstream tool-dispatch path.
        return _run_repl(argv[1:])
    return _run_tool(argv[0], argv[1:])


if __name__ == "__main__":
    sys.exit(main())
