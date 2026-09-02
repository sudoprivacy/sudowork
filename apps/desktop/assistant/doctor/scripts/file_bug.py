"""File a bug report through a layered, degradable set of channels.

This is a standalone CLI script. It does NOT use the browser — it talks to
Feishu / GitHub directly and falls back to a local file when both are
unreachable. Designed for both internal developers and external end users
whose environment may not have `gh` installed or cannot reach GitHub.

Channel order (each step runs only if the previous one failed / is disabled):

    1. Feishu group-bot webhook   — primary channel (works for end users)
    2. GitHub issue (`gh` CLI)    — secondary channel (internal / developers)
    3. Local markdown file        — last-resort fallback (never lost)

Usage:
    python assistant/doctor/scripts/file_bug.py --title "Bug title" --body "Description"
    python assistant/doctor/scripts/file_bug.py --title "T" --body "B" --dry-run
    python assistant/doctor/scripts/file_bug.py --title "T" --body "B" \\
        --channels feishu,github --screenshot shot.png

Configuration (highest priority first):
    Feishu webhook : --feishu-webhook  >  env SUDOWORK_FEISHU_BUG_WEBHOOK  >  default
    Feishu secret  : --feishu-secret   >  env SUDOWORK_FEISHU_BUG_SECRET   >  embedded
    GitHub repo    : --repo            >  env SUDOWORK_BUG_GITHUB_REPO     >  default

The Feishu group bot uses signature verification, so a signing secret is
required. The secret ships embedded in this file in obfuscated (not
plaintext) form and is decoded at runtime; a deployment can still override
it via --feishu-secret or the SUDOWORK_FEISHU_BUG_SECRET environment
variable, both of which take precedence over the embedded value.
"""

import argparse
import base64
import datetime
import hashlib
import hmac
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request


# ── Defaults (overridable via CLI flags or environment variables) ──────────

DEFAULT_FEISHU_WEBHOOK = (
    "https://open.feishu.cn/open-apis/bot/v2/hook/"
    "73c56d72-0b01-4625-8e7d-c8ea3ade152e"
)
DEFAULT_GITHUB_REPO = "sudoprivacy/sudowork"
HTTP_TIMEOUT = 20  # seconds

# Obfuscated Feishu signing secret. The group bot has signature verification
# ("签名校验") enabled, so a secret is required. To avoid shipping the secret
# in plaintext (which a casual code scan / grep would expose), it is stored
# here as a passphrase-derived stream cipher and decoded at runtime.
#
# NOTE: this is obfuscation, not cryptographic protection — the passphrase
# travels with the code. It defends against plaintext exposure, not against a
# deliberate reverse-engineer. A deployment that wants real protection should
# override it via the SUDOWORK_FEISHU_BUG_SECRET environment variable, which
# always takes precedence over this embedded value.
_FEISHU_SECRET_CIPHER = "Kg4l5jljgvDuEoTeL8nmd7J+0xAojA=="
_FEISHU_SECRET_PASSPHRASE = "sudosudo"


def _stream_keystream(passphrase: str, length: int) -> bytes:
    """Derive `length` bytes of key stream from a passphrase via SHA-256.

    Standard-library only — no third-party crypto dependency, so the script
    keeps running in minimal external user environments.
    """
    out = b""
    counter = 0
    while len(out) < length:
        out += hashlib.sha256(f"{passphrase}:{counter}".encode("utf-8")).digest()
        counter += 1
    return out[:length]


def _decode_embedded_secret() -> str:
    """Decode the obfuscated embedded Feishu signing secret.

    Returns the plaintext secret, or "" if decoding fails (in which case the
    Feishu channel simply runs unsigned and Feishu will reject it — the
    report then degrades to the next channel).
    """
    try:
        cipher = base64.b64decode(_FEISHU_SECRET_CIPHER)
        keystream = _stream_keystream(_FEISHU_SECRET_PASSPHRASE, len(cipher))
        return bytes(a ^ b for a, b in zip(cipher, keystream)).decode("utf-8")
    except Exception:  # noqa: BLE001 — never let secret decode break filing
        return ""


# ── Feishu webhook channel ─────────────────────────────────────────────────

def _feishu_sign(timestamp: str, secret: str) -> str:
    """Compute the Feishu custom-bot request signature.

    Algorithm (per Feishu docs): the string `"{timestamp}\\n{secret}"` is used
    as the HMAC-SHA256 *key* over an empty message, then base64-encoded.
    """
    string_to_sign = f"{timestamp}\n{secret}"
    digest = hmac.new(
        string_to_sign.encode("utf-8"), b"", digestmod=hashlib.sha256
    ).digest()
    return base64.b64encode(digest).decode("utf-8")


def _build_feishu_card(title: str, body: str, screenshot: str = None) -> dict:
    """Build a Feishu interactive card payload for a bug report.

    The body is shown verbatim — the Doctor is expected to produce a
    structured report (repro steps / expected / actual). Keeping it as one
    lark_md block preserves whatever structure the Doctor wrote.
    """
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    elements = [
        {
            "tag": "div",
            "text": {"tag": "lark_md", "content": body or "*(no description)*"},
        },
    ]
    if screenshot:
        elements.append({
            "tag": "div",
            "text": {"tag": "lark_md", "content": f"**截图**: `{screenshot}`"},
        })
    elements.append({"tag": "hr"})
    elements.append({
        "tag": "note",
        "elements": [
            {"tag": "plain_text", "content": f"上报时间 {now}  ·  来源 Sudowork 诊断医生"},
        ],
    })

    return {
        "msg_type": "interactive",
        "card": {
            "config": {"wide_screen_mode": True},
            "header": {
                "title": {"tag": "plain_text", "content": "🩺 诊断医生 · 新 Bug"},
                "subtitle": {"tag": "plain_text", "content": title},
                "template": "red",
            },
            "elements": elements,
        },
    }


def _notify_feishu_webhook(webhook_url: str, title: str, body: str,
                           secret: str = "", screenshot: str = None) -> dict:
    """POST a structured bug card to a Feishu group-bot webhook.

    Returns {"ok": True} on success, {"ok": False, "error": str} otherwise.
    Uses only the standard library so external environments need no extra deps.
    """
    if not webhook_url:
        return {"ok": False, "error": "no feishu webhook configured"}

    payload = _build_feishu_card(title, body, screenshot)

    # Signed-request mode: only when the bot has signature verification on.
    if secret:
        timestamp = str(int(datetime.datetime.now().timestamp()))
        payload["timestamp"] = timestamp
        payload["sign"] = _feishu_sign(timestamp, secret)

    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        webhook_url, data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
    except urllib.error.URLError as e:
        return {"ok": False, "error": f"feishu request failed: {e}"}
    except Exception as e:  # noqa: BLE001 — network layer can throw broadly
        return {"ok": False, "error": f"feishu request error: {e}"}

    # Feishu returns {"code":0,...} on success, non-zero code on rejection
    # (e.g. bad signature, keyword filter miss).
    try:
        result = json.loads(raw)
    except json.JSONDecodeError:
        return {"ok": False, "error": f"feishu bad response: {raw[:200]}"}

    code = result.get("code", result.get("StatusCode", -1))
    if code == 0:
        return {"ok": True}
    return {"ok": False, "error": f"feishu rejected (code={code}): {result.get('msg', raw[:200])}"}


# ── GitHub issue channel ───────────────────────────────────────────────────

def _file_github_issue(repo: str, title: str, body: str,
                        label: str = "bug", screenshot: str = None) -> dict:
    """Create a GitHub issue via the `gh` CLI.

    Returns {"ok": True, "issue_url": str} or {"ok": False, "error": str}.
    Requires `gh` to be installed and authenticated, and network access to
    GitHub — both common internally but unlikely on an end-user machine.
    """
    full_body = body
    if screenshot:
        full_body += f"\n\n**Screenshot**: `{screenshot}`"

    gh_cmd = [
        "gh", "issue", "create",
        "--repo", repo,
        "--title", title,
        "--body", full_body,
        "--label", label,
    ]
    try:
        result = subprocess.run(gh_cmd, capture_output=True, text=True, timeout=30)
    except FileNotFoundError:
        return {"ok": False, "error": "gh CLI not found"}
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "gh issue create timed out"}

    if result.returncode != 0:
        return {"ok": False, "error": f"gh issue create failed: {result.stderr.strip()}"}
    return {"ok": True, "issue_url": result.stdout.strip()}


# ── Local fallback channel ─────────────────────────────────────────────────

def _default_report_dir() -> str:
    """Resolve a writable directory for last-resort local bug reports."""
    env_dir = os.environ.get("SUDOWORK_BUG_REPORT_DIR")
    if env_dir:
        return env_dir
    return os.path.join(os.path.expanduser("~"), ".sudowork", "bug-reports")


def _save_local_report(report_dir: str, title: str, body: str,
                       screenshot: str = None) -> dict:
    """Write the bug report to a timestamped markdown file.

    Returns {"ok": True, "path": str} or {"ok": False, "error": str}.
    """
    try:
        os.makedirs(report_dir, exist_ok=True)
        stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
        safe = "".join(c if c.isalnum() or c in "-_ " else "_" for c in title)[:40].strip()
        path = os.path.join(report_dir, f"bug-{stamp}-{safe or 'report'}.md")
        lines = [
            f"# {title}",
            "",
            f"> 上报时间: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
            "> 来源: Sudowork 诊断医生",
            "",
            body or "*(no description)*",
        ]
        if screenshot:
            lines += ["", f"**截图**: `{screenshot}`"]
        with open(path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines))
        return {"ok": True, "path": path}
    except OSError as e:
        return {"ok": False, "error": f"local report write failed: {e}"}


# ── Orchestration ──────────────────────────────────────────────────────────

def file_bug(title: str, body: str, screenshot: str = None,
             channels: list = None,
             feishu_webhook: str = None, feishu_secret: str = None,
             repo: str = None, label: str = "bug",
             local_fallback_dir: str = None,
             dry_run: bool = False) -> dict:
    """File a bug through layered, degradable channels.

    Channels are tried in the order given by `channels` (default
    ["feishu", "github"]). The first channel that succeeds wins. If every
    requested channel fails, the report is always written to a local file
    so it is never lost.

    Returns a dict describing which channel handled the report:
        {"channel": "feishu"|"github"|"local", "ok": bool, ...attempts}
    """
    channels = channels or ["feishu", "github"]
    feishu_webhook = (feishu_webhook
                      or os.environ.get("SUDOWORK_FEISHU_BUG_WEBHOOK")
                      or DEFAULT_FEISHU_WEBHOOK)
    feishu_secret = (feishu_secret
                     or os.environ.get("SUDOWORK_FEISHU_BUG_SECRET")
                     or _decode_embedded_secret())
    repo = repo or os.environ.get("SUDOWORK_BUG_GITHUB_REPO") or DEFAULT_GITHUB_REPO
    report_dir = local_fallback_dir or _default_report_dir()

    if dry_run:
        return {
            "dry_run": True,
            "channels": channels,
            "feishu_webhook": feishu_webhook,
            "feishu_signed": bool(feishu_secret),
            "github_repo": repo,
            "local_fallback_dir": report_dir,
        }

    attempts = []

    for channel in channels:
        if channel == "feishu":
            r = _notify_feishu_webhook(feishu_webhook, title, body,
                                       secret=feishu_secret, screenshot=screenshot)
            attempts.append({"channel": "feishu", **r})
            if r.get("ok"):
                return {"channel": "feishu", "ok": True, "attempts": attempts}
        elif channel == "github":
            r = _file_github_issue(repo, title, body, label=label,
                                   screenshot=screenshot)
            attempts.append({"channel": "github", **r})
            if r.get("ok"):
                return {"channel": "github", "ok": True,
                        "issue_url": r.get("issue_url"), "attempts": attempts}
        else:
            attempts.append({"channel": channel, "ok": False,
                             "error": f"unknown channel '{channel}'"})

    # Every requested channel failed — never drop the report.
    local = _save_local_report(report_dir, title, body, screenshot=screenshot)
    attempts.append({"channel": "local", **local})
    return {
        "channel": "local",
        "ok": local.get("ok", False),
        "local_path": local.get("path"),
        "attempts": attempts,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="File a bug through Feishu / GitHub / local fallback channels"
    )
    parser.add_argument("--title", required=True, help="Bug title")
    parser.add_argument("--body", required=True, help="Bug body (markdown)")
    parser.add_argument("--screenshot", help="Screenshot path to reference")
    parser.add_argument("--channels", default="feishu,github",
                        help="Comma-separated channel order (default: feishu,github)")
    parser.add_argument("--feishu-webhook", help="Feishu group-bot webhook URL")
    parser.add_argument("--feishu-secret", help="Feishu signing secret (when 签名校验 is on)")
    parser.add_argument("--repo", help="GitHub repo (owner/name)")
    parser.add_argument("--label", default="bug", help="GitHub issue label")
    parser.add_argument("--local-fallback-dir", help="Directory for local fallback reports")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print resolved config without sending")

    args = parser.parse_args()
    result = file_bug(
        title=args.title,
        body=args.body,
        screenshot=args.screenshot,
        channels=[c.strip() for c in args.channels.split(",") if c.strip()],
        feishu_webhook=args.feishu_webhook,
        feishu_secret=args.feishu_secret,
        repo=args.repo,
        label=args.label,
        local_fallback_dir=args.local_fallback_dir,
        dry_run=args.dry_run,
    )
    print(json.dumps(result, indent=2, ensure_ascii=False))
    sys.exit(0 if result.get("ok") or result.get("dry_run") else 1)
