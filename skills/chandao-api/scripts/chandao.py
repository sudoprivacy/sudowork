#!/usr/bin/env python3
"""禅道 REST API v1 Python SDK

Token 管理（获取、自动续期）已全部封装，调用者只需关注业务逻辑。

用法:
    from chandao import Chandao

    api = Chandao("https://your-site.chandao.net", "username", "password")
    products = api.get("/products")
    bug = api.post("/products/1/bugs", {"title": "页面崩溃", ...})

命令行:
    python chandao.py --check
    python chandao.py --get /products
    python chandao.py --post /products/1/bugs --data '{"title":"bug"}'
"""

import json
import os
import sqlite3
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path


class Chandao:
    def __init__(self, base_url=None, account=None, password=None):
        self.base_url = (base_url or os.environ.get("CHANDAO_BASE_URL", "")).rstrip("/")
        self.account = account or os.environ.get("CHANDAO_ACCOUNT", "")
        self.password = password or os.environ.get("CHANDAO_PASSWORD", "")

        if not all([self.base_url, self.account, self.password]):
            self._load_env()

        if not all([self.base_url, self.account, self.password]):
            self._load_from_sudowork()

        if not all([self.base_url, self.account, self.password]):
            raise ValueError(
                "缺少禅道凭证。请在远程连接的渠道配置中完成禅道的连接设置。"
            )

        self._api = f"{self.base_url}/api.php/v1"
        self._token = None
        self._token_time = 0

    def _load_env(self):
        """从 .env 文件加载凭证"""
        for env_path in [
            Path(__file__).parent.parent / ".env",
            Path.home() / ".nexus/config/skills/chandao-api/.env",
        ]:
            if env_path.exists():
                for line in env_path.read_text().splitlines():
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        key, val = line.split("=", 1)
                        key, val = key.strip(), val.strip()
                        if key == "CHANDAO_BASE_URL" and not self.base_url:
                            self.base_url = val.rstrip("/")
                        elif key == "CHANDAO_ACCOUNT" and not self.account:
                            self.account = val
                        elif key == "CHANDAO_PASSWORD" and not self.password:
                            self.password = val
                break

    def _load_from_sudowork(self):
        """从 SudoClaw 本地数据库和 Secret Store 加载凭证。

        serverUrl 和 username 从 ~/.nexus/sudowork.db 的 assistant_plugins 表读取，
        password 从 Nexus Secret Store API 读取。
        """
        try:
            home = Path.home()
            db_path = home / ".nexus" / "sudowork.db"
            if db_path.exists():
                conn = sqlite3.connect(str(db_path))
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()

                # 先按 name 精确匹配禅道插件
                cursor.execute(
                    "SELECT config FROM assistant_plugins WHERE name LIKE '%zentao%' LIMIT 1"
                )
                row = cursor.fetchone()

                # 未找到则遍历所有行查找包含 serverUrl 的 config
                if not row:
                    cursor.execute("SELECT config FROM assistant_plugins")
                    for r in cursor.fetchall():
                        config_str = r["config"]
                        if isinstance(config_str, (str, bytes, bytearray)):
                            if isinstance(config_str, (bytes, bytearray)):
                                config_str = config_str.decode("utf-8")
                            if "serverUrl" in config_str or "zentao" in config_str.lower():
                                row = r
                                break

                if row:
                    config_str = row["config"]
                    if isinstance(config_str, (bytes, bytearray)):
                        config_str = config_str.decode("utf-8")
                    config = json.loads(config_str) if isinstance(config_str, str) else config_str
                    if isinstance(config, dict):
                        server_url = config.get("serverUrl", "")
                        username = config.get("zentaoUsername", "")
                        if not server_url or not username:
                            credentials = config.get("credentials", {})
                            if isinstance(credentials, dict):
                                server_url = server_url or credentials.get("serverUrl", "")
                                username = username or credentials.get("zentaoUsername", "")
                        if not self.base_url and server_url:
                            self.base_url = server_url.rstrip("/")
                        if not self.account and username:
                            self.account = username

                conn.close()
        except Exception:
            pass

        # password 从 Nexus Secret Store 读取
        if not self.password:
            try:
                api_key = os.environ.get("NEXUS_API_KEY", "")
                if not api_key:
                    config_yaml = Path.home() / ".nexus" / "config.yaml"
                    if config_yaml.exists():
                        import yaml
                        with open(config_yaml, "r", encoding="utf-8") as f:
                            api_key = (yaml.safe_load(f) or {}).get("apiKey", "")

                nexus_url = os.environ.get("NEXUS_URL", "http://localhost:12012")
                secret_url = (
                    f"{nexus_url}/api/v2/secrets/"
                    f"channel:zentao:zentao_default/zentaoPassword"
                )
                headers = {"Authorization": f"Bearer {api_key}"}
                req = urllib.request.Request(secret_url, headers=headers, method="GET")
                with urllib.request.urlopen(req, timeout=5) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                    self.password = data.get("value", "")
            except Exception:
                pass

    @property
    def token(self):
        """获取 Token，20 分钟自动刷新（有效期 24 分钟）"""
        if self._token and (time.time() - self._token_time) < 1200:
            return self._token
        data = json.dumps({"account": self.account, "password": self.password}).encode()
        req = urllib.request.Request(
            f"{self._api}/tokens",
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        resp = json.loads(urllib.request.urlopen(req).read())
        if "token" not in resp:
            raise RuntimeError(f"获取 Token 失败: {resp}")
        self._token = resp["token"]
        self._token_time = time.time()
        return self._token

    def _request(self, method, path, data=None):
        url = f"{self._api}{path}" if path.startswith("/") else f"{self._api}/{path}"
        headers = {"Token": self.token, "Content-Type": "application/json"}
        body = json.dumps(data).encode() if data else None
        req = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            resp = urllib.request.urlopen(req)
            text = resp.read().decode()
            return json.loads(text) if text.strip() else {}
        except urllib.error.HTTPError as e:
            text = e.read().decode()
            try:
                return json.loads(text)
            except json.JSONDecodeError:
                raise RuntimeError(f"HTTP {e.code}: {text}")

    def get(self, path, params=None):
        if params:
            qs = "&".join(f"{k}={v}" for k, v in params.items())
            path = f"{path}?{qs}" if "?" not in path else f"{path}&{qs}"
        return self._request("GET", path)

    def post(self, path, data=None):
        return self._request("POST", path, data)

    def put(self, path, data=None):
        return self._request("PUT", path, data)

    def delete(self, path):
        return self._request("DELETE", path)

    def action(self, path, data=None):
        """执行动作（开始/完成/关闭等）"""
        return self.post(path, data or {})

    # ── 便捷方法 ──

    def list_products(self, **params):
        r = self.get("/products", {"limit": 100, **params})
        return r.get("products", [])

    def list_projects(self, status=None, **params):
        p = {"limit": 100, **params}
        if status:
            p["status"] = status
        r = self.get("/projects", p)
        return r.get("projects", [])

    def list_executions(self, project_id, **params):
        r = self.get(f"/projects/{project_id}/executions", {"limit": 100, **params})
        return r.get("executions", [])

    def list_tasks(self, execution_id, **params):
        r = self.get(f"/executions/{execution_id}/tasks", {"limit": 100, **params})
        return r.get("tasks", [])

    def list_bugs(self, product_id, **params):
        r = self.get(f"/products/{product_id}/bugs", {"limit": 100, **params})
        return r.get("bugs", [])

    def list_stories(self, product_id, **params):
        r = self.get(f"/products/{product_id}/stories", {"limit": 100, **params})
        return r.get("stories", [])

    def list_users(self, **params):
        r = self.get("/users", {"limit": 100, **params})
        return r.get("users", [])

    def my_profile(self):
        return self.get("/user")


def main():
    import argparse

    parser = argparse.ArgumentParser(description="禅道 REST API v1 CLI")
    parser.add_argument("--check", action="store_true", help="检查凭证是否可用")
    parser.add_argument("--get", metavar="PATH", help="GET 请求")
    parser.add_argument("--post", metavar="PATH", help="POST 请求")
    parser.add_argument("--put", metavar="PATH", help="PUT 请求")
    parser.add_argument("--delete", metavar="PATH", help="DELETE 请求")
    parser.add_argument("--data", metavar="JSON", help="请求体 JSON")
    args = parser.parse_args()

    try:
        api = Chandao()
    except ValueError as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False))
        sys.exit(1)

    if args.check:
        try:
            profile = api.my_profile()
            print(json.dumps({
                "status": "ok",
                "account": profile.get("account"),
                "realname": profile.get("realname"),
                "base_url": api.base_url,
            }, ensure_ascii=False, indent=2))
        except Exception as e:
            print(json.dumps({"error": str(e)}, ensure_ascii=False))
            sys.exit(1)
        return

    data = json.loads(args.data) if args.data else None

    if args.get:
        result = api.get(args.get)
    elif args.post:
        result = api.post(args.post, data)
    elif args.put:
        result = api.put(args.put, data)
    elif args.delete:
        result = api.delete(args.delete)
    else:
        parser.print_help()
        return

    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
