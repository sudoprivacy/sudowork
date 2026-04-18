"""ai-dev-browser dispatcher helper (sudowork-side).

Invoked by the thin `aidb` (bash) / `aidb.cmd` (Windows) wrappers as:

    python aidb_helper.py <tool> [args]
    python aidb_helper.py --list
    python aidb_helper.py --help

Why a Python helper and not a pure shell dispatcher: sudowork's safety hook
(`AdbStdoutCapture`) can't tee `aidb`'s stdout at the Node layer without
deadlocking openclaw's paused-mode stream reader on Windows — attaching
`.on('data')` flips the child pipe to flowing mode and cmd.exe then blocks
on its own write. So the wrapper captures and POSTs to the sudowork
sidechannel itself. The hook still covers direct `python -m
ai_dev_browser.tools.*` invocations that don't go through aidb.
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


def _tools_dir() -> pathlib.Path:
    pp = os.environ.get("PYTHONPATH", "")
    sep = ";" if os.name == "nt" else ":"
    for entry in pp.split(sep):
        entry = entry.strip()
        if not entry:
            continue
        cand = pathlib.Path(entry) / "ai_dev_browser" / "tools"
        if cand.is_dir():
            return cand
    return (
        pathlib.Path.home()
        / ".nexus"
        / "skills"
        / "_system"
        / "browser"
        / "ai_dev_browser"
        / "tools"
    )


def _emit(buf: io.StringIO, line: str = "") -> None:
    buf.write(line)
    buf.write("\n")


def _print_help() -> str:
    buf = io.StringIO()
    _emit(buf, "Usage: aidb <tool> [args]")
    _emit(buf, "       aidb --list              # list available tools")
    _emit(buf, "       aidb <tool> --help       # tool-specific help")
    _emit(buf)
    _emit(buf, f"Tool files: {_tools_dir()}")
    out = buf.getvalue()
    sys.stdout.write(out)
    sys.stdout.flush()
    return out


def _list_tools() -> tuple[int, str, str]:
    td = _tools_dir()
    if not td.is_dir():
        err = f"Error: tools directory not found: {td}\n"
        sys.stderr.write(err)
        sys.stderr.flush()
        return 1, "", err
    buf = io.StringIO()
    for f in sorted(td.glob("*.py")):
        name = f.stem
        if not name.startswith("_"):
            _emit(buf, name)
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
    body = json.dumps(
        {
            "callId": os.environ.get(
                "AI_DEV_BROWSER_CALL_ID", f"aidb-self-{os.urandom(8).hex()}"
            ),
            "cmd": "aidb " + " ".join(argv),
            "argv": argv,
            "pid": os.getpid(),
            "ppid": os.getppid(),
            "startedAt": started_ms,
            "finishedAt": finished_ms,
            "exitCode": exit_code,
            "stdoutRaw": visible,
            "stdoutJson": None,
            "cmdHash": "aidb-self",
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
    return _run_tool(argv[0], argv[1:])


if __name__ == "__main__":
    sys.exit(main())
