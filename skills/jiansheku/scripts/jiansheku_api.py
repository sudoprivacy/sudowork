"""
Jiansheku (建设库) Open API — Lightweight Python Client

Signing algorithm: ACS3-HMAC-SHA256
Verified against official Java SDK (dsk-acc-open-sdk-java 2.1.0)

CLI usage:
    python jiansheku_api.py --endpoint /v1/company/business/base/info --data '{"companyName":"中建三局集团有限公司"}'

    Environment variables required:
        JIANSHEKU_APP_KEY    — 32-char access key
        JIANSHEKU_APP_SECRET — 32-char secret key

Python usage:
    from jiansheku_api import Jiansheku

    api = Jiansheku("APP_KEY", "APP_SECRET")
    info = api.call("/v1/company/business/base/info", {"companyName": "中建三局集团有限公司"})
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import time
import uuid
from datetime import datetime, timezone
from typing import Any

import requests


# ── Exceptions ──────────────────────────────────────────────────────────

class JianshekuError(Exception):
    """API returned a non-200 code."""

    CODES = {
        201: "暂无数据",
        203: "appKey未授权",
        204: "IP未授权",
        205: "签名验证异常",
        206: "appKey已过期停用",
        213: "调用次数超过额度限制",
        214: "调用超过余额",
        215: "调用超过总次数",
        216: "未授权调用该接口",
        300: "暂无此公司",
        301: "入参参数与对应企业不一致",
        400: "入参参数错误",
        429: "请求太频繁",
        500: "系统异常",
    }

    def __init__(self, code: int, msg: str = ""):
        self.code = code
        desc = self.CODES.get(code, "未知错误")
        super().__init__(f"[{code}] {desc}" + (f" — {msg}" if msg else ""))


# ── Client ──────────────────────────────────────────────────────────────

class Jiansheku:
    """
    Minimal client for the Jiansheku Open API.

    Args:
        app_key:    32-char key from Jiansheku (大司空)
        app_secret: 32-char secret
        env:        "production" (default) or "testing"
        version:    SDK version header (default "2.1.0")
        timeout:    HTTP timeout in seconds (default 15)
    """

    HOSTS = {
        "production": "openapi.jiansheku.com",
        "testing": "pre-openapi.jiansheku.com",
    }

    def __init__(
        self,
        app_key: str,
        app_secret: str,
        *,
        env: str = "production",
        version: str = "2.1.0",
        timeout: int = 15,
    ):
        self.app_key = app_key
        self.app_secret = app_secret
        self.host = self.HOSTS.get(env, self.HOSTS["production"])
        self.version = version
        self.timeout = timeout

    # ── Public API ──────────────────────────────────────────────────

    def call(self, path: str, body: dict | None = None) -> Any:
        """
        Call any Jiansheku API endpoint.

        Returns the ``data`` field from the response on success.
        Raises JianshekuError on any non-200 response code.
        """
        body = body or {}
        body_json = json.dumps(body, ensure_ascii=False, separators=(",", ":"))
        headers = self._sign(path, body_json)
        url = f"https://{self.host}{path}"

        resp = requests.post(
            url,
            data=body_json.encode("utf-8"),
            headers=headers,
            timeout=self.timeout,
        )
        result = self._parse(resp.text)
        return self._unwrap(result)

    def lookup(self, keyword: str) -> dict:
        """
        Look up company IDs by name or credit code.
        Uses the form-encoded /jsk/company/getIdByKey endpoint.
        Returns dict with ``cid`` and ``eid`` keys.
        """
        path = "/jsk/company/getIdByKey"
        form_body = f"key={keyword}"
        json_body = json.dumps({"key": keyword}, ensure_ascii=False, separators=(",", ":"))
        headers = self._sign(path, json_body)
        headers["Content-Type"] = "application/x-www-form-urlencoded"
        url = f"https://{self.host}{path}"

        resp = requests.post(
            url,
            data=form_body.encode("utf-8"),
            headers=headers,
            timeout=self.timeout,
        )
        result = self._parse(resp.text)
        return self._unwrap(result)

    def raw(self, path: str, body: dict | None = None) -> dict:
        """Like ``call()`` but returns the full response dict (code, msg, data)."""
        body = body or {}
        body_json = json.dumps(body, ensure_ascii=False, separators=(",", ":"))
        headers = self._sign(path, body_json)
        url = f"https://{self.host}{path}"

        resp = requests.post(
            url,
            data=body_json.encode("utf-8"),
            headers=headers,
            timeout=self.timeout,
        )
        return self._parse(resp.text)

    # ── Signing (ACS3-HMAC-SHA256) ──────────────────────────────────

    def _sign(self, path: str, body_json: str) -> dict[str, str]:
        """Build all request headers including s-authorization."""
        now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        nonce = str(uuid.uuid4()) + str(int(time.time() * 1000))
        payload_hash = self._sha256(body_json)

        h = {
            "content-type": "application/json",
            "host": self.host,
            "x-acc-action": path,
            "x-acc-content-sha256": payload_hash,
            "x-acc-date": now,
            "x-acc-signature-nonce": nonce,
            "x-acc-version": self.version,
        }

        sorted_keys = sorted(h)
        canonical_headers = "".join(f"{k}:{h[k]}\n" for k in sorted_keys)
        signed_headers = ";".join(sorted_keys)

        canonical = (
            f"POST\n{path}\n\n"
            f"{canonical_headers}\n"
            f"{signed_headers}\n"
            f"{payload_hash}"
        )

        hashed = self._sha256(canonical)
        signature = self._hmac_sha256(self.app_secret, f"ACS3-HMAC-SHA256\n{hashed}")

        auth = (
            f"ACS3-HMAC-SHA256 Credential={self.app_key},"
            f"SignedHeaders={signed_headers},"
            f"Signature={signature}"
        )

        return {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Host": self.host,
            "x-acc-action": path,
            "x-acc-content-sha256": payload_hash,
            "x-acc-date": now,
            "x-acc-signature-nonce": nonce,
            "x-acc-version": self.version,
            "req-content": base64.b64encode(body_json.encode()).decode(),
            "s-authorization": auth,
        }

    # ── Helpers ─────────────────────────────────────────────────────

    @staticmethod
    def _sha256(text: str) -> str:
        return hashlib.sha256(text.encode("utf-8")).hexdigest()

    @staticmethod
    def _hmac_sha256(key: str, text: str) -> str:
        return hmac.new(key.encode("utf-8"), text.encode("utf-8"), hashlib.sha256).hexdigest()

    @staticmethod
    def _parse(text: str) -> dict:
        """Parse response, handling non-standard JSON like {code:205,msg:"..."}."""
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            fixed = re.sub(r'([{,])\s*(\w+)\s*:', r'\1"\2":', text)
            try:
                return json.loads(fixed)
            except json.JSONDecodeError:
                return {"code": 500, "msg": f"Unparseable: {text[:200]}"}

    @staticmethod
    def _unwrap(result: dict) -> Any:
        """Extract data or raise on error."""
        code = result.get("code", 500)
        if isinstance(code, str):
            code = int(code)
        if code == 200:
            return result.get("data", result)
        raise JianshekuError(code, result.get("msg", ""))


# ── CLI ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse
    import os
    import sys

    parser = argparse.ArgumentParser(description="Jiansheku API CLI")
    parser.add_argument("--endpoint", required=True, help="API path, e.g. /v1/company/business/base/info")
    parser.add_argument("--data", default="{}", help="JSON request body")
    parser.add_argument("--raw", action="store_true", help="Return full response (code+msg+data)")
    parser.add_argument("--lookup", metavar="KEYWORD", help="Look up company cid/eid by name")
    parser.add_argument("--env", default="production", choices=["production", "testing"])
    args = parser.parse_args()

    app_key = os.environ.get("JIANSHEKU_APP_KEY")
    app_secret = os.environ.get("JIANSHEKU_APP_SECRET")

    # Fallback: read from .env file next to this script or in skill root
    if not app_key or not app_secret:
        for env_dir in [os.path.dirname(os.path.abspath(__file__)), os.path.dirname(os.path.dirname(os.path.abspath(__file__)))]:
            env_file = os.path.join(env_dir, ".env")
            if os.path.isfile(env_file):
                with open(env_file) as f:
                    for line in f:
                        line = line.strip()
                        if line and not line.startswith("#") and "=" in line:
                            k, v = line.split("=", 1)
                            k, v = k.strip(), v.strip().strip("'\"")
                            if k == "JIANSHEKU_APP_KEY" and not app_key:
                                app_key = v
                            elif k == "JIANSHEKU_APP_SECRET" and not app_secret:
                                app_secret = v
                if app_key and app_secret:
                    break

    if not app_key or not app_secret:
        print("Error: JIANSHEKU_APP_KEY and JIANSHEKU_APP_SECRET not found.\n"
              "Set them as environment variables, or create a .env file in the skill directory:\n"
              "  skills/jiansheku/.env\n"
              "with contents:\n"
              "  JIANSHEKU_APP_KEY=your_key\n"
              "  JIANSHEKU_APP_SECRET=your_secret", file=sys.stderr)
        sys.exit(1)

    api = Jiansheku(app_key, app_secret, env=args.env)

    try:
        if args.lookup:
            result = api.lookup(args.lookup)
        elif args.raw:
            result = api.raw(args.endpoint, json.loads(args.data))
        else:
            result = api.call(args.endpoint, json.loads(args.data))
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except JianshekuError as e:
        print(f"API Error: {e}", file=sys.stderr)
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"Invalid JSON in --data: {e}", file=sys.stderr)
        sys.exit(1)
