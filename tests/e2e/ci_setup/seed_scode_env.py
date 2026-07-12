#!/usr/bin/env python3
"""Seed the embedded scode engine so a fresh sudowork boot can drive a
Sudo Code conversation without any interactive install / config wizard.

SSOT for the paths lives in src/process/services/scode/scodePaths.ts. This
seeder mirrors those (SCODE_HOME = ~/.nexus/sudowork/sudocode/) so any future
path move stays a single-source edit in TS + this file.

Two effects, both idempotent:

  1. Extract v{VERSION}-scode-{platform}.{zip,tar.gz} from sudowork/resources/
     into ~/.nexus/sudowork/sudocode/, writing the .ready marker with the
     version string so ScodeInstallService.isScodeInstalled() returns true.
     (Skipped if a matching marker already exists.)

  2. Write ~/.nexus/sudowork/sudocode/sudocode.json based on the sample shipped
     with the archive OR the fallback baked in below, with the apiKey.anthropic
     entry rewritten to point at the passed-in --mock-url. --api-key defaults
     to 'test-pty-key' -- the same sentinel used by sudocode's PTY harness so
     the mock service accepts any request.

CLI:
    python -m tests.e2e.ci_setup.seed_scode_env --mock-url http://127.0.0.1:PORT

Both flags are required to avoid a foot-gun where CI silently seeds a real
anthropic base URL. If you actually want the live provider, pass
--mock-url https://api.anthropic.com --api-key $ANTHROPIC_API_KEY explicitly.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tarfile
import zipfile
from pathlib import Path
from typing import Iterable, Optional


REPO_ROOT = Path(__file__).resolve().parents[3]
RESOURCES_DIR = REPO_ROOT / "resources"
RUNTIME_VERSIONS = REPO_ROOT / "src" / "shared" / "runtime-versions.json"
SCODE_PLATFORMS_JSON = REPO_ROOT / "src" / "shared" / "scode-platforms.json"

SCODE_HOME = Path.home() / ".nexus" / "sudowork" / "sudocode"
SCODE_READY_MARKER = SCODE_HOME / ".scode-bin-ready"
SCODE_CONFIG_PATH = SCODE_HOME / "sudocode.json"


# Python normalises machine names to the Node.js `process.arch` keys used in
# the SSOT platforms map. Adjust here if a new arch is added — the SSOT itself
# stays authoritative.
_MACHINE_TO_NODE_ARCH = {
    "AMD64": "x64",
    "x86_64": "x64",
    "x64": "x64",
    "ARM64": "arm64",
    "arm64": "arm64",
    "aarch64": "arm64",
}


def _detect_node_platform_key() -> str:
    """Return the `<sys.platform>-<node-arch>` key used by scode-platforms.json."""
    if hasattr(os, "uname"):
        machine = os.uname().machine
    else:
        machine = os.environ.get("PROCESSOR_ARCHITECTURE", "AMD64")
    node_arch = _MACHINE_TO_NODE_ARCH.get(machine, machine)
    return f"{sys.platform}-{node_arch}"


def _detect_platform_triple() -> tuple[str, str, str]:
    """Look up the current platform's (os, arch, ext) triple in the SSOT map."""
    key = _detect_node_platform_key()
    with SCODE_PLATFORMS_JSON.open() as fh:
        platforms = json.load(fh)["platforms"]
    spec = platforms.get(key)
    if not spec:
        raise SystemExit(f"unsupported platform for seed_scode_env: {key} (not in scode-platforms.json)")
    return spec["os"], spec["arch"], spec["ext"]


def _scode_version() -> str:
    with RUNTIME_VERSIONS.open() as fh:
        return json.load(fh)["scode"]


def _archive_path() -> Path:
    version = _scode_version()
    os_name, arch, ext = _detect_platform_triple()
    return RESOURCES_DIR / f"v{version}-scode-{os_name}-{arch}{ext}"


def _iter_zip_names(zf: zipfile.ZipFile) -> Iterable[str]:
    return (info.filename for info in zf.infolist())


def _iter_tar_names(tf: tarfile.TarFile) -> Iterable[str]:
    return (m.name for m in tf.getmembers())


def _detect_strip(names: Iterable[str], scode_exe_name: str) -> int:
    tops: set[str] = set()
    for n in names:
        head = n.split("/", 1)[0]
        if head:
            tops.add(head)
    if len(tops) == 1:
        (prefix,) = tops
        names = list(names) if not isinstance(names, list) else names
        for n in names:
            if n.startswith(prefix + "/") and n[len(prefix) + 1:].split("/", 1)[0] == scode_exe_name:
                return 1
    return 0


def _extract_archive(archive: Path, target: Path) -> None:
    target.mkdir(parents=True, exist_ok=True)
    exe_name = "scode.exe" if sys.platform == "win32" else "scode"
    if archive.suffix == ".zip":
        with zipfile.ZipFile(archive) as zf:
            names = list(_iter_zip_names(zf))
            strip = _detect_strip(names, exe_name)
            for info in zf.infolist():
                parts = info.filename.split("/")
                if strip and len(parts) > strip:
                    parts = parts[strip:]
                elif strip:
                    continue
                if not any(parts):
                    continue
                out = target.joinpath(*parts)
                if info.is_dir():
                    out.mkdir(parents=True, exist_ok=True)
                    continue
                out.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(info) as src, open(out, "wb") as dst:
                    shutil.copyfileobj(src, dst)
    elif archive.suffixes[-2:] == [".tar", ".gz"] or archive.name.endswith(".tar.gz"):
        with tarfile.open(archive, "r:gz") as tf:
            names = list(_iter_tar_names(tf))
            strip = _detect_strip(names, exe_name)
            for member in tf.getmembers():
                parts = member.name.split("/")
                if strip and len(parts) > strip:
                    parts = parts[strip:]
                elif strip:
                    continue
                if not any(parts):
                    continue
                member.name = "/".join(parts)
                tf.extract(member, target)
    else:
        raise SystemExit(f"unsupported archive extension: {archive.name}")

    if sys.platform != "win32":
        exe = target / exe_name
        if exe.exists():
            exe.chmod(0o755)


FALLBACK_SUDOCODE_JSON: dict = {
    "auth_modes": {
        "api-key": {
            "anthropic": {
                "baseUrl": "https://api.anthropic.com",
                "apiKey": "<YOUR_ANTHROPIC_API_KEY>",
            },
        },
    },
    "models": {
        "claude-sonnet": {
            "alias": "claude-sonnet",
            "name": "Claude Sonnet 4.6",
            "input": ["text"],
            "providers": {
                "api-key": {"provider": "anthropic", "model": "claude-sonnet-4-6"},
            },
        },
    },
}


def _load_sample_sudocode_json() -> dict:
    """Prefer the sample shipped inside the extracted archive so we stay in sync
    with the scode version we just installed; fall back to the minimal literal
    above only if the archive doesn't ship one (older releases)."""
    # scode itself doesn't ship sudocode.sample.json in the tarball; the sample
    # only lives in sudocode's source tree. So the fallback is the actual source
    # of truth for CI. Left as a hook in case a future scode release ships one.
    return json.loads(json.dumps(FALLBACK_SUDOCODE_JSON))


def _write_sudocode_json(mock_url: str, api_key: str) -> None:
    cfg = _load_sample_sudocode_json()
    cfg.setdefault("auth_modes", {}).setdefault("api-key", {})["anthropic"] = {
        "baseUrl": mock_url.rstrip("/"),
        "apiKey": api_key,
    }
    SCODE_HOME.mkdir(parents=True, exist_ok=True)
    with SCODE_CONFIG_PATH.open("w", encoding="utf-8") as fh:
        json.dump(cfg, fh, indent=2)


def _write_ready_marker(version: str) -> None:
    SCODE_HOME.mkdir(parents=True, exist_ok=True)
    SCODE_READY_MARKER.write_text(version, encoding="utf-8")


def _marker_current(version: str) -> bool:
    try:
        return SCODE_READY_MARKER.read_text(encoding="utf-8").strip() == version
    except FileNotFoundError:
        return False


def seed(mock_url: str, api_key: str = "test-pty-key", force: bool = False) -> None:
    version = _scode_version()
    archive = _archive_path()

    if force or not _marker_current(version):
        if not archive.exists() or archive.stat().st_size < 100 * 1024:
            raise SystemExit(
                f"scode archive missing or empty: {archive}\n"
                "Run `bun run scode:download` first (or `--force` from cache)."
            )
        # Extract straight over the top of SCODE_HOME. We DO NOT wipe first —
        # the SSOT of "which entries are preserved across install" lives in
        # ScodeInstallService's SCODE_MIGRATED_ENTRY_NAMES + SCODE_PRESERVED_ENTRY_NAMES;
        # duplicating that policy here is a boundary leak that already bit us
        # once (an earlier seeder revision would nuke a real user's settings.json).
        # For the CI use case SCODE_HOME is fresh, so overwrite-in-place is fine.
        _extract_archive(archive, SCODE_HOME)
        _write_ready_marker(version)
        print(f"[seed_scode_env] extracted {archive.name} -> {SCODE_HOME} (marker={version})")
    else:
        print(f"[seed_scode_env] scode already installed at version {version}, skipping extract")

    _write_sudocode_json(mock_url, api_key)
    print(f"[seed_scode_env] wrote {SCODE_CONFIG_PATH} with baseUrl={mock_url}")


def _parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Seed sudowork's embedded scode engine for e2e.")
    parser.add_argument("--mock-url", required=True, help="Base URL for the anthropic api-key provider (e.g. http://127.0.0.1:PORT).")
    parser.add_argument("--api-key", default="test-pty-key", help="apiKey value written into sudocode.json (default: test-pty-key).")
    parser.add_argument("--force", action="store_true", help="Re-extract even if the ready marker matches.")
    return parser.parse_args(argv)


def main(argv: Optional[list[str]] = None) -> int:
    args = _parse_args(argv)
    seed(args.mock_url, args.api_key, args.force)
    return 0


if __name__ == "__main__":
    sys.exit(main())
