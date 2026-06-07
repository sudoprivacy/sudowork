"""sudowork `browser` dispatcher helper.

Invoked by the thin `browser` (bash) / `browser.cmd` (Windows) wrappers as:

    python3 browser_helper.py <tool> [args]
    python3 browser_helper.py --list
    python3 browser_helper.py --help

Runs `ai_dev_browser.tools.<name>` under the hood, captures stdout/stderr,
and POSTs results to the sudowork sidechannel.
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


def _candidate_skill_dirs() -> list[pathlib.Path]:
    """Return possible browser-skill directories in priority order.

    Never trusts ``$HOME``: scode/claude-code sandboxes rewrite ``$HOME`` to a
    per-session ``.sandbox-home`` directory that does not contain ``.nexus``,
    so ``pathlib.Path.home()`` would resolve to a non-existent path.

    Sources, in order:

    1. Explicit env vars (``NEXUS_HOME`` / ``SUDOWORK_NEXUS_HOME``) — injected
       by sudowork before the sandbox rewrites HOME, so they survive.
    2. ``PYTHONPATH`` entries that already encode the real skill dir
       (sudowork's ``prepareCleanEnv`` prepends this).
    3. ``__file__`` anchor: the deployed helper lives at
       ``<nexus>/sudoclaw/bin/browser_helper.py``, so three parents up is the
       real ``.nexus`` root — unaffected by sandbox HOME rewrites.
    """
    cands: list[pathlib.Path] = []
    for env_name in ("NEXUS_HOME", "SUDOWORK_NEXUS_HOME"):
        v = os.environ.get(env_name)
        if v:
            base = pathlib.Path(v)
            cands.append(base / "skills" / "_system" / "_builtin" / "browser")
            cands.append(base / "skills" / "_system" / "browser")
    for p in os.environ.get("PYTHONPATH", "").split(os.pathsep):
        if not p:
            continue
        entry = pathlib.Path(p)
        if entry.name == "browser" and entry.parent.name in ("_builtin", "_system"):
            cands.append(entry)
    try:
        here = pathlib.Path(__file__).resolve()
        # .../.nexus/sudoclaw/bin/browser_helper.py -> .../.nexus
        nexus_root = here.parent.parent.parent
        cands.append(nexus_root / "skills" / "_system" / "_builtin" / "browser")
        cands.append(nexus_root / "skills" / "_system" / "browser")
    except Exception:
        pass
    # Deduplicate while preserving order
    seen: set[str] = set()
    unique: list[pathlib.Path] = []
    for c in cands:
        key = str(c)
        if key not in seen:
            seen.add(key)
            unique.append(c)
    return unique


def _ensure_ai_dev_browser_on_sys_path() -> None:
    """Make ``ai_dev_browser`` importable.

    Strategy: try a plain ``import ai_dev_browser`` first — when sudowork
    bundles the package in site-packages (production) or the user ``pip
    install``s it (dev), the default ``sys.path`` already covers it and no
    path hackery is needed.

    Only if that fails do we fall back to candidate skill directories (see
    ``_candidate_skill_dirs``). This makes the helper robust under the scode
    sandbox where ``$HOME`` is rewritten to ``.sandbox-home`` and the legacy
    ``Path.home() / ".nexus" / ...`` heuristic resolves to a missing path.
    """
    try:
        import ai_dev_browser  # noqa: F401
        return
    except Exception:
        pass
    for d in _candidate_skill_dirs():
        try:
            if not d.is_dir():
                continue
        except OSError:
            continue
        d_str = str(d)
        if d_str in sys.path:
            continue
        sys.path.insert(0, d_str)
        try:
            import ai_dev_browser  # noqa: F401
            return
        except Exception:
            # Restore sys.path on failure so we don't pollute it with dead entries
            try:
                sys.path.remove(d_str)
            except ValueError:
                pass


_ensure_ai_dev_browser_on_sys_path()


def _tools_dir() -> pathlib.Path:
    """Return the on-disk location of the ai_dev_browser tools package.

    Resolves via the loaded module first (works regardless of whether the
    package came from a sudowork skill-dir symlink or a pip install). Falls
    back to the first candidate skill dir if the import is still unavailable
    (e.g. running ``--help`` on a machine where the package failed to load).
    """
    try:
        import ai_dev_browser  # type: ignore[import-not-found]
        return pathlib.Path(ai_dev_browser.__file__).resolve().parent / "tools"
    except Exception:
        for d in _candidate_skill_dirs():
            tools = d / "ai_dev_browser" / "tools"
            try:
                if tools.is_dir():
                    return tools
            except OSError:
                continue
        # Last-resort placeholder so error messages still print a useful path
        return pathlib.Path("ai_dev_browser/tools")


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

    # cmdHash is the correlation key for the sidechannel. Normalization
    # (collapse whitespace, strip ends) must match the sudowork side.
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
