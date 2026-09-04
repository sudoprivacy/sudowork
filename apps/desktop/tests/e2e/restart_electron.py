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


def kill_electron():
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
    time.sleep(3)


def launch_electron():
    """Launch Electron app in dev mode.

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
    env['NEXUS_CDP_PORT'] = env.get('NEXUS_CDP_PORT', '9232')

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
    from ai_dev_browser.core.connection import connect_browser, get_active_tab
    from ai_dev_browser.core.navigation import page_reload, page_wait_ready
    from ai_dev_browser.core.page import js_evaluate

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

    browser = await connect_browser(host="127.0.0.1", port=port)
    tab = await get_active_tab(browser)

    result = await js_evaluate(tab, expression)
    outcome = result.get("result") if isinstance(result, dict) else str(result)

    # Reload so AuthContext.refresh() re-reads localStorage on a fresh document
    # and takes the authenticated fastpath.
    await page_reload(tab)
    await page_wait_ready(tab)

    # Prove the value survived the reload. Without this the seed can report
    # success while the app boots to the login screen anyway.
    verify = await js_evaluate(tab, "!!localStorage.getItem('eeclaw_auth_v1')")
    if not (verify.get("result") if isinstance(verify, dict) else verify):
        raise RuntimeError("eeclaw_auth_v1 missing from localStorage after reload — auth seed did not stick")

    return outcome


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
    kill_electron()

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
    proc = launch_electron()

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
