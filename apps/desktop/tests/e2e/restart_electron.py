#!/usr/bin/env python3
"""
Restart Electron app with specified config for E2E testing.

Usage:
    python restart_electron.py --clean                    # Clean state (new user)
    python restart_electron.py --enterprise              # Enterprise mode (no auth)
    python restart_electron.py --enterprise --auth       # Enterprise mode with auth
    python restart_electron.py --consumer                # Consumer mode
"""

import argparse
import asyncio
import json
import socket
import subprocess
import sys
import time
import os
import urllib.request

# Add parent dir to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ops._enterprise_config import (
    build_enterprise_localstorage_blob,
    clear_enterprise_config,
    set_enterprise_config,
    set_consumer_mode_config,
    set_enterprise_auth_config,
)


def _port_is_free(port: int) -> bool:
    """Can a listener take this port right now?

    Binding is the same test launch-dev.js's findAvailablePort runs, so the
    two agree on what "free" means — a connect probe would call a socket in
    TIME_WAIT free while the launcher still refuses it.
    """
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(('127.0.0.1', port))
            return True
        except OSError:
            return False


def _wait_for_port_free(port: int, timeout: float = 30) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if _port_is_free(port):
            return True
        time.sleep(1)
    return False


def kill_electron(port=None):
    """Kill any running Electron processes.

    Uses `pkill -x` (exact process-name match) on POSIX rather than `-f` (full
    argv regex). `-f electron` would match ANY process whose command line
    contains "electron" — including THIS SCRIPT itself when launched as
    `python .../restart_electron.py`, causing self-SIGTERM in CI where the
    launcher's own argv contains the substring. `-x electron` binds to the
    process's own name (basename of the executable), which the real Electron
    binary satisfies while python subprocesses do not.
    """
    print("Killing Electron processes...")
    if sys.platform == 'win32':
        # Use shell=True to avoid Git Bash path-munging of /F, /IM flags
        subprocess.run('taskkill /F /IM electron.exe',
                       shell=True, capture_output=True, timeout=10)
    else:
        subprocess.run(['pkill', '-x', 'electron'], capture_output=True, timeout=10)

    # Wait for the CDP port to actually come free, rather than sleeping a flat
    # 3s and hoping. The kill returns as soon as the process is gone, but the
    # listening socket lingers a few seconds more — and launch-dev.js reacts to
    # a busy port by silently shifting the app to the next one (9232 -> 9233),
    # after which wait_for_cdp polls the requested port for its full timeout
    # and reports "Electron did not start in time" about an app that started
    # fine somewhere else.
    if port is not None and not _wait_for_port_free(port, timeout=30):
        print(f"WARNING: CDP port {port} still bound after 30s — "
              f"the launcher may shift the app to {port + 1}")


def launch_electron(port=None):
    """Launch Electron app in dev mode on `port`.

    Redirects stdout/stderr into a per-launch log file under /tmp so a
    failing CDP handshake is diagnosable — DEVNULL made prior CI failures
    show up as bare "did not start in time" with zero signal.
    """
    project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    launch_script = os.path.join(project_root, 'scripts', 'launch-dev.js')

    log_path = os.environ.get(
        'E2E_LAUNCH_LOG',
        os.path.join(os.environ.get('RUNNER_TEMP', '/tmp'), 'e2e-launch.log'),
    )
    log_fh = open(log_path, 'wb')
    print(f"Launching Electron from {project_root} (log: {log_path})...")
    env = os.environ.copy()
    # --port is the port the app is launched on, not merely the one we poll.
    # It used to reach only wait_for_cdp: `--port 9233` launched the app on
    # 9232 and then waited on 9233 until the timeout.
    env['NEXUS_CDP_PORT'] = str(port) if port else env.get('NEXUS_CDP_PORT', '9232')

    if sys.platform == 'win32':
        proc = subprocess.Popen(
            ['node', launch_script, 'start'],
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS,
            env=env,
            cwd=project_root,
            stdout=log_fh,
            stderr=subprocess.STDOUT,
        )
    else:
        proc = subprocess.Popen(
            ['node', launch_script, 'start'],
            start_new_session=True,
            env=env,
            cwd=project_root,
            stdout=log_fh,
            stderr=subprocess.STDOUT,
        )
    return proc


async def _seed_renderer_localstorage_async(port: int) -> str:
    """Attach to the renderer via CDP and seed enterprise localStorage.

    ConfigStorage (main-process persistence, seeded synchronously by
    `set_enterprise_auth_config`) is read for token refresh in the main
    process, but `AuthContext` in the renderer gates the login screen on
    `localStorage['eeclaw_auth_v1']` (see packages/renderer/src/context/AuthContext.tsx:199
    + :758). A fresh CI Chrome profile has no localStorage history, so the
    app lands on the login page even with valid ConfigStorage. Seeding the
    same blob via CDP + reloading takes the app straight to the main UI.

    Auth values come from _enterprise_config's MOCK_* constants (SSOT); this
    function is a thin renderer-side mirror of that state.

    Writing the value and reloading are kept as two separate steps on purpose.
    The first version of this smuggled `setTimeout(() => location.reload(), 100)`
    into the evaluated expression, which raced the tool's own post-eval page-state
    snapshot: the reload tore down the execution context mid-snapshot and
    `Runtime.evaluate` hung until the 30s CDP timeout. Intermittent, and it
    presented as an auth failure 120s downstream. An eval evaluates; navigation
    is `page_reload`'s job, and it knows to wait for the new document.
    """
    from ai_dev_browser.core.navigation import page_reload, page_wait_ready
    from ai_dev_browser.core.page import js_evaluate

    from ops._ui_ready import wait_for_shell_state
    from ops.connect import connect

    blob = build_enterprise_localstorage_blob()
    # json.dumps twice: the inner call builds the blob the app will parse, the
    # outer one embeds it as a JS string literal — so no hand-rolled escaping.
    payload_js = json.dumps(json.dumps(blob))
    expression = f"""
        (() => {{
            const blob = {payload_js};
            const parsed = JSON.parse(blob);
            const existing = localStorage.getItem('eeclaw_auth_v1');
            if (existing) {{
                try {{
                    const cur = JSON.parse(existing);
                    if (cur.user && cur.access_token === parsed.access_token) return 'already-seeded';
                }} catch (e) {{
                    // fall through — overwrite garbage
                }}
            }}
            localStorage.setItem('eeclaw_auth_v1', blob);
            return 'seeded';
        }})()
    """

    # Pick the tab the way every op does (ops.connect), not via get_active_tab:
    # the CDP target list also carries webview preview panes and the avatar
    # window, and seeding localStorage into one of those writes the blob into a
    # document AuthContext never reads. Connecting is retried because right
    # after launch the renderer target does not exist yet.
    deadline = time.time() + 90
    while True:
        try:
            _browser, tab = await connect(port)
            break
        except ConnectionError:
            if time.time() >= deadline:
                raise RuntimeError("no sudowork renderer target appeared on CDP — nothing to seed auth into")
            await asyncio.sleep(2)

    # CDP answers before the renderer has mounted, and seeding into a document
    # that is still booting loses the race: the main process emits authRequired
    # somewhere in its own startup, AuthContext clears eeclaw_auth_v1, and the
    # app parks on /login with the seed reporting success. Wait for a mounted
    # shell first, and afterwards prove the app actually left the login screen
    # rather than that the key merely survived the reload.
    if not await wait_for_shell_state(tab, {"login", "in-app"}, timeout=90):
        raise RuntimeError("renderer never mounted — nothing to seed auth into")

    for attempt in range(3):
        result = await js_evaluate(tab, expression)
        outcome = result.get("result") if isinstance(result, dict) else str(result)

        # Reload so AuthContext.refresh() re-reads localStorage on a fresh
        # document and takes the authenticated fastpath.
        await page_reload(tab)
        await page_wait_ready(tab)

        if await wait_for_shell_state(tab, {"in-app"}, timeout=45):
            return outcome

    raise RuntimeError(
        "app stayed on the login screen after 3 auth seeds — the mock session is "
        "being rejected (check the enterprise serverUrl and MOCK_* constants)"
    )


def seed_renderer_localstorage(port: int) -> bool:
    """Sync wrapper around the CDP seed. Returns False if the seed did not take.

    A failure here is FATAL, not a warning. This used to print "(non-fatal)"
    and continue: the app would then boot to the login screen and the case
    died 120s later inside `wait_for_app_ready`, pointing at the send-box
    rather than at the missing auth that actually caused it. A prerequisite
    that did not hold has to fail where it broke.
    """
    print(f"Seeding renderer localStorage on port {port}...")
    try:
        outcome = asyncio.run(_seed_renderer_localstorage_async(port))
    except Exception as e:
        print(f"ERROR: localStorage auth seed failed: {e}")
        return False

    print(f"  localStorage seed: {outcome}")
    return True


def wait_for_cdp(port=9232, timeout=180):
    """Wait for CDP port to be ready."""
    print(f"Waiting for CDP on port {port}...")
    for i in range(timeout // 2):
        time.sleep(2)
        try:
            req = urllib.request.urlopen(f'http://localhost:{port}/json/version', timeout=2)
            if req.status == 200:
                print(f"CDP ready on port {port}")
                return True
        except Exception:
            if i % 5 == 0:
                print(f"  ... still waiting ({i*2}s)")

    # Before declaring the app dead, look where launch-dev.js would have put it:
    # it shifts to the next free port when the requested one is busy, so the app
    # can be perfectly healthy a port or two over. Naming that port is the
    # difference between a one-line fix and debugging a launch that never failed.
    for probe in range(port + 1, port + 21):
        try:
            if urllib.request.urlopen(f'http://localhost:{probe}/json/version', timeout=1).status == 200:
                print(f"ERROR: nothing on CDP {port}, but an app IS listening on {probe} — "
                      f"the launcher shifted ports because {port} was still bound; "
                      f"re-run once {port} is free, or drive the suite with --port {probe}")
                return False
        except Exception:
            continue
    return False


def main():
    parser = argparse.ArgumentParser(description='Restart Electron for E2E testing')
    parser.add_argument('--clean', action='store_true', help='Clean state (new user)')
    parser.add_argument('--enterprise', action='store_true', help='Enterprise mode')
    parser.add_argument('--consumer', action='store_true', help='Consumer mode')
    parser.add_argument('--auth', action='store_true', help='Set enterprise auth')
    parser.add_argument('--server-url', default='http://localhost:18923', help='Enterprise server URL')
    parser.add_argument('--tenant-name', default='E2E测试科技有限公司', help='Tenant name')
    parser.add_argument('--port', type=int, default=9232, help='CDP port')
    args = parser.parse_args()

    # Kill existing Electron
    kill_electron(args.port)

    # Modify config
    if args.clean or (not args.enterprise and not args.consumer):
        print("Setting clean state...")
        clear_enterprise_config()
    elif args.consumer:
        print("Setting consumer mode...")
        clear_enterprise_config()
        set_consumer_mode_config()
    elif args.enterprise:
        print(f"Setting enterprise mode (server: {args.server_url})...")
        clear_enterprise_config()
        set_enterprise_config(args.server_url, args.tenant_name)
        if args.auth:
            print("Setting enterprise auth...")
            set_enterprise_auth_config()

    # Launch
    proc = launch_electron(args.port)

    # Wait for CDP
    if not wait_for_cdp(args.port):
        print("ERROR: Electron did not start in time")
        return 1

    # Post-CDP seeding: enterprise auth requires renderer localStorage AND
    # the ConfigStorage entry we wrote above; do this here (once, in one
    # place) rather than per-case so every future e2e case inherits it.
    if args.enterprise and args.auth:
        if not seed_renderer_localstorage(args.port):
            print("ERROR: enterprise auth was requested but could not be seeded — "
                  "the app would boot to the login screen and every case would "
                  "fail downstream for the wrong reason")
            return 1

    print("Electron restarted successfully!")
    return 0


if __name__ == '__main__':
    sys.exit(main())
