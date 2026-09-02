"""F1 pwd-login spike - can a standalone Python process read a Vault secret?

GATING SPIKE for the pwd-login auto-fill feature (see
docs/plans/2026-06-13-pwd-login-autofill-design.md §5/§7). The hard rule is that
the plaintext password must never reach the agent/LLM, the renderer, or disk -
"Option C" satisfies this by having the *filler* (this Python process, the same
runtime ai-dev-browser runs in) read the secret directly from nexusd-cluster
rather than relaying it through sudowork-main.

This script PROVES OR DISPROVES that read from a plain Python process, using only
the stdlib (no grpcio / protobuf / httpx) so it runs in any Python env. It mirrors
how sudowork resolves the nexus endpoint (src/common/nexus/config.ts):
config file (./nexus.yaml -> ./nexus.yml -> ~/.nexus/config.yaml) then env
(NEXUS_URL / NEXUS_API_KEY), default http://localhost:12022.

It targets the REST gateway the Phase-1 code already uses
(GET /api/v2/password_vault/{title}, see pwdLoginService.ts:fetchPasswordBuffer),
with /api/v2/secrets/{ns}/{key} as a secondary probe.

SECURITY: this script NEVER prints the secret value - only whether the read
succeeded and the value's length. Run it during a live session (sudowork dev
build up, so nexusd-cluster is listening) after storing a test secret in 密钥管理.

Usage:
    python pwd_login_secret_read_spike.py --title "<vault entry title>"
    python pwd_login_secret_read_spike.py --namespace passwords --key "<key>"

Exit codes:
    0  read succeeded  -> Option C is viable, implement the direct-read filler
    3  endpoint reachable but read denied/not-found -> check auth/capability scope
    4  nexusd-cluster not reachable -> start the app / confirm the port
    2  bad usage
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

DEFAULT_BASE_URL = "http://localhost:12022"


def _extract_yaml_value(content: str, key: str) -> str | None:
    m = re.search(rf'^{key}:\s*["\']?([^"\'\n]+)["\']?', content, re.MULTILINE)
    return m.group(1).strip() if m else None


def resolve_config() -> tuple[str, str | None]:
    """Resolve (base_url, api_key) the same way src/common/nexus/config.ts does."""
    candidates = [
        Path("nexus.yaml"),
        Path("nexus.yml"),
        Path.home() / ".nexus" / "config.yaml",
    ]
    url = None
    api_key = None
    for path in candidates:
        try:
            content = path.read_text(encoding="utf-8")
        except OSError:
            continue
        url = _extract_yaml_value(content, "url")
        api_key = _extract_yaml_value(content, "api_key")
        if not url:
            # nexus init --preset writes ports.http instead of url
            port = _extract_yaml_value(content, "http")
            if port and port.isdigit():
                url = f"http://localhost:{port}"
        break
    url = url or os.environ.get("NEXUS_URL") or DEFAULT_BASE_URL
    api_key = api_key or os.environ.get("NEXUS_API_KEY")
    return url, api_key


def _get_json(url: str, api_key: str | None, timeout: float = 5.0):
    """GET url -> (status, parsed_json_or_text). Raises only on transport failure."""
    req = urllib.request.Request(url, method="GET")
    if api_key:
        req.add_header("Authorization", f"Bearer {api_key}")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8", "replace")
            try:
                return resp.status, json.loads(body)
            except json.JSONDecodeError:
                return resp.status, body
    except urllib.error.HTTPError as e:
        # Server responded (e.g. 401/404) - reachable, just not a 200.
        return e.code, None
    except (urllib.error.URLError, OSError):
        # Transport failure (connection refused, timeout) - server not reachable.
        return 0, None


def _report(ok: bool, where: str, value_len: int | None) -> None:
    if ok:
        # NEVER print the value itself - only proof of retrieval.
        print(f"[spike] [OK] secret READ ok via {where} (value length={value_len})")
    else:
        print(f"[spike] [--] no value via {where}")


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="pwd-login secret-read spike")
    ap.add_argument("--title", help="vault entry title (REST /api/v2/password_vault/{title})")
    ap.add_argument("--namespace", default="passwords", help="secret namespace for /api/v2/secrets probe")
    ap.add_argument("--key", help="secret key for /api/v2/secrets/{ns}/{key} probe")
    args = ap.parse_args(argv)

    if not args.title and not args.key:
        ap.error("provide --title or --key")
        return 2

    base, api_key = resolve_config()
    print(f"[spike] nexus endpoint: {base}  (api_key {'present' if api_key else 'empty - localhost open-access'})")

    # Reachability probe (any response, even 401/404, means the server is up).
    probe_status, _ = _get_json(f"{base}/api/v2/secrets", api_key)
    if probe_status == 0:
        print("[spike] [--] nexusd-cluster not reachable - start the sudowork dev build first")
        return 4
    print(f"[spike] nexusd-cluster reachable (probe status={probe_status})")

    found = False

    if args.title:
        status, data = _get_json(f"{base}/api/v2/password_vault/{args.title}", api_key)
        if status == 200 and isinstance(data, dict) and isinstance(data.get("password"), str):
            _report(True, f"GET /api/v2/password_vault/{args.title}", len(data["password"]))
            found = True
        else:
            _report(False, f"GET /api/v2/password_vault/{args.title} (status={status})", None)

    if not found and args.key:
        status, data = _get_json(f"{base}/api/v2/secrets/{args.namespace}/{args.key}", api_key)
        val = data.get("value") if isinstance(data, dict) else None
        if status == 200 and isinstance(val, str):
            _report(True, f"GET /api/v2/secrets/{args.namespace}/{args.key}", len(val))
            found = True
        else:
            _report(False, f"GET /api/v2/secrets/{args.namespace}/{args.key} (status={status})", None)

    if found:
        print("[spike] RESULT: Option C VIABLE - a plain Python process can read the secret directly.")
        return 0
    print("[spike] RESULT: endpoint reachable but secret read FAILED - check auth/capability or fall to DT_PIPE/stdin.")
    return 3


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
