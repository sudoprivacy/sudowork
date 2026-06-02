"""Verify ai-dev-browser port isolation from Sudowork's Electron.

Spins up a local HTTP server, then runs browser CLI tools (browser_start,
page_goto, click_by_text, page_screenshot) as subprocesses — the same way
the agent invokes them — and verifies:
  1. Chrome launches on a separate port, NOT on Sudowork's CDP port
  2. Browser tools interact with the local test page, not Sudowork
  3. Click + navigation works end-to-end
  4. Sudowork's renderer tab stays on localhost (not navigated away)
  5. Sudowork's 9230 tabs do NOT include the test page URL

Does NOT require an API key or external network access.

TODO: Expand interaction coverage to be more robust against regressions:
  - Form filling: add an <input> + <button> to the test page, use type_text
    + click to submit, verify the submitted value on a result page
  - Scroll: add a long page and verify scroll_to / scroll_by work
  - find_by_xpath: verify XPath selectors resolve correctly
  - Multi-tab: open tab_new=True, verify both tabs are on the separate
    Chrome and neither leaks into Sudowork's 9230 target list
  - Cookie isolation: set a cookie in the test Chrome, verify it does NOT
    appear in Sudowork's Electron session
  - Concurrent sessions: start two browser instances, verify both get
    separate ports and neither collides with Sudowork
"""

import asyncio
import json
import os
import subprocess
import threading
import urllib.request
from http.server import HTTPServer, SimpleHTTPRequestHandler
from io import BytesIO

from ai_dev_browser.core.page import js_evaluate


# ──────────────────────────────────────────────────────────────
#  Local test page server
# ──────────────────────────────────────────────────────────────

_TEST_PAGE_HTML = """\
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

_TEST_PAGE2_HTML = """\
<!DOCTYPE html>
<html lang="en">
<head><title>Page 2 - Navigated</title></head>
<body>
  <h1 id="heading">Page 2</h1>
  <p id="result">navigation-success</p>
</body>
</html>
"""


class _TestHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/" or self.path == "/index.html":
            body = _TEST_PAGE_HTML.encode()
        elif self.path == "/page2":
            body = _TEST_PAGE2_HTML.encode()
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass  # suppress request logging


def _start_test_server() -> tuple[HTTPServer, int]:
    """Start a local HTTP server on a random port. Returns (server, port)."""
    server = HTTPServer(("127.0.0.1", 0), _TestHandler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, port


# ──────────────────────────────────────────────────────────────
#  Browser tool helpers
# ──────────────────────────────────────────────────────────────

def _find_browser_helper() -> str:
    candidates = [
        os.path.join(os.getcwd(), "resources", "sudoclaw-bin", "browser_helper.py"),
        os.path.join(os.path.dirname(__file__), "..", "..", "..", "resources", "sudoclaw-bin", "browser_helper.py"),
    ]
    for c in candidates:
        if os.path.isfile(c):
            return os.path.abspath(c)
    return "browser_helper.py"


def _run_browser_tool(tool: str, args: list[str] = None, timeout: float = 30) -> dict:
    """Run a browser CLI tool via browser_helper.py (mimics agent invocation)."""
    helper = _find_browser_helper()
    cmd = ["python3", helper, tool] + (args or [])

    env = os.environ.copy()
    env.pop("AI_DEV_BROWSER_PORT", None)  # must NOT be set
    env["AI_DEV_BROWSER_HEADLESS"] = "1"

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, env=env)
    except subprocess.TimeoutExpired:
        return {"exit_code": -1, "stdout": "", "stderr": "timeout", "json": None}

    parsed = None
    try:
        parsed = json.loads(result.stdout.strip())
    except (json.JSONDecodeError, ValueError):
        pass

    return {
        "exit_code": result.returncode,
        "stdout": result.stdout.strip(),
        "stderr": result.stderr.strip(),
        "json": parsed,
    }


def _get_cdp_tabs(port: int) -> list[str]:
    """Return list of tab URLs from CDP /json/list."""
    try:
        data = urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=2).read()
        return [t.get("url", "") for t in json.loads(data)]
    except Exception:
        return []


# ──────────────────────────────────────────────────────────────
#  Main op
# ──────────────────────────────────────────────────────────────

async def browser_port_isolation(tab, sudowork_cdp_port: int = 9230) -> dict:
    """Full browser port isolation smoke test with real interactions.

    Workflow:
      1. Start local HTTP test server
      2. browser_start → verify Chrome port != Sudowork port
      3. page_goto local test page → verify title
      4. click_by_text "Go to page 2" → verify navigation
      5. page_screenshot → verify file created
      6. Verify Sudowork renderer is still on localhost
      7. Verify Sudowork 9230 tabs don't include test page
      8. browser_stop → cleanup
    """
    details = {}
    failures = []

    # ── Step 1: Start local test server ──
    test_server, test_port = _start_test_server()
    test_url = f"http://127.0.0.1:{test_port}"
    details["test_server_port"] = test_port

    try:
        # ── Step 2: browser_start ──
        start = _run_browser_tool("browser_start", timeout=20)
        details["browser_start"] = {"exit_code": start["exit_code"], "json": start["json"]}

        if start["exit_code"] != 0:
            return {
                "pass": False,
                "reason": f"browser_start failed: {start['stderr'] or start['stdout']}",
                "details": details,
            }

        chrome_port = start["json"].get("port") if start["json"] else None
        details["chrome_port"] = chrome_port

        if chrome_port == sudowork_cdp_port:
            failures.append(f"CRITICAL: browser_start returned Sudowork's CDP port {sudowork_cdp_port}")

        await asyncio.sleep(2)

        # ── Step 3: page_goto local test page ──
        goto_args = ["--url", test_url]
        if chrome_port:
            goto_args += ["--port", str(chrome_port)]

        goto = _run_browser_tool("page_goto", goto_args, timeout=15)
        details["page_goto"] = {"exit_code": goto["exit_code"], "json": goto["json"]}

        if goto["exit_code"] != 0:
            failures.append(f"page_goto failed: {goto['stderr'] or goto['stdout']}")
        else:
            title = (goto["json"] or {}).get("title", "")
            if "E2E Port Isolation Test" not in title:
                failures.append(f"Unexpected page title: {title}")
            details["page1_title"] = title

        # ── Step 4: click_by_text "Go to page 2" ──
        click_args = ["--text", "Go to page 2"]
        if chrome_port:
            click_args += ["--port", str(chrome_port)]

        click = _run_browser_tool("click_by_text", click_args, timeout=15)
        details["click_by_text"] = {"exit_code": click["exit_code"], "json": click["json"]}

        if click["exit_code"] != 0:
            failures.append(f"click_by_text failed: {click['stderr'] or click['stdout']}")
        else:
            clicked = (click["json"] or {}).get("clicked", False)
            navigated = (click["json"] or {}).get("navigated", False)
            if not clicked:
                failures.append("click_by_text did not click")
            details["click_navigated"] = navigated

        await asyncio.sleep(1)

        # ── Step 4b: Verify page 2 content via find_by_text ──
        find_args = ["--text", "navigation-success"]
        if chrome_port:
            find_args += ["--port", str(chrome_port)]

        find = _run_browser_tool("find_by_text", find_args, timeout=10)
        details["find_by_text"] = {"exit_code": find["exit_code"], "json": find["json"]}

        if find["exit_code"] != 0:
            failures.append(f"find_by_text on page2 failed: {find['stderr']}")
        else:
            found = (find["json"] or {}).get("found", False)
            if not found:
                failures.append("Page 2 content 'navigation-success' not found after click")

        # ── Step 5: page_screenshot ──
        screenshot_path = "/tmp/e2e_port_isolation_test.png"
        ss_args = ["--path", screenshot_path]
        if chrome_port:
            ss_args += ["--port", str(chrome_port)]

        ss = _run_browser_tool("page_screenshot", ss_args, timeout=15)
        details["page_screenshot"] = {"exit_code": ss["exit_code"]}

        if ss["exit_code"] != 0:
            failures.append(f"page_screenshot failed: {ss['stderr']}")
        elif os.path.isfile(screenshot_path):
            size = os.path.getsize(screenshot_path)
            details["screenshot_size"] = size
            if size < 100:
                failures.append(f"Screenshot too small ({size} bytes)")
            # Cleanup
            os.unlink(screenshot_path)
        else:
            failures.append("Screenshot file not created")

        # ── Step 6: Sudowork renderer still on localhost ──
        r = await js_evaluate(tab, "window.location.href")
        sudowork_url = r.get("result", "")
        details["sudowork_url_after"] = sudowork_url

        if "localhost" not in sudowork_url and "127.0.0.1" not in sudowork_url:
            failures.append(f"Sudowork renderer navigated away to: {sudowork_url}")

        # ── Step 7: Sudowork 9230 tabs should NOT contain test page ──
        sudowork_tabs = _get_cdp_tabs(sudowork_cdp_port)
        details["sudowork_9230_tabs"] = sudowork_tabs

        test_page_in_sudowork = any(str(test_port) in url for url in sudowork_tabs)
        if test_page_in_sudowork:
            failures.append(f"Test page (port {test_port}) appeared in Sudowork's 9230 tabs!")

        # ── Step 8: browser_stop ──
        if chrome_port:
            stop = _run_browser_tool("browser_stop", ["--port", str(chrome_port)], timeout=10)
            details["browser_stop"] = {"exit_code": stop["exit_code"]}

    finally:
        test_server.shutdown()

    if failures:
        return {"pass": False, "reason": "; ".join(failures), "details": details}

    return {
        "pass": True,
        "reason": f"Chrome:{chrome_port} | goto+click+screenshot OK | Sudowork UI intact",
        "details": details,
    }
