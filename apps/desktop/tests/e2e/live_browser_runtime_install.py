"""Run the actual Electron first-use browser installer against public PyPI."""

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--version", required=True)
    args = parser.parse_args()
    bundle = args.bundle.resolve(strict=True)
    destination = args.output.resolve()
    assert not destination.exists(), "Use a new directory to preserve prior evidence"
    destination.mkdir(parents=True, mode=0o700)
    home = destination / "home"
    home.mkdir()
    environment = {
        **os.environ,
        "HOME": str(home),
        "USERPROFILE": str(home),
        "APPDATA": str(home / "AppData/Roaming"),
        "LOCALAPPDATA": str(home / "AppData/Local"),
        "XDG_CONFIG_HOME": str(home / ".config"),
        "XDG_CACHE_HOME": str(home / ".cache"),
        "SUDOWORK_BROWSER_RUNTIME_INSTALL_EVIDENCE": str(destination),
        "SUDOWORK_BROWSER_EXPECTED_WORKER_VERSION": args.version,
        "PATH": str(Path(sys.executable).parent) + os.pathsep + os.environ["PATH"],
    }
    environment.pop("ELECTRON_RUN_AS_NODE", None)
    desktop = Path(__file__).resolve().parents[2]
    electron = subprocess.check_output(
        ["node", "-p", 'require("electron")'], cwd=desktop, text=True
    ).strip()
    # The product budgets 120 s for venv, 300 s for pip and 15 s per check.
    # Keep the process at normal priority; no compiler or model runs here.
    result = subprocess.run(
        [electron, str(bundle)],
        cwd=desktop,
        env=environment,
        capture_output=True,
        timeout=480,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
    )
    (destination / "electron.log").write_bytes(result.stdout + result.stderr)
    assert result.returncode == 0, f"Inspect {destination / 'electron.log'}"
    evidence = json.loads((destination / "evidence.json").read_text(encoding="utf-8"))
    assert evidence["passed"] and evidence["publicPyPI"]
    assert evidence["version"] == args.version
    print(json.dumps(evidence), flush=True)


if __name__ == "__main__":
    main()
