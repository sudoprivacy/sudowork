"""Shared utilities for enterprise E2E tests.

Handles ConfigStorage file operations since ConfigStorage uses bridge IPC
(not localStorage) in Electron. The actual data is stored in a JSON file at:
  ~/.nexus/config/sudowork-config.txt

Encoding format (matches Electron's JsonFileBuilder):
  Write: base64(url_encode(json_string))
  Read:  url_decode(base64_decode(file_content))
"""

import base64
import json
import urllib.parse
from pathlib import Path


def _get_config_file_path() -> Path:
    """Get the path to the sudowork config file."""
    home = Path.home()
    config_dir = home / ".nexus" / "config"
    return config_dir / "sudowork-config.txt"


def _read_config() -> dict:
    """Read the ConfigStorage JSON from disk.

    File format: base64(url_encode(json_string))
    Decode: base64_decode(content) → url_decode → json_parse

    Returns:
        dict: The config key-value store
    """
    config_path = _get_config_file_path()
    if not config_path.exists():
        return {}

    with open(config_path, "r", encoding="utf-8") as f:
        content = f.read().strip()

    if not content:
        return {}

    try:
        # base64 decode → URL decode → JSON parse
        # Matches Electron: decodeURIComponent(atob(content))
        decoded_b64 = base64.b64decode(content).decode("utf-8")
        decoded_url = urllib.parse.unquote(decoded_b64)
        return json.loads(decoded_url)
    except Exception:
        # Fallback: try direct JSON parse
        try:
            return json.loads(content)
        except Exception:
            return {}


def _write_config(data: dict) -> None:
    """Write the ConfigStorage JSON to disk.

    File format: base64(url_encode(json_string))
    Encode: url_encode(json_string) → base64_encode
    Matches Electron: btoa(encodeURIComponent(json_string))
    """
    config_path = _get_config_file_path()
    config_path.parent.mkdir(parents=True, exist_ok=True)

    json_str = json.dumps(data, ensure_ascii=False)
    # URL-encode the JSON string, then base64 encode
    # Matches Electron: btoa(encodeURIComponent(json_string))
    url_encoded = urllib.parse.quote(json_str, safe='')
    encoded = base64.b64encode(url_encoded.encode("utf-8")).decode("utf-8")

    with open(config_path, "w", encoding="utf-8") as f:
        f.write(encoded)


def clear_enterprise_config() -> None:
    """Remove all enterprise-related keys from ConfigStorage file."""
    config = _read_config()
    keys_to_remove = [
        "system.appMode",
        "eeclaw.serverUrl",
        "eeclaw.tenantName",
        "eeclaw.userInfo",
        "eeclaw.authStorage",
    ]
    for key in keys_to_remove:
        config.pop(key, None)
    _write_config(config)


def set_enterprise_config(server_url: str, tenant_name: str) -> None:
    """Set enterprise mode in ConfigStorage file."""
    config = _read_config()
    config["system.appMode"] = "e"
    config["eeclaw.serverUrl"] = server_url
    config["eeclaw.tenantName"] = tenant_name
    _write_config(config)


def set_consumer_mode_config() -> None:
    """Set consumer mode in ConfigStorage file."""
    config = _read_config()
    config["system.appMode"] = "c"
    _write_config(config)


def set_enterprise_auth_config(access_token: str = "mock-access-token",
                                refresh_token: str = "mock-refresh-token",
                                expires_at: int = 9999999999,
                                device_id: str = "e2e-test-device") -> None:
    """Set enterprise auth in ConfigStorage file."""
    config = _read_config()
    config["eeclaw.authStorage"] = {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "expires_at": expires_at,
        "device_id": device_id,
    }
    config["eeclaw.userInfo"] = {
        "id": "user-001",
        "username": "admin",
        "nickname": "admin",
        "role": "USER",
        "status": 1,
        "token": access_token,
    }
    _write_config(config)


def clear_enterprise_auth_config() -> None:
    """Remove enterprise auth from ConfigStorage file."""
    config = _read_config()
    config.pop("eeclaw.authStorage", None)
    config.pop("eeclaw.userInfo", None)
    _write_config(config)


def get_config_value(key: str):
    """Get a value from ConfigStorage file."""
    config = _read_config()
    return config.get(key)


def set_config_value(key: str, value) -> None:
    """Set a value in ConfigStorage file."""
    config = _read_config()
    config[key] = value
    _write_config(config)
