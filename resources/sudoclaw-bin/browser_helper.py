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
    """Locate the browser skill directory containing the ai_dev_browser symlink.

    SSOT: PYTHONPATH is set by sudowork (acpConnectors.ts) and points to
    the correct skill dir. scode sandbox only rewrites HOME/TMPDIR, not
    PYTHONPATH, so this is reliable.
    """
    pythonpath = os.environ.get("PYTHONPATH", "")
    for entry in pythonpath.split(os.pathsep):
        candidate = pathlib.Path(entry)
        if (candidate / "ai_dev_browser").is_dir():
            return candidate
    # Fallback for direct invocation outside sudowork
    try:
        import pwd
        home = pathlib.Path(pwd.getpwuid(os.getuid()).pw_dir)
    except Exception:
        home = pathlib.Path(os.path.expanduser("~"))
    return home / ".nexus" / "skills" / "_system" / "_builtin" / "browser"


def _ensure_ai_dev_browser_on_sys_path() -> None:
    """Prepend the browser skill dir to sys.path so `import ai_dev_browser`
    resolves to the sudowork-vendored package, not a stale pip install.
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
