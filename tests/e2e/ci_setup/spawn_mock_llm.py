#!/usr/bin/env python3
"""Build + spawn sudocode's mock-anthropic-service so sudowork's scode-driven
e2e cases have a stub Anthropic endpoint to talk to in CI.

Two phases:

  1. Ensure the mock binary exists. If --binary is passed, use it directly.
     Otherwise `git clone --depth 1` sudocode at a PINNED tag into
     --sudocode-src (default $RUNNER_TEMP/sudocode-src) and `cargo build
     --release -p mock-anthropic-service`.

  2. Spawn the binary with `--bind 127.0.0.1:0` and parse
     `MOCK_ANTHROPIC_BASE_URL=…` from its stdout. Optionally write the URL
     to $GITHUB_ENV (as MOCK_ANTHROPIC_BASE_URL) so downstream workflow
     steps can pick it up; also print the URL to stdout for local use.

Which sudocode revision? By default, the tag matching the scode engine
version sudowork pins in src/shared/runtime-versions.json — i.e. scode
"0.1.13" resolves to sudocode tag "v0.1.13". So the mock LLM and the scode
binary it serves come from the SAME sudocode commit, and a scode version
bump carries the mock along with it for free. Tracking sudocode's `main`
instead (the previous behaviour) made this job depend on a moving target:
an unrelated break on sudocode main would redden sudowork CI, and the build
was not reproducible across reruns.

By default the script blocks until SIGTERM (Ctrl-C) so a workflow step of
form `python spawn_mock_llm.py --github-env "$GITHUB_ENV" &` keeps the
service alive for the rest of the job. Pass --detach to fork + exit right
after the URL is captured (writes the child PID to --pidfile).
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path
from typing import Optional


SUDOCODE_REPO = "https://github.com/sudoprivacy/sudocode.git"

REPO_ROOT = Path(__file__).resolve().parents[3]
RUNTIME_VERSIONS = REPO_ROOT / "src" / "shared" / "runtime-versions.json"


def default_sudocode_ref() -> str:
    """Sudocode tag matching the pinned scode engine version (the SSOT).

    Exposed (not private) because the workflow keys its cargo cache on this
    value — the cache must invalidate exactly when the pinned revision moves,
    and on nothing else.
    """
    with RUNTIME_VERSIONS.open() as fh:
        version = json.load(fh)["scode"]
    return f"v{version}"


def _default_src_dir() -> Path:
    runner_temp = os.environ.get("RUNNER_TEMP")
    if runner_temp:
        return Path(runner_temp) / "sudocode-src"
    return Path.home() / ".cache" / "sudowork-e2e" / "sudocode-src"


def _clone_or_update(src: Path, ref: str) -> None:
    """Check out sudocode at exactly `ref` (a tag). Idempotent across reruns."""
    if (src / ".git").exists():
        subprocess.check_call(["git", "fetch", "--depth", "1", "origin", "tag", ref, "--no-tags"], cwd=src)
        subprocess.check_call(["git", "checkout", "--force", ref], cwd=src)
        return
    src.parent.mkdir(parents=True, exist_ok=True)
    if src.exists():
        # Non-git dir sitting at the target — wipe and reclone.
        shutil.rmtree(src)
    subprocess.check_call(
        ["git", "clone", "--depth", "1", "--branch", ref, SUDOCODE_REPO, str(src)]
    )


def _cargo_build(src: Path) -> Path:
    rust_root = src / "rust"
    subprocess.check_call(
        ["cargo", "build", "--release", "-p", "mock-anthropic-service"],
        cwd=rust_root,
    )
    exe_name = "mock-anthropic-service.exe" if sys.platform == "win32" else "mock-anthropic-service"
    built = rust_root / "target" / "release" / exe_name
    if not built.exists():
        raise SystemExit(f"cargo produced no binary at {built}")
    return built


def _spawn_and_capture(binary: Path) -> tuple[subprocess.Popen, str]:
    proc = subprocess.Popen(
        [str(binary), "--bind", "127.0.0.1:0"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    deadline = time.monotonic() + 20.0
    while time.monotonic() < deadline:
        assert proc.stdout is not None
        line = proc.stdout.readline()
        if not line:
            if proc.poll() is not None:
                raise SystemExit(f"mock-anthropic-service exited early (code={proc.returncode})")
            continue
        line = line.strip()
        print(f"[mock stdout] {line}", flush=True)
        if line.startswith("MOCK_ANTHROPIC_BASE_URL="):
            return proc, line.split("=", 1)[1].strip()
    proc.terminate()
    raise SystemExit("timed out waiting for MOCK_ANTHROPIC_BASE_URL line")


def _write_github_env(path: str, url: str) -> None:
    with open(path, "a", encoding="utf-8") as fh:
        fh.write(f"MOCK_ANTHROPIC_BASE_URL={url}\n")


def _parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build + spawn sudocode's mock-anthropic-service.")
    parser.add_argument("--binary", type=Path, help="Path to a pre-built mock-anthropic-service binary.")
    parser.add_argument("--sudocode-src", type=Path, default=_default_src_dir(), help="Where to clone sudocode (cache-friendly).")
    parser.add_argument(
        "--sudocode-ref",
        default=None,
        help="Sudocode tag to build the mock from. Default: the tag matching the scode "
        "engine version pinned in src/shared/runtime-versions.json (e.g. v0.1.13).",
    )
    parser.add_argument(
        "--print-ref",
        action="store_true",
        help="Print the resolved sudocode ref and exit. The workflow keys its cargo cache "
        "on this so the derivation stays in ONE place.",
    )
    parser.add_argument("--github-env", help="Path to $GITHUB_ENV; MOCK_ANTHROPIC_BASE_URL is appended.")
    parser.add_argument("--pidfile", type=Path, help="Write the mock service PID here (for teardown).")
    parser.add_argument("--url-file", type=Path, help="Write just the mock URL to this file.")
    parser.add_argument("--detach", action="store_true", help="Exit as soon as URL is captured; keep child running.")
    return parser.parse_args(argv)


def main(argv: Optional[list[str]] = None) -> int:
    args = _parse_args(argv)
    ref = args.sudocode_ref or default_sudocode_ref()

    if args.print_ref:
        print(ref)
        return 0

    binary = args.binary
    if binary is None:
        print(f"[spawn_mock_llm] building mock-anthropic-service from sudocode {ref}", flush=True)
        _clone_or_update(args.sudocode_src, ref)
        binary = _cargo_build(args.sudocode_src)

    proc, url = _spawn_and_capture(binary)
    print(f"MOCK_ANTHROPIC_BASE_URL={url}", flush=True)

    if args.github_env:
        _write_github_env(args.github_env, url)
    if args.url_file:
        args.url_file.write_text(url + "\n", encoding="utf-8")
    if args.pidfile:
        args.pidfile.write_text(str(proc.pid) + "\n", encoding="utf-8")

    if args.detach:
        # On POSIX we've already forked via Popen; the child stays alive after we exit.
        # On Windows we do the same — parent exit leaves the console-attached child running
        # until GH runner tears the whole job down.
        return 0

    def _forward(sig, _frame):
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
        sys.exit(0)

    signal.signal(signal.SIGTERM, _forward)
    signal.signal(signal.SIGINT, _forward)

    # Keep draining stdout so the child doesn't block on a full pipe.
    assert proc.stdout is not None
    for line in proc.stdout:
        print(f"[mock stdout] {line.rstrip()}", flush=True)
    return proc.wait()


if __name__ == "__main__":
    sys.exit(main())
