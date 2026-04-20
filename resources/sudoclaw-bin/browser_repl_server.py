"""Long-running Python REPL server for the `browser repl` tool.

The file has two halves, separated by the `# ── sudowork orchestration
below ──` marker. The top half is **generic** — if ai-dev-browser
upstream ever ships a `ReplKernel`, the top half is what gets replaced
by a 1-line `from ai_dev_browser import ReplKernel` import. The bottom
half is sudowork-specific — HTTP transport, process lifecycle, the
discovery file at `~/.nexus/sudoclaw/repl-server.json`, and the CLI
entrypoint that `browser_helper.py` spawns.

Why split inside one file (for now)
-----------------------------------
The sudoclaw-bin directory is a flat pool of scripts that get copied
into `~/.nexus/sudoclaw/bin/`, not a Python package with module paths.
Keeping the kernel + orchestration in one file matches that deployment
shape while still encoding the generic/sudowork boundary with a
prominent comment marker, so future extraction is a file split rather
than an API redesign.

Why a dedicated server at all
-----------------------------
Each `python -c "..."` invocation pays:
  * Python interpreter cold start   ~200ms
  * `import ai_dev_browser.core`    ~150ms
  * Port detection + CDP connect    ~250ms
  * `get_active_tab`                ~50ms
  ────────────────────────────────
  Total: ~650ms of overhead **before** the actual work runs, repeated
  every tool_call. For a 60-step task that is ~40 seconds of waste.

By keeping the interpreter + CDP connection hot across calls, the
overhead collapses to one cold start per `browser_start` session;
subsequent `browser repl` calls are ~10ms transport + whatever the
user's code itself takes. The LLM can also define functions once and
reuse them across tool_calls, which is impossible with per-call python.
"""

from __future__ import annotations

import argparse
import ast
import asyncio
import contextlib
import hmac
import http.server
import io
import json
import os
import pathlib
import secrets
import signal
import socketserver
import sys
import threading
import traceback
from typing import Any


def _ensure_ai_dev_browser_on_sys_path() -> None:
    """Prepend the sudowork skill-dir to `sys.path` so `import
    ai_dev_browser` resolves to the junction-linked upstream package
    rather than any stale pip-installed copy.

    Mirrors `browser_helper.py._ensure_ai_dev_browser_on_sys_path`.
    This server runs in a separately-spawned Python process that
    doesn't inherit PYTHONPATH (openclaw's safety hook strips it), so
    we resolve the skill path directly from
    `~/.nexus/skills/_system/browser`, the same junction the helper
    uses.
    """
    skill_dir = pathlib.Path.home() / ".nexus" / "skills" / "_system" / "browser"
    if not skill_dir.is_dir():
        return
    skill_dir_str = str(skill_dir)
    if skill_dir_str in sys.path:
        return
    sys.path.insert(0, skill_dir_str)


_ensure_ai_dev_browser_on_sys_path()


# ────────────────────────────────────────────────────────────────────
# Generic ReplKernel — ship candidate for ai-dev-browser upstream.
#
# Implements the three responsibilities a browser-bound Python REPL
# needs regardless of which orchestrator hosts it:
#   1. `start()`      — pre-import ai_dev_browser.core and open a
#                       `quick_connect` session so `tab` + every core
#                       function are ready in the exec namespace before
#                       any user code runs. Graceful on Chrome being
#                       absent (REPL still works for pure Python).
#   2. `exec(code)`   — IPython-style compile/eval:
#                         * parse as exec; peel off the trailing
#                           `ast.Expr` if present;
#                         * compile the rest with
#                           `PyCF_ALLOW_TOP_LEVEL_AWAIT` so bare
#                           `await foo()` at module level just works;
#                         * run + await; then eval the trailing
#                           expression for a Jupyter-style return
#                           value; bind it to `_`.
#                       Returns a JSON-safe dict: {stdout, stderr,
#                       result, error}.
#   3. `stop()`       — close the quick_connect CDP connection.
#
# Kept orchestrator-agnostic: no HTTP, no process spawning, no
# discovery, no CLI. A hypothetical `ai_dev_browser.ReplKernel` would
# be this class verbatim. When/if that lands upstream, the sudowork
# orchestration below becomes `from ai_dev_browser import ReplKernel`
# with no semantic change.
# ────────────────────────────────────────────────────────────────────


class ReplKernel:
    """Persistent Python exec kernel with ai-dev-browser globals pre-bound."""

    def __init__(self) -> None:
        # Clean module namespace — matches what a freshly-imported
        # `python -c` script's globals would hold, so code the LLM
        # writes runs the same way in the REPL as outside it.
        self._globals: dict[str, Any] = {"__name__": "__main__", "__doc__": None}
        # quick_connect context manager + yielded Tab — held for the
        # kernel's lifetime so `stop()` can close the CDP connection
        # cleanly. `None` until `start()` succeeds.
        self._qc_cm: Any = None
        self._qc_tab: Any = None

    @property
    def globals(self) -> dict[str, Any]:
        """Exposed so orchestrators can inject additional names (e.g.
        their own helpers) before `start()`. Users of the kernel should
        NOT mutate this after exec calls begin; it's shared with every
        running user snippet.
        """
        return self._globals

    async def start(self) -> None:
        """Bind `ai_dev_browser.core` functions + an attached `tab` into
        the exec globals. Never raises: if ai_dev_browser is missing or
        no Chrome is reachable, the kernel still works for pure-Python
        snippets and the orchestrator can surface a warning. Any code
        the LLM writes that needs `tab` will raise `NameError` at
        exec time, which is the right behaviour — "missing tab" is a
        user-code concern, not a kernel-start concern.
        """
        self._globals.setdefault("asyncio", asyncio)

        try:
            import ai_dev_browser  # type: ignore[import-not-found]
            from ai_dev_browser import core as _core  # type: ignore[import-not-found]
        except Exception as exc:
            sys.stderr.write(f"[ReplKernel] ai_dev_browser import failed: {exc!r}\n")
            sys.stderr.flush()
            return

        self._globals["ai_dev_browser"] = ai_dev_browser
        self._globals["core"] = _core
        self._globals["quick_connect"] = getattr(ai_dev_browser, "quick_connect", None)
        # Pull every public callable from `core` into globals — that's
        # type_by_ref, click_by_ref, page_discover, etc. Skip dunders
        # and submodules so the namespace stays browsable.
        for name in dir(_core):
            if name.startswith("_"):
                continue
            obj = getattr(_core, name)
            if callable(obj):
                self._globals[name] = obj

        quick_connect = self._globals.get("quick_connect")
        if quick_connect is None:
            sys.stderr.write(
                "[ReplKernel] ai_dev_browser.quick_connect not found "
                "(need v0.6.2+); `tab` will not be pre-bound\n"
            )
            sys.stderr.flush()
            return

        try:
            cm = quick_connect()
            tab = await cm.__aenter__()
        except Exception as exc:
            sys.stderr.write(
                f"[ReplKernel] quick_connect failed "
                f"(continuing without `tab`): {exc!r}\n"
            )
            sys.stderr.flush()
            return

        self._qc_cm = cm
        self._qc_tab = tab
        self._globals["tab"] = tab
        sys.stderr.write(
            "[ReplKernel] ai_dev_browser.core bound; `tab` ready via quick_connect\n"
        )
        sys.stderr.flush()

    async def stop(self) -> None:
        """Release the quick_connect CDP connection. Never raises."""
        if self._qc_cm is None:
            return
        try:
            await self._qc_cm.__aexit__(None, None, None)
        except Exception as exc:
            sys.stderr.write(f"[ReplKernel] quick_connect teardown warning: {exc!r}\n")
            sys.stderr.flush()
        finally:
            self._qc_cm = None
            self._qc_tab = None

    async def exec(self, code: str) -> dict:
        """Run `code` in the persistent globals.

        Returns a dict with keys:
          * stdout (str)   — whatever user code printed to stdout
          * stderr (str)   — …and to stderr
          * result (str | None) — `repr()` of the trailing expression's
                                  value, or None if the last statement
                                  isn't an expression (or is None)
          * error  (dict | None) — {type, message, traceback} on
                                   exception; None on success

        Top-level `await` works directly. The split-last-expression
        eval is what lets `await x` work as both a statement (inline
        side-effect) and an expression (returns value as `=> ...`).
        """
        stdout = io.StringIO()
        stderr = io.StringIO()
        result_repr: str | None = None
        error_info: dict | None = None

        try:
            tree = ast.parse(code, filename="<repl>", mode="exec")
        except SyntaxError as exc:
            return {
                "stdout": "",
                "stderr": "",
                "result": None,
                "error": {
                    "type": "SyntaxError",
                    "message": str(exc),
                    "traceback": traceback.format_exc(),
                },
            }

        last_expr: ast.Expr | None = None
        if tree.body and isinstance(tree.body[-1], ast.Expr):
            last_expr = tree.body.pop()  # type: ignore[assignment]

        try:
            with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                if tree.body:
                    body_code = compile(
                        ast.Module(body=tree.body, type_ignores=[]),
                        "<repl>",
                        "exec",
                        flags=ast.PyCF_ALLOW_TOP_LEVEL_AWAIT,
                    )
                    maybe_coro = eval(body_code, self._globals)  # noqa: S307
                    if asyncio.iscoroutine(maybe_coro):
                        await maybe_coro

                if last_expr is not None:
                    expr_code = compile(
                        ast.Expression(body=last_expr.value),
                        "<repl-expr>",
                        "eval",
                        flags=ast.PyCF_ALLOW_TOP_LEVEL_AWAIT,
                    )
                    value = eval(expr_code, self._globals)  # noqa: S307
                    if asyncio.iscoroutine(value):
                        value = await value
                    if value is not None:
                        # Python REPL convention: `_` = last non-None
                        # expression value, so follow-up snippets can
                        # reference it without the LLM having to
                        # assign every intermediate.
                        self._globals["_"] = value
                        try:
                            result_repr = repr(value)
                        except Exception as exc:
                            result_repr = f"<unrepresentable: {exc!r}>"
        except BaseException as exc:
            error_info = {
                "type": type(exc).__name__,
                "message": str(exc),
                "traceback": traceback.format_exc(),
            }

        return {
            "stdout": stdout.getvalue(),
            "stderr": stderr.getvalue(),
            "result": result_repr,
            "error": error_info,
        }


# ────────────────────────────────────────────────────────────────────
# ── sudowork orchestration below ──
#
# Everything past this marker is sudowork-specific plumbing around
# `ReplKernel`: HTTP transport with a per-server shared secret, the
# discovery file at `~/.nexus/sudoclaw/repl-server.json` that lets the
# dispatcher find a running instance, process spawn / shutdown via
# signals, and the CLI entrypoint the dispatcher calls. None of this
# belongs upstream — each orchestrator (sudowork, Claude Code, etc.)
# has its own process-lifecycle and transport choices.
# ────────────────────────────────────────────────────────────────────


REPL_INFO_PATH = pathlib.Path.home() / ".nexus" / "sudoclaw" / "repl-server.json"

_SECRET: str = ""
_KERNEL: ReplKernel | None = None
_MAIN_LOOP: asyncio.AbstractEventLoop | None = None
_SHUTDOWN_EVENT: asyncio.Event | None = None


class _ReplHTTPHandler(http.server.BaseHTTPRequestHandler):
    """Minimal HTTP handler. Routes:
      GET  /health     — liveness probe, no auth required
      POST /exec       — run Python code; requires X-Repl-Secret
      POST /shutdown   — stop the server; requires X-Repl-Secret
    """

    def log_message(self, format: str, *args: Any) -> None:
        # Silence the default per-request stderr spam; the dispatcher
        # only cares about the response body.
        return

    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _check_secret(self) -> bool:
        provided = self.headers.get("X-Repl-Secret", "")
        return hmac.compare_digest(provided, _SECRET)

    def do_GET(self) -> None:  # noqa: N802 — stdlib API
        if self.path == "/health":
            self._json(200, {"ok": True, "pid": os.getpid()})
            return
        self._json(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802 — stdlib API
        if not self._check_secret():
            self._json(401, {"error": "unauthorized"})
            return

        length = int(self.headers.get("Content-Length", "0") or 0)
        raw = self.rfile.read(length) if length > 0 else b""
        try:
            body = json.loads(raw.decode("utf-8")) if raw else {}
        except json.JSONDecodeError as exc:
            self._json(400, {"error": f"bad json: {exc}"})
            return

        if self.path == "/shutdown":
            if _MAIN_LOOP is not None and _SHUTDOWN_EVENT is not None:
                _MAIN_LOOP.call_soon_threadsafe(_SHUTDOWN_EVENT.set)
            self._json(202, {"ok": True})
            return

        if self.path == "/exec":
            code = body.get("code", "")
            if not isinstance(code, str):
                self._json(400, {"error": "code must be a string"})
                return
            if _MAIN_LOOP is None or _KERNEL is None:
                self._json(503, {"error": "kernel not ready"})
                return
            # Marshal the coroutine onto the main event loop (the one
            # that owns quick_connect's Tab listener task) and wait
            # for its result. Running it here in the HTTP thread's
            # event loop would divorce it from that listener and the
            # CDP round-trip would hang.
            fut = asyncio.run_coroutine_threadsafe(_KERNEL.exec(code), _MAIN_LOOP)
            try:
                result = fut.result()
            except Exception as exc:
                self._json(
                    500,
                    {
                        "error": "server-side exec failure",
                        "detail": repr(exc),
                        "traceback": traceback.format_exc(),
                    },
                )
                return
            self._json(200, result)
            return

        self._json(404, {"error": "not found"})


class _ReuseAddrHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    """Threaded HTTP server so long-running exec calls don't block
    concurrent health probes from the dispatcher. Daemon threads
    mean shutdown doesn't have to gracefully join every outstanding
    request.
    """

    daemon_threads = True
    allow_reuse_address = True


def _write_info_file(port: int) -> None:
    REPL_INFO_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPL_INFO_PATH.write_text(
        json.dumps(
            {"pid": os.getpid(), "port": port, "secret": _SECRET},
            indent=2,
        ),
        encoding="utf-8",
    )


def _remove_info_file() -> None:
    with contextlib.suppress(FileNotFoundError):
        REPL_INFO_PATH.unlink()


async def _main_async(host: str, port_pref: int) -> None:
    global _MAIN_LOOP, _SHUTDOWN_EVENT, _SECRET, _KERNEL

    _MAIN_LOOP = asyncio.get_running_loop()
    _SHUTDOWN_EVENT = asyncio.Event()
    _SECRET = secrets.token_hex(32)

    _KERNEL = ReplKernel()
    await _KERNEL.start()

    server = _ReuseAddrHTTPServer((host, port_pref), _ReplHTTPHandler)
    actual_port = server.server_address[1]
    _write_info_file(actual_port)

    server_thread = threading.Thread(
        target=server.serve_forever,
        name="browser-repl-http",
        daemon=True,
    )
    server_thread.start()

    # POSIX signals — Windows console-close won't fire SIGTERM but
    # ServiceManager can still kill the PID directly.
    def _signal_shutdown(*_: Any) -> None:
        if _MAIN_LOOP is not None and _SHUTDOWN_EVENT is not None:
            _MAIN_LOOP.call_soon_threadsafe(_SHUTDOWN_EVENT.set)

    for sig in (signal.SIGINT, signal.SIGTERM):
        with contextlib.suppress(ValueError, AttributeError):
            signal.signal(sig, _signal_shutdown)

    sys.stderr.write(
        f"[browser_repl_server] listening on http://{host}:{actual_port}"
        f" (pid={os.getpid()})\n"
    )
    sys.stderr.flush()

    try:
        await _SHUTDOWN_EVENT.wait()
    finally:
        await _KERNEL.stop()
        server.shutdown()
        server.server_close()
        _remove_info_file()
        sys.stderr.write("[browser_repl_server] stopped\n")
        sys.stderr.flush()


def main() -> int:
    parser = argparse.ArgumentParser(description="Persistent Python REPL for `browser repl`.")
    parser.add_argument(
        "--host",
        default="127.0.0.1",
        help="Loopback bind address; should stay on 127.0.0.1 — the server is not hardened for remote use.",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=0,
        help="Preferred port; 0 lets the kernel pick a free one (default).",
    )
    args = parser.parse_args()

    try:
        asyncio.run(_main_async(args.host, args.port))
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
