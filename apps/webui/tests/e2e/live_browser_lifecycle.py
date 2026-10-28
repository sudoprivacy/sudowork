"""Real WebUI lifecycle controls, persistent login and AI return while stopped."""

import argparse
import asyncio
import json
import pathlib
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from ai_dev_browser.core.browser import browser_start, browser_stop
from live_browser_permissions import approve_browser_permission
from live_browser_ui import open_browser_panel, interrupt_shared_browser, continue_from_conversation
from playwright.async_api import async_playwright, expect


async def main(args):
    config = json.loads(args.config.read_text(encoding="utf-8"))
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    source = pathlib.Path(__file__).resolve().parents[4]
    locale = source / "packages/renderer/src/i18n/locales" / args.locale
    login = json.loads((locale / "login.json").read_text(encoding="utf-8"))
    labels = json.loads((locale / "conversation.json").read_text(encoding="utf-8"))
    browser_labels = labels["browserSession"]
    sid = config["sessionId"]
    cookie_name = "lifecycle_login_" + uuid.uuid4().hex[:12]
    ready_marker = "READY_WITHOUT_BROWSER_" + uuid.uuid4().hex[:8]
    visits = []

    class Site(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            if self.path == "/favicon.ico":
                self.send_response(204)
                self.end_headers()
                return
            assert self.path == "/review"
            current_cookie = self.headers.get("Cookie", "")
            visits.append(current_cookie)
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            if len(visits) == 1:
                self.send_header(
                    "Set-Cookie",
                    f"{cookie_name}=present; Path=/; Max-Age=3600; SameSite=Lax",
                )
            self.end_headers()
            self.wfile.write(
                b"<!doctype html><title>Persistent lifecycle login</title><h1>Shared browser lifecycle</h1><p>This page does not reset login cookies after a restart.</p>"
            )

    site = ThreadingHTTPServer(("127.0.0.1", args.fixture_port), Site)
    threading.Thread(target=site.serve_forever, daemon=True).start()
    url = args.fixture_origin.rstrip("/") + "/review"
    own = browser_start(headless=True, temp=True, reuse="none", silent_stderr=True)
    assert "error" not in own, own
    p = await async_playwright().start()
    page = None
    try:
        chrome = await p.chromium.connect_over_cdp(f"http://127.0.0.1:{own['port']}")
        page = chrome.contexts[0].pages[0]
        errors = []
        messages = []
        request_errors = []

        async def response_received(response):
            if (
                response.status < 400
                or f"/api/conversations/{sid}/browser" not in response.url
            ):
                return
            try:
                body = await response.json()
            except ValueError:
                body = {}
            request_body = response.request.post_data_json or {}
            request_errors.append(
                {
                    "kind": request_body.get("kind"),
                    "status": response.status,
                    "error": body.get("error"),
                }
            )

        page.on("response", response_received)
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on(
            "websocket",
            lambda socket: socket.on(
                "framereceived", lambda frame: messages.append(frame)
            ),
        )
        await page.goto(config["origin"] + "/#/login")
        await page.get_by_text(login["passwordTab"], exact=True).click()
        await page.get_by_placeholder(login["pwdAccountPlaceholder"], exact=True).fill(
            config["username"]
        )
        await page.locator('input[type="password"]').fill(config["password"])
        await page.get_by_role("button", name=login["pwdLoginTab"], exact=True).click()
        await page.wait_for_url(lambda value: "/login" not in value, timeout=20000)
        await page.goto(config["origin"] + "/#/conversation/" + sid)
        panel = await open_browser_panel(page, labels["rightPanel"]["tabs"]["browser"])

        async def state():
            response = await page.request.post(
                config["origin"] + f"/api/conversations/{sid}/browser",
                headers={"Origin": config["origin"]},
                data={"kind": "state"},
            )
            assert response.status == 200, await response.text()
            return (await response.json())["session"]

        async def wait_state(predicate):
            deadline = asyncio.get_running_loop().time() + 60
            while True:
                current = await state()
                if predicate(current):
                    return current
                assert asyncio.get_running_loop().time() < deadline, current
                await asyncio.sleep(0.25)

        async def choose(name, option):
            await panel.get_by_label(browser_labels[name], exact=True).click()
            await page.get_by_text(browser_labels[option], exact=True).last.click()

        async def navigate():
            count = len(visits)
            await panel.get_by_label(browser_labels["address"], exact=True).fill(url)
            await panel.get_by_label(browser_labels["address"], exact=True).press(
                "Enter"
            )
            deadline = asyncio.get_running_loop().time() + 20
            while len(visits) == count:
                assert asyncio.get_running_loop().time() < deadline
                await asyncio.sleep(0.1)

        async def confirmed(kind):
            await panel.get_by_role(
                "button", name=browser_labels[kind], exact=True
            ).click()
            await expect(
                page.get_by_text(browser_labels[kind + "ConfirmTitle"], exact=True)
            ).to_be_visible()
            await (
                page.locator(".arco-modal")
                .get_by_role("button", name=browser_labels[kind], exact=True)
                .click()
            )

        stopped = await state()
        assert stopped["state"] == "stopped" and not stopped["isHumanControlHeld"], (
            "Start this journey with the owned browser stopped and its previous "
            "human lease explicitly returned; persistent Chrome can outlive a conversation"
        )
        assert stopped["capabilities"]["lifecycle"] is True
        profile = stopped["profileId"]
        await choose("transport", "extension")
        await choose("launchMode", "headful")
        await panel.get_by_role(
            "button", name=browser_labels["start"], exact=True
        ).click()
        launched = await wait_state(lambda value: value["state"] in ('ai', 'human') and not value["isHeadless"])
        if launched['state'] == 'ai':
            await interrupt_shared_browser(page, panel, browser_labels)
        original = await wait_state(lambda value: value["state"] == "human")
        assert original["transport"] == "extension" and original["profileId"] == profile
        await navigate()
        await expect(
            panel.get_by_role("img", name=browser_labels["page"], exact=True)
        ).to_be_visible()
        await page.screenshot(path=str(output / "lifecycle-headful.png"))
        print("Headful extension session started through the actual panel", flush=True)

        await choose("launchMode", "headless")
        await confirmed("restart")
        headless = await wait_state(
            lambda value: (
                value["state"] == "human"
                and value["isHeadless"]
                and value["browserSessionId"] != original["browserSessionId"]
            )
        )
        assert (
            headless["profileId"] == profile
            and not headless["capabilities"]["windowView"]
        )
        await navigate()
        assert cookie_name + "=present" in visits[-1], "Extension restart lost login"
        await page.screenshot(path=str(output / "lifecycle-headless.png"))
        print("Headless restart retained the login cookie", flush=True)

        await choose("transport", "cdp")
        await choose("launchMode", "headful")
        await confirmed("restart")
        fallback = await wait_state(
            lambda value: (
                value["state"] == "human"
                and value["transport"] == "cdp"
                and not value["isHeadless"]
            )
        )
        assert (
            fallback["profileId"] == profile
            and fallback["browserSessionId"] != headless["browserSessionId"]
        )
        await navigate()
        assert cookie_name + "=present" in visits[-1], "Transport change lost login"
        await page.screenshot(path=str(output / "lifecycle-cdp-headful.png"))
        print("Explicit CDP fallback retained the same profile and cookie", flush=True)

        await confirmed("stop")
        stopped = await wait_state(lambda value: value["state"] == "stopped")
        assert stopped["isHumanControlHeld"] is True and stopped["profileId"] == profile
        await expect(
            panel.get_by_text(browser_labels["stoppedHuman"], exact=True)
        ).to_be_visible()
        await page.screenshot(path=str(output / "lifecycle-stopped-human.png"))
        print("Chrome stopped while the human lease stayed active", flush=True)
        start = len(messages)
        await continue_from_conversation(page,
            "The browser is intentionally stopped. Keep it stopped; do not launch Chrome or use shell. "
            f"Observe its current stopped state, then reply {ready_marker}."
        )
        returned = await wait_state(
            lambda value: (
                value["state"] == "stopped" and not value["isHumanControlHeld"]
            )
        )
        approvals = []
        approved_ids = set()
        reply = (
            page.locator(".message-item.text.justify-start")
            .get_by_text(ready_marker, exact=False)
            .first
        )
        deadline = asyncio.get_running_loop().time() + 180
        while not await reply.is_visible():
            last_tool = None
            for raw in messages[start:]:
                if not isinstance(raw, str):
                    continue
                try:
                    message = json.loads(raw)
                except ValueError:
                    continue
                if message.get("kind") != "upstream":
                    continue
                event = message.get("event", {})
                if event.get("type") == "tool_use":
                    tool_input = event.get("input", {})
                    if isinstance(tool_input, str):
                        tool_input = json.loads(tool_input)
                    last_tool = (event.get("name", ""), tool_input)
                if event.get("type") == "control_request":
                    request_id = event.get("request_id")
                    if request_id not in approved_ids:
                        approvals.append(
                            await approve_browser_permission(page, event, last_tool)
                        )
                        approved_ids.add(request_id)
            assert asyncio.get_running_loop().time() < deadline, (
                "The actual AI must complete its stopped-browser return"
            )
            await asyncio.sleep(0.25)
        deadline = asyncio.get_running_loop().time() + 30
        while True:
            assistant_text = ""
            current_result = None
            for raw in messages[start:]:
                if not isinstance(raw, str):
                    continue
                try:
                    message = json.loads(raw)
                except ValueError:
                    continue
                if message.get("kind") != "upstream":
                    continue
                event = message.get("event", {})
                if event.get("type") == "assistant":
                    content = event.get("message", {}).get("content", [])
                    assistant_text += (
                        content
                        if isinstance(content, str)
                        else "".join(
                            block.get("text", "")
                            for block in content
                            if isinstance(block, dict) and block.get("type") == "text"
                        )
                    )
                if ready_marker in assistant_text and event.get("type") == "result":
                    current_result = event
                    break
            if current_result:
                assert not current_result.get("is_error"), "Real AI return failed"
                break
            assert asyncio.get_running_loop().time() < deadline, (
                "Real AI return did not finish"
            )
            await asyncio.sleep(0.25)
        assert (await state())["state"] == "stopped", (
            "AI reopened an intentionally stopped browser"
        )
        assert not errors, errors
        unexpected_errors = [
            failure
            for failure in request_errors
            if not (
                failure["kind"] in ("frame", "attach", "detach")
                and failure["status"] == 409
                and failure["error"]
                in ("browser_not_started", "stale_browser_operation")
            )
        ]
        assert not unexpected_errors, unexpected_errors
        await page.screenshot(path=str(output / "lifecycle-returned-stopped.png"))
        evidence = {
            "workflow": "actual-webui-browser-lifecycle",
            "sessionId": sid,
            "profileId": profile,
            "extensionModeChange": True,
            "explicitCdpFallback": True,
            "loginCookiePreserved": True,
            "stoppedDisplayReleased": not returned["capabilities"]["windowView"],
            "humanLeasePreservedOnStop": True,
            "automaticAIContinuationWhileStopped": True,
            "assistantReceipt": ready_marker,
            "modelUsage": current_result.get("usage"),
            "visibleOneTimeApprovals": approvals,
            "fencedViewRequests": request_errors,
            "browserSessionIds": [
                value["browserSessionId"] for value in (original, headless, fallback)
            ],
            "pageErrors": errors,
        }
        (output / "lifecycle-evidence.json").write_text(
            json.dumps(evidence, indent=2), encoding="utf-8"
        )
        print(json.dumps(evidence))
    except BaseException:
        if page and not page.is_closed():
            await page.screenshot(path=str(output / "lifecycle-failure.png"))
            (output / "request-errors.json").write_text(
                json.dumps(request_errors), encoding="utf-8"
            )
        raise
    finally:
        await p.stop()
        browser_stop(session_id=own["session_id"])
        site.shutdown()
        site.server_close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=pathlib.Path, required=True)
    parser.add_argument("--output", type=pathlib.Path, required=True)
    parser.add_argument("--locale", default="zh-CN")
    parser.add_argument("--fixture-port", type=int, default=50181)
    parser.add_argument("--fixture-origin", required=True)
    asyncio.run(main(parser.parse_args()))
