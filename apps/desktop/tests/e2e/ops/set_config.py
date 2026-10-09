"""Set a ConfigStorage value on disk. Requires an app restart to take effect
(callers should follow with `restart_app`) OR schedule this op BEFORE the
first `wait_for_app_ready` so the app boots reading the pre-set value.

Used by e2e cases that need to enable/disable an in-app setting without
driving through the settings UI. Reuses the base64+urlencode format helpers
in `_enterprise_config.py` so the file layout matches Electron's write path.
"""

from ._enterprise_config import set_config_value


async def set_config(tab, key: str = "", value=None) -> dict:
    """Persist a single ConfigStorage key/value pair.

    Args:
        tab: unused (kept for op-signature parity).
        key: dotted ConfigStorage key (e.g. "agent.messageQueue").
        value: JSON-serialisable value.

    Returns:
        {"pass": True, "key": key, "value": value} on success.
    """
    if not key:
        return {"pass": False, "error": "no key provided"}
    _ = tab
    set_config_value(key, value)
    return {"pass": True, "key": key, "value": value}
