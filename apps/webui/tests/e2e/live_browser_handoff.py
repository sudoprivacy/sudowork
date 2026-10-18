"""Actual WebUI chat -> real MCP model -> Chrome -> viewer input -> submission."""

import argparse
import asyncio
import json
import pathlib
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from ai_dev_browser.core.browser import browser_start, browser_stop
from live_browser_permissions import approve_browser_permission
from live_browser_ui import open_browser_panel
from playwright.async_api import Error as PlaywrightError
from playwright.async_api import async_playwright, expect

receipts = []
page_html = """<!doctype html><title>Shared browser acceptance</title>
<style>body{margin:0;background:#f4f1e9;font:20px sans-serif}h1{position:absolute;left:40px;top:28px}label{position:absolute;left:40px;top:112px}input{position:absolute;left:40px;top:150px;width:360px;height:40px;font:22px sans-serif}button{position:absolute;left:40px;top:218px;width:220px;height:44px;font:20px sans-serif}#result{position:absolute;left:40px;top:300px}</style>
<h1>Shared browser acceptance</h1><label for="participant">Participant</label><input id="participant" autocomplete="off"><button id="submit">Submit review</button><p id="result">Waiting for a review</p>
<script>document.querySelector('#submit').onclick=async e=>{const r=await fetch('/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({value:document.querySelector('#participant').value,trusted:e.isTrusted,cookie:document.cookie})});if(r.ok){document.querySelector('#result').textContent='Review accepted';document.title='Review accepted';}};</script>"""


class Site(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        payload = (
            json.dumps(receipts).encode()
            if self.path == "/receipts"
            else page_html.encode()
        )
        self.send_response(200)
        self.send_header(
            "Content-Type",
            "application/json"
            if self.path == "/receipts"
            else "text/html; charset=utf-8",
        )
        self.send_header(
            "Set-Cookie", "shared_fixture=original-browser; Path=/; SameSite=Lax"
        )
        self.end_headers()
        self.wfile.write(payload)

    def do_POST(self):
        assert self.path == "/submit"
        value = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        receipts.append(value)
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"{}")


async def main(args):
    config = json.loads(args.config.read_text(encoding="utf-8"))
    admin = {"username": config["username"], "password": config["password"]}
    sid = config["sessionId"]
    evidence_root = args.output.resolve()
    evidence_root.mkdir(parents=True, exist_ok=False)
    locale = (
        pathlib.Path(__file__).resolve().parents[4]
        / "packages/renderer/src/i18n/locales"
        / args.locale
    )
    login = json.loads((locale / "login.json").read_text(encoding="utf-8"))
    conversation = json.loads(
        (locale / "conversation.json").read_text(encoding="utf-8")
    )
    labels = conversation["browserSession"]
    site = ThreadingHTTPServer((args.fixture_bind, args.fixture_port), Site)
    threading.Thread(target=site.serve_forever, daemon=True).start()
    fixture_origin = (
        args.fixture_origin or f"http://{args.fixture_host}:{site.server_port}"
    )
    url = fixture_origin.rstrip("/") + "/review?run=" + uuid.uuid4().hex
    expected = (
        "iPhone 中文 " if args.manual_human else "Human review "
    ) + uuid.uuid4().hex[:8]
    own = browser_start(headless=True, temp=True, reuse="none", silent_stderr=True)
    assert "error" not in own, own
    try:
        async with async_playwright() as p:
            chrome = await p.chromium.connect_over_cdp(
                f"http://127.0.0.1:{own['port']}"
            )
            page = chrome.contexts[0].pages[0]
            await page.set_viewport_size({"width": 1440, "height": 900})
            errors = []
            messages = []
            approvals = []
            approved_ids = set()
            page.on("pageerror", lambda e: errors.append(str(e)))

            def websocket(socket):
                socket.on("framereceived", lambda v: messages.append(v))

            page.on("websocket", websocket)
            await page.goto(
                config["origin"] + "/#/login", wait_until="domcontentloaded"
            )
            await page.get_by_text(login["passwordTab"], exact=True).click()
            await page.get_by_placeholder(
                login["pwdAccountPlaceholder"], exact=True
            ).fill(admin["username"])
            await page.locator('input[type="password"]').fill(admin["password"])
            await page.get_by_role(
                "button", name=login["pwdLoginTab"], exact=True
            ).click()
            await page.wait_for_url(lambda u: "/login" not in u, timeout=20000)
            await page.goto(
                config["origin"] + "/#/conversation/" + sid,
                wait_until="domcontentloaded",
            )
            await page.locator("textarea").first.wait_for(
                state="visible", timeout=30000
            )
            panel = await open_browser_panel(
                page, conversation["rightPanel"]["tabs"]["browser"]
            )

            async def state():
                response = await page.request.post(
                    config["origin"] + "/api/conversations/" + sid + "/browser",
                    headers={"Origin": config["origin"]},
                    data={"kind": "state"},
                )
                assert response.status == 200, await response.text()
                return (await response.json())["session"]

            before = await state()
            initial_profile = before["profileId"]

            async def send(text):
                print("Sending a real model turn", flush=True)
                await page.bring_to_front()
                editor = page.locator("textarea").first
                await editor.fill(text)
                await editor.press("Enter")

            async def wait_turn(start, required=None, assistant_reply=None):
                deadline = time.monotonic() + args.turn_timeout
                while time.monotonic() < deadline:
                    if assistant_reply and receipts:
                        assert (
                            len(receipts) == 1
                            and receipts[0]["value"] == assistant_reply
                        ), (
                            "The submitted value must match the external human's exact input"
                        )
                    is_current_turn = False
                    last_tool = None
                    assistant_text = ""
                    for raw in messages[start:]:
                        if not isinstance(raw, str):
                            continue
                        try:
                            message = json.loads(raw)
                        except ValueError:
                            continue
                        event = message.get("event", {})
                        if message.get("kind") != "upstream":
                            continue
                        if event.get("type") == "tool_use":
                            tool_input = event.get("input", {})
                            if isinstance(tool_input, str):
                                tool_input = json.loads(tool_input)
                            last_tool = (event.get("name", ""), tool_input)
                        if event.get("type") == "control_request":
                            request_id = event.get("request_id")
                            if request_id not in approved_ids:
                                approvals.append(
                                    await approve_browser_permission(
                                        page, event, last_tool
                                    )
                                )
                                approved_ids.add(request_id)
                        if required and required(event):
                            is_current_turn = True
                        if assistant_reply and event.get("type") == "assistant":
                            content = event.get("message", {}).get("content", [])
                            if isinstance(content, str):
                                assistant_text += content
                            elif isinstance(content, list):
                                assistant_text += "".join(
                                    block.get("text", "")
                                    for block in content
                                    if isinstance(block, dict)
                                    and block.get("type") == "text"
                                )
                            if assistant_reply in assistant_text:
                                is_current_turn = True
                        if is_current_turn and event.get("type") == "result":
                            assert not event.get("is_error"), "Real model turn failed"
                            return
                    await asyncio.sleep(0.25)
                (evidence_root / "stream-summary.json").write_text(
                    json.dumps(stream_summary(messages), indent=2), encoding="utf-8"
                )
                raise AssertionError(
                    "The current model journey did not finish; inspect stream-summary.json"
                )

            start = len(messages)
            launch_requirement = (
                "This task needs Chrome's native window controls. Launch a headful managed extension browser if stopped."
                if args.headful
                else "If it is stopped, launch it with an explicit headless choice suited to this background task and the configured transport."
            )
            await send(
                f"Browser handoff acceptance. Use only the sudowork-browser MCP tools, not shell or another browser. Observe the shared browser. {launch_requirement} Then navigate its current tab to {url}, and observe the Participant form. Do not fill or submit anything. Reply READY_FOR_HUMAN when the form is open."
            )
            await wait_turn(
                start,
                lambda event: (
                    event.get("type") == "tool_use"
                    and event.get("name") == "mcp__sudowork-browser__browser_observe"
                ),
            )
            loaded = await state()
            # A connected conversation can replay an earlier result while its
            # new turn is still running. Require this run's unique fixture URL
            # before treating a completion as acceptance of the new request.
            deadline = time.monotonic() + args.turn_timeout
            while (
                not any(tab["url"] == url for tab in loaded["tabs"])
                and time.monotonic() < deadline
            ):
                await asyncio.sleep(0.25)
                loaded = await state()
            assert loaded["profileId"] == initial_profile
            if args.headful:
                assert (
                    loaded["isHeadless"] is False and loaded["transport"] == "extension"
                ), loaded
                assert loaded["capabilities"]["windowView"] is True, loaded
            if before["state"] != "stopped":
                assert loaded["browserSessionId"] == before["browserSessionId"]
            before = loaded
            await expect(
                panel.get_by_role("button", name=labels["take"], exact=True)
            ).to_be_enabled(timeout=20000)
            assert any(tab["url"] == url for tab in loaded["tabs"]), loaded
            assert receipts == [], receipts
            await expect(
                panel.get_by_role("img", name=labels["page"], exact=True)
            ).to_be_visible()
            async with page.expect_popup() as opened:
                await panel.get_by_role(
                    "button", name=labels["openViewer"], exact=True
                ).click()
            viewer = await opened.value
            await viewer.wait_for_load_state("domcontentloaded")
            await viewer.bring_to_front()
            viewer_panel = viewer.get_by_test_id("browser-session-panel")
            await viewer_panel.wait_for(state="visible")
            if args.manual_human:
                start = len(messages)
                ready = {
                    "readyForExternalHuman": True,
                    "viewerUrl": viewer.url,
                    "conversationUrl": page.url,
                    "expectedHumanValue": expected,
                    "handoffNote": "Read the Participant value, report it exactly, then submit once with a trusted browser click. Do not replace the value.",
                    "humanInputDrivenByHarness": False,
                    "controllerViewport": await page.evaluate(
                        "()=>({width:innerWidth,height:innerHeight,scale:devicePixelRatio})"
                    ),
                }
                (evidence_root / "manual-human-ready.json").write_text(
                    json.dumps(ready, ensure_ascii=False, indent=2), encoding="utf-8"
                )
                print(json.dumps(ready, ensure_ascii=False), flush=True)
            else:
                await viewer_panel.get_by_role(
                    "button", name=labels["take"], exact=True
                ).click()
                await expect(
                    viewer_panel.get_by_role(
                        "button", name=labels["return"], exact=True
                    )
                ).to_be_enabled(timeout=15000)
                await expect(
                    panel.get_by_role("button", name=labels["take"], exact=True)
                ).to_be_disabled()
                image = viewer_panel.get_by_role("img", name=labels["page"], exact=True)
                await expect(image).to_be_visible()
                if args.headful:
                    await viewer.wait_for_function(
                        "()=>document.querySelector('[data-testid=browser-session-panel] img')?.naturalWidth===1280"
                    )
                    await viewer.screenshot(
                        path=str(evidence_root / "ui-headful-window.png")
                    )
                    # Exercise native Chrome input through the actual authenticated
                    # window surface, then use page view for the review form.
                    window_size = await image.evaluate(
                        "e=>({w:e.clientWidth,h:e.clientHeight,nw:e.naturalWidth,nh:e.naturalHeight})"
                    )
                    await image.click(
                        position={
                            "x": 300 * window_size["w"] / window_size["nw"],
                            "y": 70 * window_size["h"] / window_size["nh"],
                        }
                    )
                    await viewer_panel.get_by_label(labels["text"], exact=True).fill(
                        url
                    )
                    await viewer_panel.get_by_role(
                        "button", name=labels["insert"], exact=True
                    ).click()
                    await expect(
                        viewer_panel.get_by_label(labels["text"], exact=True)
                    ).to_have_value("")
                    await image.press("Enter")
                    await viewer_panel.get_by_label(
                        labels["viewMode"], exact=True
                    ).click()
                    await viewer.get_by_text(labels["pageView"], exact=True).click()
                    await viewer.wait_for_function(
                        "()=>{const e=document.querySelector('[data-testid=browser-session-panel] img');return e?.naturalWidth>100&&e.naturalHeight<900}"
                    )
                size = await image.evaluate(
                    "(e)=>({w:e.clientWidth,h:e.clientHeight,nw:e.naturalWidth,nh:e.naturalHeight})"
                )
                await image.click(
                    position={
                        "x": 200 * size["w"] / size["nw"],
                        "y": 170 * size["h"] / size["nh"],
                    }
                )
                await viewer_panel.get_by_label(labels["text"], exact=True).fill(
                    expected
                )
                await viewer_panel.get_by_role(
                    "button", name=labels["insert"], exact=True
                ).click()
                await expect(
                    viewer_panel.get_by_label(labels["text"], exact=True)
                ).to_have_value("")
                await viewer.screenshot(
                    path=str(evidence_root / "ui-handoff-human-input.png")
                )
                start = len(messages)
                await send(
                    "Control is held by the human. Attempt exactly one browser_action reload using freshly observed epochs to verify it is rejected. Do not use any other route, change anything or submit. Report HELD_BY_HUMAN and stop."
                )
                await wait_turn(
                    start,
                    lambda event: (
                        event.get("type") == "tool_result"
                        and "browser_control_held_by_user" in json.dumps(event)
                    ),
                )
                held = messages[start:]
                assert any(
                    "browser_control_held_by_user" in m
                    for m in held
                    if isinstance(m, str)
                ), "The human lease did not reject the AI write"
                assert receipts == [], receipts
                await viewer.bring_to_front()
                await viewer_panel.get_by_label(labels["note"], exact=True).fill(
                    "I filled the Participant field. Freshly observe the same page, report the exact value, "
                    "then submit once with a real click. Do not change the value, call the form API, "
                    "use a JS click, or start another browser."
                )
                start = len(messages)
                await viewer_panel.get_by_role(
                    "button", name=labels["return"], exact=True
                ).click()
                await expect(
                    viewer_panel.get_by_role("button", name=labels["take"], exact=True)
                ).to_be_enabled(timeout=15000)
            if args.manual_continuation:
                await send(
                    "Human control has been explicitly returned. Use sudowork-browser MCP browser_observe to freshly read the same page. Report the exact Participant value you see, then submit the review exactly once with a real click. Do not replace or fill the value, use JS click, call the form API, or start another browser."
                )
            await wait_turn(
                start,
                assistant_reply=expected,
            )
            deadline = time.monotonic() + 10
            while not receipts and time.monotonic() < deadline:
                await asyncio.sleep(0.1)
            assert len(receipts) == 1, receipts
            assert receipts[0]["value"] == expected and receipts[0]["trusted"] is True
            cookies = dict(
                item.strip().split("=", 1)
                for item in receipts[0]["cookie"].split(";")
                if "=" in item
            )
            assert cookies.get("shared_fixture") == "original-browser", (
                "The shared browser must retain its original fixture login cookie"
            )
            after = await state()
            assert after["browserSessionId"] == before["browserSessionId"]
            assert after["profileId"] == before["profileId"]
            await page.bring_to_front()
            await expect(page.get_by_text(expected, exact=False).first).to_be_visible(
                timeout=20000
            )
            # A successful live stream must survive a real browser refresh.
            # Moss persists artifacts alongside messages; rejecting those frames
            # previously made the entire history disappear after navigation.
            async with page.expect_response(
                lambda response: response.url.endswith(
                    f"/api/conversations/{sid}/context"
                )
            ) as restored:
                await page.reload(wait_until="domcontentloaded")
            history_response = await restored.value
            assert history_response.status == 200, await history_response.text()
            history = await history_response.json()
            restored_texts = [
                message.get("content", {}).get("content", "")
                for message in history.get("messages", [])
                if message.get("type") == "text" and message.get("position") == "left"
            ]
            (evidence_root / "history-summary.json").write_text(
                json.dumps(
                    {
                        "messageCount": len(history.get("messages", [])),
                        "expectedAssistantTextPresent": any(
                            expected in text for text in restored_texts
                        ),
                    }
                ),
                encoding="utf-8",
            )
            assert any(expected in text for text in restored_texts), (
                "Completed assistant response was lost"
            )
            await expect(page.get_by_text(expected, exact=False).first).to_be_visible(
                timeout=20000
            )
            await page.get_by_role(
                "tab", name=conversation["rightPanel"]["tabs"]["browser"], exact=True
            ).click()
            panel = page.get_by_test_id("browser-session-panel")
            await panel.wait_for(state="visible")
            restored_state = await state()
            assert restored_state["browserSessionId"] == after["browserSessionId"]
            assert restored_state["profileId"] == after["profileId"]
            await page.screenshot(
                path=str(evidence_root / "ui-handoff-conversation.png")
            )
            await viewer.screenshot(path=str(evidence_root / "ui-handoff-viewer.png"))
            assert not errors, errors
            evidence = {
                "workflow": "actual-webui-real-model-browser-handoff",
                "sessionId": sid,
                "browserSessionId": after["browserSessionId"],
                "profileId": after["profileId"],
                "receipts": receipts,
                "mainPanelAndViewerShareBrowser": True,
                "heldAgentWriteRejected": not args.manual_human,
                "externalHumanViewer": args.manual_human,
                "visibleOneTimeApprovals": approvals,
                "automaticReturnNotification": not args.manual_continuation,
                "historyRestoredAfterReload": True,
                "headfulWindowSurface": args.headful,
                "realProvider": "SudoRouter",
                "model": config.get("model"),
                "usage": stream_summary(messages),
                "pageErrors": errors,
            }
            (evidence_root / "ui-handoff-evidence.json").write_text(
                json.dumps(evidence, indent=2)
            )
            (evidence_root / "stream-summary.json").write_text(
                json.dumps(stream_summary(messages), indent=2), encoding="utf-8"
            )
            print(json.dumps(evidence))
    except BaseException:
        (evidence_root / "ui-handoff-failure.json").write_text(
            json.dumps({"receipts": receipts, "expected": expected})
        )
        # Preserve the actual UI at the failing step, before owned Chrome closes.
        try:
            # The original Playwright context has already exited on exception.
            async with async_playwright() as capture:
                failed_browser = await capture.chromium.connect_over_cdp(
                    f"http://127.0.0.1:{own['port']}", timeout=5000
                )
                for index, surface in enumerate(failed_browser.contexts[0].pages):
                    if surface.url.startswith(config["origin"]) and (
                        sid in surface.url or "/#/login" in surface.url
                    ):
                        await surface.screenshot(
                            path=str(evidence_root / f"ui-handoff-failure-{index}.png"),
                            timeout=5000,
                        )
        except (PlaywrightError, OSError) as error:
            print(f"Failure screenshot unavailable: {type(error).__name__}")
        (evidence_root / "stream-summary.json").write_text(
            json.dumps(stream_summary(locals().get("messages", [])), indent=2),
            encoding="utf-8",
        )
        raise
    finally:
        browser_stop(session_id=own["session_id"])
        site.shutdown()
        site.server_close()


def stream_summary(messages):
    """Retain statuses and usage, excluding credentials, page text and pixels."""
    summary = []
    for message in messages:
        if not isinstance(message, str):
            continue
        try:
            value = json.loads(message)
        except ValueError:
            continue
        event = value.get("event", {})
        if value.get("kind") == "upstream" and event.get("type") == "result":
            summary.append(
                {
                    key: event[key]
                    for key in (
                        "type",
                        "subtype",
                        "is_error",
                        "usage",
                        "duration_ms",
                        "total_cost_usd",
                    )
                    if key in event
                }
            )
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--config",
        type=pathlib.Path,
        required=True,
        help="Private JSON: origin, username, password, sessionId, optional model. The session must use a real model account.",
    )
    parser.add_argument(
        "--output",
        type=pathlib.Path,
        required=True,
        help="New evidence directory; existing evidence is preserved.",
    )
    parser.add_argument(
        "--locale", default="zh-CN", help="The current application UI locale."
    )
    parser.add_argument("--fixture-bind", default="127.0.0.1")
    parser.add_argument("--fixture-port", type=int, default=0)
    parser.add_argument(
        "--fixture-origin",
        help="Origin through which a remote worker reaches this fixture.",
    )
    parser.add_argument(
        "--headful",
        action="store_true",
        help="Exercise managed Chrome's native window and shared page surfaces.",
    )
    parser.add_argument(
        "--fixture-host",
        default="127.0.0.1",
        help="Address of this fixture reachable from the managed Chrome worker.",
    )
    parser.add_argument("--turn-timeout", type=int, default=180)
    parser.add_argument(
        "--manual-human",
        action="store_true",
        help="Prepare a real model session and wait for a person in an external viewer, such as iPhone Safari. Use a longer turn timeout while coordinating the person.",
    )
    parser.add_argument(
        "--manual-continuation",
        action="store_true",
        help="Legacy gateway acceptance: explicitly send a chat instruction after return.",
    )
    asyncio.run(main(parser.parse_args()))
