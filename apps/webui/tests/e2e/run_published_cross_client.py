"""Launch a verified Windows release in its own home and run cloud acceptance."""

import argparse
import ctypes
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import urllib.request
import zipfile

from live_browser_ui import direct_browser_arguments


class OwnedProcessTree:
    """A Windows job owns the fixture's complete process tree, including daemons."""

    def __init__(self, arguments, environment, log):
        from ctypes import wintypes

        class Limits(ctypes.Structure):
            _fields_ = [("process_time", ctypes.c_int64), ("job_time", ctypes.c_int64),
                        ("flags", wintypes.DWORD), ("minimum_working_set", ctypes.c_size_t),
                        ("maximum_working_set", ctypes.c_size_t), ("process_limit", wintypes.DWORD),
                        ("affinity", ctypes.c_size_t), ("priority", wintypes.DWORD),
                        ("scheduling_class", wintypes.DWORD)]

        class ExtendedLimits(ctypes.Structure):
            _fields_ = [("basic", Limits), ("io_counters", ctypes.c_uint64 * 6),
                        ("process_memory", ctypes.c_size_t), ("job_memory", ctypes.c_size_t),
                        ("peak_process_memory", ctypes.c_size_t), ("peak_job_memory", ctypes.c_size_t)]

        self.api = ctypes.WinDLL("kernel32", use_last_error=True)
        self.api.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
        self.api.CreateJobObjectW.restype = wintypes.HANDLE
        self.api.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int,
                                                    ctypes.c_void_p, wintypes.DWORD]
        self.api.SetInformationJobObject.restype = wintypes.BOOL
        self.api.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
        self.api.AssignProcessToJobObject.restype = wintypes.BOOL
        self.api.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        self.api.OpenProcess.restype = wintypes.HANDLE
        self.api.CloseHandle.argtypes = [wintypes.HANDLE]
        self.api.CloseHandle.restype = wintypes.BOOL
        self.job = self.api.CreateJobObjectW(None, None)
        self.process = None
        if not self.job:
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            limits = ExtendedLimits()
            limits.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE.
            if not self.api.SetInformationJobObject(self.job, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
                raise ctypes.WinError(ctypes.get_last_error())
            # The helper waits on stdin until it belongs to the job. Every
            # descendant therefore inherits ownership before it can start.
            worker = ("import json,subprocess,sys; spec=json.load(sys.stdin); "
                      "startup=subprocess.STARTUPINFO(); startup.dwFlags|=subprocess.STARTF_USESHOWWINDOW; "
                      "startup.wShowWindow=0; "
                      "p=subprocess.Popen(spec['args'],stdout=sys.stdout,stderr=sys.stderr,startupinfo=startup); "
                      "raise SystemExit(p.wait())")
            self.process = subprocess.Popen([sys.executable, "-c", worker], stdin=subprocess.PIPE,
                                            stdout=log, stderr=log, env=environment,
                                            creationflags=subprocess.CREATE_NO_WINDOW)
            handle = self.api.OpenProcess(0x0101, False, self.process.pid)
            if not handle:
                raise ctypes.WinError(ctypes.get_last_error())
            try:
                if not self.api.AssignProcessToJobObject(self.job, handle):
                    raise ctypes.WinError(ctypes.get_last_error())
            finally:
                self.api.CloseHandle(handle)
            self.process.stdin.write(json.dumps({"args": arguments}).encode())
            self.process.stdin.close()
        except BaseException:
            # Before assignment the helper can only be waiting for its input.
            # Terminate this exact Popen if job assignment itself failed.
            if self.process and self.process.poll() is None:
                self.process.terminate()
                self.process.wait(timeout=30)
            self.api.CloseHandle(self.job)
            self.job = None
            raise

    def close(self):
        from ctypes import wintypes

        class Accounting(ctypes.Structure):
            _fields_ = [("times", ctypes.c_int64 * 4), ("page_faults", wintypes.DWORD),
                        ("total_processes", wintypes.DWORD), ("active_processes", wintypes.DWORD),
                        ("terminated_processes", wintypes.DWORD)]

        self.api.TerminateJobObject.argtypes = [wintypes.HANDLE, wintypes.UINT]
        self.api.TerminateJobObject.restype = wintypes.BOOL
        self.api.QueryInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int,
                                                      ctypes.c_void_p, wintypes.DWORD, ctypes.c_void_p]
        self.api.QueryInformationJobObject.restype = wintypes.BOOL
        try:
            if self.job:
                if not self.api.TerminateJobObject(self.job, 1):
                    raise ctypes.WinError(ctypes.get_last_error())
                deadline = time.monotonic() + 30
                accounting = Accounting()
                while True:
                    if not self.api.QueryInformationJobObject(self.job, 1, ctypes.byref(accounting),
                                                              ctypes.sizeof(accounting), None):
                        raise ctypes.WinError(ctypes.get_last_error())
                    if accounting.active_processes == 0:
                        break
                    assert time.monotonic() < deadline, "Owned fixture processes remain alive"
                    time.sleep(0.05)
                if self.process:
                    self.process.wait(timeout=30)
                return {"processTreeRetired": True, "totalProcesses": accounting.total_processes,
                        "activeProcesses": accounting.active_processes}
        finally:
            if self.job:
                if not self.api.CloseHandle(self.job):
                    raise ctypes.WinError(ctypes.get_last_error())
                self.job = None


def main(args):
    assert sys.platform == "win32", "This release launcher qualifies the Windows Desktop"
    assert re.fullmatch(r"v\d+\.\d+\.\d+", args.release)
    config = json.loads(args.config.read_text(encoding="utf8"))
    network_arguments = direct_browser_arguments(config["origin"], config.get("directAddress"))
    args.output.mkdir(parents=True, exist_ok=False)
    version = args.release.removeprefix("v")
    name = f"Sudowork-{version}-win-x64.zip"
    release = json.loads(subprocess.check_output(
        ["gh", "api", "repos/sudoprivacy/sudowork/releases/tags/" + args.release], text=True, encoding="utf8",
    ))
    assert not release["draft"] and not release["prerelease"]
    asset = next(asset for asset in release["assets"] if asset["name"] == name)
    assert re.fullmatch(r"sha256:[0-9a-f]{64}", asset["digest"])
    (args.output / "release-asset.json").write_text(json.dumps(asset, indent=2))
    package_path = args.output / name
    if args.archive:
        shutil.copyfile(args.archive, package_path)
    else:
        subprocess.run(["gh", "release", "download", args.release, "--repo", "sudoprivacy/sudowork",
                        "--pattern", name, "--dir", str(args.output)], check=True, timeout=300)
    with package_path.open("rb") as stream:
        assert "sha256:" + hashlib.file_digest(stream, "sha256").hexdigest() == asset["digest"]
    assert package_path.stat().st_size == asset["size"]
    app = args.output / "app"
    with zipfile.ZipFile(package_path) as package:
        assert sum(entry.file_size for entry in package.infolist()) + 2 * 1024**3 < shutil.disk_usage(args.output).free
        for entry in package.infolist():
            assert (app / entry.filename).resolve().is_relative_to(app.resolve())
            assert (entry.external_attr >> 16) & 0o170000 != 0o120000, "Release contains a symbolic link"
        package.extractall(app)
    executable, = app.rglob("Sudowork.exe")
    resources = executable.parent / "resources"
    product = resources / "product.app.asar"
    (resources / "app.asar").rename(product)
    with product.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    unpacked = resources / "app.asar.unpacked"
    if unpacked.exists():
        alias = resources / "product.app.asar.unpacked"
        # This fresh extracted fixture is the only filesystem target.
        def literal(value):
            return "'" + str(value).replace("'", "''") + "'"
        subprocess.run(["powershell", "-NoProfile", "-Command",
                        "New-Item -ItemType Junction -Path " + literal(alias)
                        + " -Target " + literal(unpacked) + " | Out-Null"], check=True)
    profile = args.output / "profile"
    profile.mkdir()
    bootstrap = resources / "app"
    bootstrap.mkdir()
    (bootstrap / "package.json").write_text(json.dumps({"name": "Sudowork", "version": version,
                                                       "main": "bootstrap.cjs"}))
    code = r'''
const fs = require('node:fs'), path = require('node:path'), {app} = require('electron');
const root = PROFILE_ROOT;
const archive = path.join(process.resourcesPath, 'product.app.asar');
process.env.USERPROFILE = root;
process.env.APPDATA = path.join(root, 'appdata');
process.env.LOCALAPPDATA = path.join(root, 'localappdata');
process.env.SUDO_CODE_CONFIG_HOME = path.join(root, '.nexus/sudocode');
process.env.SCODE_GLOBAL_CONFIG_DIR = process.env.SUDO_CODE_CONFIG_HOME;
process.env.SCODE_SERVICE_ROOT = path.join(root, 'scode-service');
const directories = {home:'', appData:'appdata', userData:'electron', sessionData:'session-data',
  logs:'logs', temp:'temp', crashDumps:'crash-dumps', downloads:'downloads'};
for (const [name, part] of Object.entries(directories)) {
  fs.mkdirSync(path.join(root, part), {recursive:true});
  app.setPath(name, path.join(root, part));
}
app.setAppPath(archive);
const manifest = JSON.parse(fs.readFileSync(path.join(archive, 'package.json'), 'utf8'));
if (manifest.version !== EXPECTED_VERSION) throw Error('Unexpected published product version');
app.getVersion = () => manifest.version;
fs.writeFileSync(path.join(root, 'fixture-proof.json'), JSON.stringify({version:manifest.version,
  archive, home:app.getPath('home'), userData:app.getPath('userData')}));
require(path.join(archive, manifest.main));
'''.replace("PROFILE_ROOT", json.dumps(str(profile.resolve()))).replace("EXPECTED_VERSION", json.dumps(version))
    (bootstrap / "bootstrap.cjs").write_text(code, encoding="utf8")
    proof = {"version": version, "productArchive": str(product.resolve()),
             "productArchiveSha256": digest, "githubSha256Verified": True,
             "publicArchiveSha256": asset["digest"], "productArchiveUnmodified": True,
             "isolationBootstrapAdded": True, "profile": str(profile.resolve()),
             "testProviderInjected": False, "e2eModeEnabled": False, "port": args.port}
    proof_path = args.output / "desktop-proof.json"
    proof_path.write_text(json.dumps(proof, indent=2))
    env = {**os.environ, "NEXUS_DISABLE_AUTO_UPDATE": "1"}
    env.pop("NEXUS_E2E_TEST", None)
    process = None
    with (args.output / "desktop.log").open("w", encoding="utf8") as log:
        try:
            process = OwnedProcessTree([str(executable), f"--remote-debugging-port={args.port}", f"--lang={args.locale}",
                                        *network_arguments], env, log)
            deadline = time.monotonic() + 180
            while time.monotonic() < deadline:
                assert process.process.poll() is None, "The dedicated Desktop exited during startup"
                try:
                    with urllib.request.urlopen(f"http://127.0.0.1:{args.port}/json/list", timeout=2) as response:
                        pages = json.load(response)
                    if any("index.html" in page.get("url", "") for page in pages):
                        break
                except OSError:
                    pass
                time.sleep(0.2)
            else:
                raise AssertionError("The real Desktop renderer never started")
            subprocess.run([sys.executable, str(Path(__file__).with_name("live_cross_client_session.py")),
                            "--config", str(args.config), "--desktop-proof", str(proof_path),
                            "--output", str(args.output / "journey"), "--locale", args.locale], check=True)
        finally:
            if process:
                retirement = {"processTreeRetired": False}
                try:
                    retirement.update(process.close())
                finally:
                    (args.output / "desktop-retirement.json").write_text(json.dumps(retirement, indent=2))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf8")
    sys.stderr.reconfigure(encoding="utf8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release", required=True)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--archive", type=Path, help="Reuse a local archive; verify it against the public release digest")
    parser.add_argument("--port", type=int, default=9486)
    parser.add_argument("--locale", default="zh-CN")
    main(parser.parse_args())
