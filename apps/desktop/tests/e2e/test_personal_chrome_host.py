"""Real personal Chrome through the Desktop host and its public SDK worker.

Reuse the pinned public SDK's real extension fixture on both WebSocket backends.
The host journey uses real native input and control leases; it does not run an
LLM or the Electron renderer. Full application acceptance is a separate journey.
"""

import asyncio
import importlib.util
import json
import os
from pathlib import Path
import secrets
import sys
import types

import psutil
import pytest

from ai_dev_browser.core import cdp_send, js_evaluate

repository = Path(__file__).resolve().parents[4]
sdk = Path(
    os.environ.get("SUDOWORK_BROWSER_SDK_SOURCE", repository / "vendor/ai-dev-browser")
)
package_name = "_sudowork_pinned_adb_live"
package = types.ModuleType(package_name)
package.__path__ = [str(sdk / "tests/integration")]
sys.modules[package_name] = package
spec = importlib.util.spec_from_file_location(
    package_name + ".conftest", sdk / "tests/integration/conftest.py"
)
support = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = support
spec.loader.exec_module(support)
live_extension = support.live_extension


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "visibility",
    ["headless", pytest.param("headful", marks=pytest.mark.extension_native)],
)
async def test_desktop_host_preserves_personal_chrome(
    live_extension, tmp_path, visibility
):
    executable = Path(os.environ["SUDOWORK_PERSONAL_HOST_JOURNEY"])
    assert executable.is_file()
    nonce = secrets.token_hex(16)
    cookie = "before_host_attach=" + nonce
    seeded = await live_extension.call(
        cdp_send,
        method="Network.setCookie",
        params=json.dumps(
            {
                "name": "before_host_attach",
                "value": nonce,
                "domain": "127.0.0.1",
                "path": "/",
            }
        ),
    )
    assert seeded["result"] is True
    env = {
        **os.environ,
        "SUDOWORK_BROWSER_LIVE_PYTHON": sys.executable,
        "SUDOWORK_BROWSER_LIVE_EVIDENCE": str(tmp_path),
        "SUDOWORK_BROWSER_LIVE_PYTHONPATH": str(sdk),
        "AI_DEV_BROWSER_EXTENSION_BRIDGE_PORT": str(live_extension.port),
        "SUDOWORK_PERSONAL_COOKIE": cookie,
    }
    with (tmp_path / "desktop-personal-host.log").open("wb") as log:
        process = await asyncio.create_subprocess_exec(
            "node", str(executable), "--personal", env=env, stdout=log, stderr=log
        )
    try:
        assert await asyncio.wait_for(process.wait(), 120) == 0, (
            "See the retained Desktop host journey log"
        )
    finally:
        if process.returncode is None:
            process.terminate()
            await asyncio.wait_for(process.wait(), 10)
    assert psutil.pid_exists(live_extension.chrome_pid), (
        "Host shutdown must leave personal Chrome running"
    )
    still_open = await live_extension.call(
        js_evaluate,
        expression="JSON.stringify({value:document.querySelector('#name').value,cookie:document.cookie})",
    )
    actual = json.loads(still_open["result"])
    assert actual["value"] == "Desktop human 中文" and cookie in actual["cookie"]
    (tmp_path / "personal-host-shutdown-evidence.json").write_text(
        json.dumps(
            {
                "passed": True,
                "actualChrome": True,
                "visibility": visibility,
                "chromeAliveAfterHostShutdown": True,
                "cookieAndUserInputPreserved": True,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
