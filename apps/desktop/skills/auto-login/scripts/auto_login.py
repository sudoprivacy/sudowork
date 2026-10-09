"""auto-login skill helper — talks to sudowork main via the Auth Proxy.

The agent runs this as a skill subprocess, so it inherits SUDOWORK_AUTH_PROXY_BASE_URL
+ SUDOWORK_AUTH_PROXY_TOKEN (injected per agent connection). It calls the pwd_login
routes on the proxy — the SAME authenticated loopback the agent uses for /secrets.

NO password ever passes through here: `register` stores only non-secret selectors;
the user fills the actual credentials in 秘钥管理 (设置→远程连接→秘钥管理→网站自动登录);
`start` only passes a title.

Usage:
    python auto_login.py list
    python auto_login.py register --title <t> --url <u> \
        --username-selector <css> --password-selector <css> --submit-selector <css> \
        [--captcha-selector <css> --captcha-image-selector <css>] [--strategy single_step]
    python auto_login.py start --title <t>
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request


def _base_and_token() -> tuple[str, str]:
    base = os.environ.get("SUDOWORK_AUTH_PROXY_BASE_URL", "").rstrip("/")
    token = os.environ.get("SUDOWORK_AUTH_PROXY_TOKEN", "")
    if not base or not token:
        print(json.dumps({"ok": False, "error": "auth proxy env not set (run inside sudowork agent)"}))
        sys.exit(2)
    return base, token


def _call(method: str, path: str, body: dict | None = None) -> dict:
    base, token = _base_and_token()
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(f"{base}{path}", data=data, method=method)
    req.add_header("Authorization", f"Bearer {token}")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            return json.loads(resp.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        return {"ok": False, "success": False, "error": f"HTTP {e.code}"}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "success": False, "error": f"{type(e).__name__}: {e}"}


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="sudowork auto-login skill helper")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("list", help="list sites + whether each has a saved credential")

    reg = sub.add_parser("register", help="register a custom site's login recipe (non-secret)")
    reg.add_argument("--title", required=True)
    reg.add_argument("--url", required=True)
    reg.add_argument("--username-selector", required=True)
    reg.add_argument("--password-selector", required=True)
    reg.add_argument("--submit-selector", required=True)
    reg.add_argument("--captcha-selector", default=None)
    reg.add_argument("--captcha-image-selector", default=None)
    reg.add_argument("--strategy", default="single_step", choices=["single_step", "two_step"])

    st = sub.add_parser("start", help="run the auto-fill login for a registered+credentialed site")
    st.add_argument("--title", required=True)

    args = ap.parse_args(argv)

    if args.cmd == "list":
        out = _call("GET", "/pwdlogin/list")
    elif args.cmd == "register":
        out = _call(
            "POST",
            "/pwdlogin/register",
            {
                "title": args.title,
                "url": args.url,
                "usernameSelector": args.username_selector,
                "passwordSelector": args.password_selector,
                "submitSelector": args.submit_selector,
                "captchaSelector": args.captcha_selector,
                "captchaImageSelector": args.captcha_image_selector,
                "strategy": args.strategy,
            },
        )
    elif args.cmd == "start":
        out = _call("POST", "/pwdlogin/start", {"title": args.title})
    else:
        ap.error("unknown command")
        return 2

    print(json.dumps(out, ensure_ascii=False))
    return 0 if out.get("success") or out.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
