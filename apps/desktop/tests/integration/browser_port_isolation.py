#!/usr/bin/env python3
"""Browser port isolation integration test.

Verifies ai-dev-browser launches a separate Chrome (port 9350+) instead of
connecting to Sudowork's Electron CDP (9230). Runs browser CLI tools as
subprocesses — the same path the agent uses — against a local HTTP server.

Does NOT require Sudowork running, an API key, or external network access.

Usage:
    python tests/integration/browser_port_isolation.py
    python tests/integration/browser_port_isolation.py --sudowork-port 9232

TODO: Expand interaction coverage:
  - Form filling: add <input> + <button>, use type_text + click, verify
  - Multi-tab: page_goto with tab_new=True, verify separate tabs
  - Cookie isolation: set cookie in test Chrome, verify not in Sudowork
  - Concurrent sessions: two browser instances on different ports
"""

import argparse
import asyncio
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import urllib.request
from http.server import HTTPServer, BaseHTTPRequestHandler


# ──────────────────────────────────────────────────────────────
#  Local test pages
# ──────────────────────────────────────────────────────────────

_PAGE1 = """\
<!DOCTYPE html>
<html lang="en">
<head><title>E2E Port Isolation Test</title></head>
<body>
  <h1 id="heading">Browser Isolation Smoke Test</h1>
  <p id="status">initial</p>
  <a id="nav-link" href="/page2">Go to page 2</a>
</body>
</html>
"""

_PAGE2 = """\
<!DOCTYPE html>
<html lang="en">
<head><title>Page 2 - Navigated</title></head>
<body>
  <h1 id="heading">Page 2</h1>
  <p id="result">navigation-success</p>
</body>
</html>
"""


class _Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        pages = {"/": _PAGE1, "/index.html": _PAGE1, "/page2": _PAGE2}
        body = pages.get(self.path)
        if body is None:
            self.send_error(404)
            return
        encoded = body.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, *_):
        pass


def _start_server() -> tuple[HTTPServer, int]:
    server = HTTPServer(("127.0.0.1", 0), _Handler)
    port = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, port


# ──────────────────────────────────────────────────────────────
#  Browser tool runner
# ──────────────────────────────────────────────────────────────

def _find_helper() -> str:
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    return os.path.join(root, "resources", "sudoclaw-bin", "browser_helper.py")


def _run(tool: str, args: list[str] = None, timeout: float = 30) -> dict:
    helper = _find_helper()
    cmd = ["python3", helper, tool] + (args or [])
    env = os.environ.copy()
    env.pop("AI_DEV_BROWSER_PORT", None)
    env["AI_DEV_BROWSER_HEADLESS"] = "1"
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, env=env)
    except subprocess.TimeoutExpired:
        return {"exit": -1, "stdout": "", "stderr": "timeout", "json": None}
    parsed = None
    try:
        parsed = json.loads(r.stdout.strip())
    except (json.JSONDecodeError, ValueError):
        pass
    return {"exit": r.returncode, "stdout": r.stdout.strip(), "stderr": r.stderr.strip(), "json": parsed}


def _cdp_tabs(port: int) -> list[str]:
    try:
        data = urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=2).read()
        return [t.get("url", "") for t in json.loads(data)]
    except Exception:
        return []


def _write_evidence(name: str, evidence: dict) -> None:
    folder = Path(os.environ.get("BROWSER_ISOLATION_ARTIFACT_DIR", ".tmp/browser-port-isolation"))
    folder.mkdir(parents=True, exist_ok=True)
    (folder / name).write_text(json.dumps(evidence, indent=2), encoding="utf-8")


async def _startup_diagnostic(payload: dict) -> dict:
    """Observe only this failed launch's owned target; never retry startup/input."""
    from ai_dev_browser.cdp import network, page, runtime
    from ai_dev_browser.core._transport import CDPConnection

    evidence = {"port": payload.get("port"), "pid": payload.get("pid")}
    if payload.get("owner") != "adb" or not payload.get("automation_target_id"):
        return evidence
    connection = CDPConnection(
        f"ws://127.0.0.1:{payload['port']}/devtools/page/{payload['automation_target_id']}"
    )
    try:
        await asyncio.wait_for(connection.connect(), 2)
        frame = (await connection.send(page.get_frame_tree(), timeout=2)).frame
        evidence["frameIsBlank"] = frame.url == "about:blank"
        value, exception = await connection.send(runtime.evaluate(
            "JSON.stringify({state:document.readyState,isBlank:location.href==='about:blank',"
            "navigation:performance.getEntriesByType('navigation').map(n=>({"
            "isBlank:n.name==='about:blank',hasName:!!n.name,"
            "domContentLoadedEventEnd:n.domContentLoadedEventEnd,domComplete:n.domComplete}))})",
            return_by_value=True,
        ), timeout=2)
        evidence["document"] = json.loads(value.value) if not exception else {"scriptException": True}
        try:
            # Observe readiness without exposing cookie values or making a request.
            await connection.send(network.get_cookies(urls=[f"http://127.0.0.1:{payload['port']}/"]), timeout=2)
            evidence["networkContextReady"] = True
        except Exception as error:
            evidence["networkContextError"] = type(error).__name__
    except Exception as error:
        evidence["observationError"] = type(error).__name__
    finally:
        await connection.disconnect()
    return evidence


# ──────────────────────────────────────────────────────────────
#  Test
# ──────────────────────────────────────────────────────────────

def run_test(sudowork_port: int = 9230, expected_chrome_version: str | None = None) -> tuple[bool, str]:
    """Run the full port isolation test. Returns (passed, message)."""
    # 0. Verify browser_helper.py can find ai_dev_browser tools
    helper = _find_helper()
    if not os.path.isfile(helper):
        return False, f"browser_helper.py not found at {helper}"
    check = _run("--list", timeout=10)
    if check["exit"] != 0 or "page_goto" not in check["stdout"]:
        return False, f"browser --list failed (tools not installed): {check['stderr'] or check['stdout']}"

    server, test_port = _start_server()
    test_url = f"http://127.0.0.1:{test_port}"
    chrome_port = None
    browser_session = None
    failures = []

    try:
        # 1. browser_start — the subprocess timeout MUST exceed ai-dev-browser's
        #    own startup_timeout (30s) for a cold Chrome launch. It used to be 20s,
        #    tighter than the inner budget: on a slow CI cold-start (20–30s) this
        #    outer timeout killed a launch that was still legitimately in progress,
        #    reporting "browser_start failed: timeout" — a pure flake (passed when
        #    Chrome came up fast, failed when it didn't). 60s gives the inner 30s
        #    budget room to either succeed or report a real error, not be preempted.
        start = _run("browser_start", timeout=60)
        payload = start["json"] or {}
        # An unsuccessful startup can still own a live Chrome. Retain its exact
        # session before checking success so the failure path also releases it.
        if payload.get("owner") == "adb":
            chrome_port = payload.get("port")
            browser_session = payload.get("session_id")
        _write_evidence("startup.json", start)
        if start["exit"] != 0 or payload.get("connected") is not True:
            async def observe():
                try:
                    return await asyncio.wait_for(_startup_diagnostic(payload), 10)
                except TimeoutError:
                    return {"observationError": "TimeoutError"}
            diagnostic = asyncio.run(observe())
            _write_evidence("startup-diagnostic.json", diagnostic)
            print("Failed startup observation: " + json.dumps(diagnostic))
            raise RuntimeError(f"browser_start failed: {start['stderr'] or start['stdout']}")
        if not chrome_port or not browser_session:
            raise RuntimeError("Successful startup did not identify its owned browser session.")
        if expected_chrome_version and payload.get("browser_version") != f"Chrome/{expected_chrome_version}":
            raise RuntimeError(f"Expected Chrome/{expected_chrome_version}; launched {payload.get('browser_version')}")
        if chrome_port == sudowork_port:
            failures.append(f"CRITICAL: Chrome started on Sudowork's port {sudowork_port}")
        port_args = ["--port", str(chrome_port)] if chrome_port else []

        import time; time.sleep(2)

        # 2. page_goto
        goto = _run("page_goto", ["--url", test_url] + port_args, timeout=15)
        if goto["exit"] != 0:
            failures.append(f"page_goto failed: {goto['stderr']}")
        else:
            title = (goto["json"] or {}).get("title", "")
            if "E2E Port Isolation Test" not in title:
                failures.append(f"Wrong title: {title}")

        # 3. click_by_text
        click = _run("click_by_text", ["--text", "Go to page 2"] + port_args, timeout=15)
        if click["exit"] != 0:
            failures.append(f"click_by_text failed: {click['stderr']}")
        elif not (click["json"] or {}).get("clicked"):
            failures.append("click_by_text: not clicked")

        import time; time.sleep(1)

        # 4. find_by_text (verify page 2 content)
        find = _run("find_by_text", ["--text", "navigation-success"] + port_args, timeout=10)
        if find["exit"] != 0:
            failures.append(f"find_by_text failed: {find['stderr']}")
        elif not (find["json"] or {}).get("found"):
            failures.append("Page 2 content not found after click")

        # 5. page_screenshot
        ss_path = "/tmp/e2e_port_isolation_test.png"
        ss = _run("page_screenshot", ["--path", ss_path] + port_args, timeout=15)
        if ss["exit"] != 0:
            failures.append(f"page_screenshot failed: {ss['stderr']}")
        elif os.path.isfile(ss_path):
            if os.path.getsize(ss_path) < 100:
                failures.append("Screenshot too small")
            os.unlink(ss_path)
        else:
            failures.append("Screenshot not created")

        # 6. Sudowork tab isolation (only if Sudowork is running)
        sudowork_tabs = _cdp_tabs(sudowork_port)
        if sudowork_tabs:
            if any(str(test_port) in url for url in sudowork_tabs):
                failures.append(f"Test page leaked into Sudowork's {sudowork_port} tabs!")

    except RuntimeError as error:
        failures.append(str(error))
    finally:
        # Cleanup
        if browser_session or chrome_port:
            identity = ["--session-id", browser_session] if browser_session else ["--port", str(chrome_port)]
            stopped = _run("browser_stop", identity, timeout=10)
            _write_evidence("cleanup.json", stopped)
            if stopped["exit"] != 0 or (stopped["json"] or {}).get("count") != 1:
                failures.append(f"Owned Chrome cleanup failed: {stopped['stderr'] or stopped['stdout']}")
        server.shutdown()

    if failures:
        return False, "; ".join(failures)
    return True, f"Chrome:{chrome_port} | goto+click+find+screenshot OK | isolation verified"


# ──────────────────────────────────────────────────────────────
#  Entry point
# ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Browser port isolation integration test")
    parser.add_argument("--sudowork-port", type=int, default=9230, help="Sudowork CDP port to check isolation against")
    parser.add_argument("--expected-chrome-version", help="Refuse an unexpected browser binary instead of accepting a host fallback")
    args = parser.parse_args()

    print("=" * 60)
    print("  Browser Port Isolation Test")
    print("=" * 60)

    passed, message = run_test(args.sudowork_port, args.expected_chrome_version)

    status = "PASS" if passed else "FAIL"
    print(f"\n  {status}: {message}")
    print("=" * 60)
    sys.exit(0 if passed else 1)
