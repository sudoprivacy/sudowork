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
import subprocess
import sys
import time
import os
import urllib.request

# Add parent dir to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ops._enterprise_config import (
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
    if wait_for_cdp(args.port):
        print("Electron restarted successfully!")
        return 0
    else:
        print("ERROR: Electron did not start in time")
        return 1


if __name__ == '__main__':
    sys.exit(main())
