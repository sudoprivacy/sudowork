"""Real model opens a file picker; the user uploads and downloads in WebUI."""

import argparse
import asyncio
import hashlib
import json
import pathlib
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from ai_dev_browser.core.browser import browser_start, browser_stop
from playwright.async_api import async_playwright, expect


async def main(args):
    config = json.loads(args.config.read_text(encoding="utf-8"))
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    source = pathlib.Path(__file__).resolve().parents[4]
    locale = source / "packages/renderer/src/i18n/locales" / args.locale
    login = json.loads((locale / "login.json").read_text(encoding="utf-8"))
    labels = json.loads((locale / "conversation.json").read_text(encoding="utf-8"))
    browser = labels["browserSession"]
    sid = config["sessionId"]
    unique = uuid.uuid4().hex[:12]
    filename = "报告_" + unique + ".txt"
    payload = ("Human-selected browser file " + unique).encode()
    ai_note = "AI_BEFORE_" + unique
    human_note = "HUMAN_" + unique + " 中文"
    download_payload = (
        payload + ("\nBrowser note: " + human_note).encode()
        if args.verify_text_edit
        else payload
    )
    notes = []
    received = []
    visits = []
    ready = "FILE_PICKER_READY_" + unique
    done = "FILE_DOWNLOAD_READY_" + unique

    class Site(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            if self.path == "/favicon.ico":
                self.send_response(204)
                self.end_headers()
                return
            assert self.path in ("/review", "/receipts")
            visits.append({"path": self.path, "cookie": self.headers.get("Cookie", "")})
            self.send_response(200)
            self.send_header("Cache-Control", "no-store")
            if self.path == "/receipts":
                assert received, "Download must follow an actual upload"
                if args.verify_text_edit:
                    assert notes[-1]["text"] == human_note and notes[-1]["trusted"]
                data = received[0]["text"].encode()
                if args.verify_text_edit:
                    data += ("\nBrowser note: " + notes[-1]["text"]).encode()
                self.send_header("Content-Type", "application/octet-stream")
                self.end_headers()
                self.wfile.write(data)
                return
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header(
                "Set-Cookie", f"files_{unique}=present; Path=/; Max-Age=3600"
            )
            self.end_headers()
            note_html = (
                '<input id="browser-note" aria-label="Browser note" style="position:absolute;left:24px;top:240px;margin:0">'
                if args.verify_text_edit
                else ""
            )
            note_script = (
                """const noteField=document.querySelector('#browser-note');
            noteField.oninput=event=>fetch('/note',{method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({text:noteField.value,trusted:event.isTrusted})});"""
                if args.verify_text_edit
                else ""
            )
            self.wfile.write(
                f"""<!doctype html><meta charset="utf-8"><title>Browser files {unique}</title>
            <style>body{{margin:0;font:20px sans-serif}}input,a{{display:block;margin:24px;width:320px;height:48px}}</style>
            <input id="upload" type="file"><a id="download" href="/receipts" download="receipt_{unique}.txt">Download uploaded receipt</a>
            {note_html}<pre id="result">Waiting for user upload</pre><script>{note_script}
            upload.onchange=async event=>{{const file=upload.files[0];const r=await fetch('/submit',{{method:'POST',headers:{{'Content-Type':'application/json'}},
            body:JSON.stringify({{name:file.name,text:await file.text(),trusted:event.isTrusted}})}});
            result.textContent=JSON.stringify(await r.json());}};</script>""".encode()
            )

        def do_POST(self):
            assert self.path in ("/submit", "/note")
            value = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            value["cookie"] = self.headers.get("Cookie", "")
            (notes if self.path == "/note" else received).append(value)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(value).encode())

    site = ThreadingHTTPServer(("127.0.0.1", args.fixture_port), Site)
    threading.Thread(target=site.serve_forever, daemon=True).start()
    url = args.fixture_origin.rstrip("/") + "/review"
    own = browser_start(headless=True, temp=True, reuse="none", silent_stderr=True)
    assert "error" not in own, own
    page = None
    driver = await async_playwright().start()
    messages = []
    approvals = []
    approved_ids = set()
    has_reconnected = False
    try:
        chrome = await driver.chromium.connect_over_cdp(
            f"http://127.0.0.1:{own['port']}"
        )
        page = chrome.contexts[0].pages[0]
        await page.set_viewport_size({"width": 1365, "height": 900})
        errors = []
        transfers = []

        async def record_transfer(response):
            if f"/api/conversations/{sid}/browser/files/" not in response.url:
                return
            code = None
            if response.status >= 400:
                try:
                    code = (await response.json()).get("error")
                except ValueError:
                    pass
            transfers.append(
                {
                    "status": response.status,
                    "error": code,
                    "contentType": response.request.headers.get("content-type"),
                }
            )

        def observe_page(candidate, *, is_stream_source=True):
            candidate.on("response", record_transfer)
            candidate.on("pageerror", lambda error: errors.append(str(error)))
            if is_stream_source:
                candidate.on(
                    "websocket",
                    lambda socket: socket.on(
                        "framereceived", lambda frame: messages.append(frame)
                    ),
                )

        observe_page(page)
        await page.goto(config["origin"] + "/#/login")
        await page.get_by_text(login["passwordTab"], exact=True).click()
        await page.get_by_placeholder(login["pwdAccountPlaceholder"], exact=True).fill(
            config["username"]
        )
        await page.locator('input[type="password"]').fill(config["password"])
        await page.get_by_role("button", name=login["pwdLoginTab"], exact=True).click()
        await page.wait_for_url(lambda value: "/login" not in value, timeout=20000)
        await page.goto(config["origin"] + "/#/conversation/" + sid)
        await page.locator("textarea").first.wait_for(state="visible", timeout=30000)
        await page.get_by_role(
            "tab", name=labels["rightPanel"]["tabs"]["browser"], exact=True
        ).click()
        panel = page.get_by_test_id("browser-session-panel")
        await panel.wait_for(state="visible")

        async def state():
            response = await page.request.post(
                config["origin"] + f"/api/conversations/{sid}/browser",
                headers={"Origin": config["origin"]},
                data={"kind": "state"},
            )
            assert response.status == 200, await response.text()
            return (await response.json())["session"]

        async def wait_state(predicate):
            deadline = time.monotonic() + args.turn_timeout
            while True:
                current = await state()
                if predicate(current):
                    return current
                assert time.monotonic() < deadline, current
                await asyncio.sleep(0.25)

        async def wait_turn(start, marker):
            nonlocal panel, has_reconnected
            deadline = time.monotonic() + args.turn_timeout
            while time.monotonic() < deadline:
                text = ""
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
                        if request_id in approved_ids:
                            continue
                        if (
                            args.reconnect_approval
                            and marker == done
                            and not has_reconnected
                        ):
                            await page.reload()
                            # A pending permission replaces the composer.
                            await page.get_by_role(
                                "tab",
                                name=labels["rightPanel"]["tabs"]["browser"],
                                exact=True,
                            ).wait_for(state="visible", timeout=30000)
                            await page.get_by_role(
                                "tab",
                                name=labels["rightPanel"]["tabs"]["browser"],
                                exact=True,
                            ).click()
                            panel = page.get_by_test_id("browser-session-panel")
                            has_reconnected = True
                            print(
                                "Reloaded the real chat while its single-use browser approval was pending",
                                flush=True,
                            )
                            break
                        request = event.get("request", {})
                        tool = request.get("tool_name") or request.get(
                            "toolCall", {}
                        ).get("title", "")
                        raw_input = (
                            request.get("rawInput") or request.get("input") or {}
                        )
                        if isinstance(raw_input, str):
                            raw_input = json.loads(raw_input)
                        source = "permission"
                        if not tool:
                            # Older scode omits the optional ACP title. Require
                            # this turn's preceding tool event and identical
                            # arguments before clicking its visible permission.
                            assert last_tool and last_tool[1] == raw_input, (
                                "An untitled permission must match the current tool"
                            )
                            tool = last_tool[0]
                            source = "matching-tool-event"
                        assert tool.startswith("mcp__sudowork-browser__") or (
                            tool == "ToolSearch"
                            and "sudowork-browser" in json.dumps(raw_input)
                        ), f"Unexpected permission in browser-only acceptance: {tool}"
                        options = request.get("options") or [
                            {"name": "Allow", "optionId": "allow_once"}
                        ]
                        once = next(
                            (
                                option
                                for option in options
                                if isinstance(option, dict)
                                and option.get("optionId")
                                in ("allow_once", "proceed_once")
                            ),
                            None,
                        )
                        assert once is not None, (
                            "A normal one-time approval is required"
                        )
                        title = (
                            request.get("title")
                            or request.get("tool_name")
                            or "Permission Required"
                        )
                        card = page.get_by_text(title, exact=True).locator(
                            "xpath=ancestor::div[contains(@class,'max-w-800px')][1]"
                        )
                        # The option also contains its keyboard shortcut.
                        await card.get_by_text(once["name"], exact=False).click(
                            timeout=10000
                        )
                        approved_ids.add(request_id)
                        approvals.append(
                            {"tool": tool, "requestId": request_id, "source": source}
                        )
                        print(
                            f"Approved the visible one-time {tool} request", flush=True
                        )
                    if event.get("type") == "assistant":
                        content = event.get("message", {}).get("content", [])
                        if isinstance(content, str):
                            text += content
                        elif isinstance(content, list):
                            text += "".join(
                                block.get("text", "")
                                for block in content
                                if isinstance(block, dict)
                                and block.get("type") == "text"
                            )
                    elif event.get("type") == "stream_event":
                        delta = event.get("event", {}).get("delta", {})
                        if delta.get("type") == "text_delta":
                            text += delta.get("text", "")
                    if event.get("type") == "result" and marker in text:
                        assert not event.get("is_error"), event
                        return text
                await asyncio.sleep(0.25)
            raise AssertionError("Real AI did not complete the current file journey")

        initial = await wait_state(lambda value: value["state"] != "pausing")
        if args.stop_existing:
            profile = initial["profileId"]
            assert not initial["isHumanControlHeld"] or initial["isController"], (
                "The fixture belongs to another controller; do not take its lease"
            )
            if initial["error"] == "browser_restart_requires_observation":
                if initial["state"] == "stopped":
                    await panel.get_by_role(
                        "button", name=browser["start"], exact=True
                    ).click()
                    initial = await wait_state(
                        lambda value: (
                            value["state"] == "human" and value["isController"]
                        )
                    )
                assert initial["state"] == "human" and initial["isController"]
                assert initial["profileId"] == profile
                # Recovery retains its observation warning until explicit
                # Return; starting Chrome does not restore AI admission.
                assert initial["error"] in (
                    None,
                    "browser_restart_requires_observation",
                )
            else:
                assert initial["error"] is None
            if initial["state"] == "ai":
                await panel.get_by_role(
                    "button", name=browser["take"], exact=True
                ).click()
                initial = await wait_state(
                    lambda value: value["state"] == "human" and value["isController"]
                )
            if initial["state"] == "human":
                assert initial["isController"]
                await panel.get_by_role(
                    "button", name=browser["stop"], exact=True
                ).click()
                await (
                    page.locator(".arco-modal")
                    .get_by_role("button", name=browser["stop"], exact=True)
                    .click()
                )
                initial = await wait_state(
                    lambda value: value["state"] == "stopped" and value["isController"]
                )
            assert initial["state"] == "stopped" and initial["profileId"] == profile
        if args.stop_existing and initial["isHumanControlHeld"]:
            cleanup_marker = "BROWSER_STOPPED_" + unique
            await panel.get_by_label(browser["note"], exact=True).fill(
                "The preceding fixture has finished. Keep this browser stopped and reply exactly "
                + cleanup_marker
                + ". Do not perform other tasks."
            )
            cleanup_start = len(messages)
            await panel.get_by_role(
                "button", name=browser["return"], exact=True
            ).click()
            await wait_turn(cleanup_start, cleanup_marker)
            await expect(
                page.get_by_text(labels["chat"]["processing"], exact=True)
            ).to_be_hidden(timeout=10000)
            initial = await state()
        assert initial["state"] == "stopped" and initial["capabilities"]["fileTransfer"]
        assert not initial["isHumanControlHeld"], (
            "Release the owned fixture's previous human lease before running this journey"
        )
        assert initial["error"] is None, (
            "Recover the stopped fixture through human Start/Stop/Return before running this journey"
        )
        start = len(messages)
        editor = page.locator("textarea").first
        await page.bring_to_front()
        preparation = (
            f" First enter {ai_note} in Browser note using trusted browser_action input before opening the file chooser."
            if args.verify_text_edit
            else ""
        )
        await editor.fill(
            f"File handoff acceptance {unique}. Use only sudowork-browser MCP tools. Launch a headful managed extension browser, navigate to {url}, observe the page.{preparation} Click the native Upload file input using browser_action input, not JavaScript click. Do not upload or download anything yet. Once fileChooser appears, finish this turn by replying exactly {ready}. The user will supply a local file through the shared viewer."
        )
        await editor.press("Enter")
        print("Waiting for the real AI to open the native file picker", flush=True)
        await wait_turn(start, ready)
        await expect(
            page.get_by_text(labels["chat"]["processing"], exact=True)
        ).to_be_hidden(timeout=10000)
        loaded = await wait_state(lambda value: value["fileChooser"] is not None)
        assert (
            loaded["profileId"] == initial["profileId"]
            and loaded["transport"] == "extension"
            and not loaded["isHeadless"]
        )
        await panel.get_by_role("button", name=browser["take"], exact=True).click()
        held = await wait_state(
            lambda value: value["state"] == "human" and value["isController"]
        )
        assert held["browserSessionId"] == loaded["browserSessionId"]
        await expect(panel.get_by_test_id("browser-file-chooser")).to_be_visible()
        await page.screenshot(path=str(output / "file-chooser.png"))
        async with page.expect_file_chooser() as chooser_event:
            await panel.get_by_role(
                "button", name=browser["chooseFiles"], exact=True
            ).click()
        chooser = await chooser_event.value
        await chooser.set_files(
            {"name": filename, "mimeType": "text/plain", "buffer": payload}
        )
        deadline = time.monotonic() + 30
        while not received:
            assert time.monotonic() < deadline, (
                f"The real website did not receive the selected file; transfers={transfers}"
            )
            await asyncio.sleep(0.1)
        assert (
            len(received) == 1
            and received[0]["name"] == filename
            and received[0]["text"] == payload.decode()
            and received[0]["trusted"]
        )
        assert f"files_{unique}=present" in received[0]["cookie"]
        print(
            "WebUI native file selection reached the real website with exact bytes",
            flush=True,
        )
        after_upload = await wait_state(lambda value: value["fileChooser"] is None)
        assert after_upload["browserSessionId"] == loaded["browserSessionId"]
        if args.verify_text_edit:
            assert any(note["text"] == ai_note and note["trusted"] for note in notes), (
                "The actual AI did not prefill Browser note"
            )
            await panel.get_by_label(browser["viewMode"], exact=True).click()
            await page.get_by_text(browser["pageView"], exact=True).last.click()
            frame = panel.get_by_role("img", name=browser["page"], exact=True)
            await expect(frame).to_be_visible()
            await page.wait_for_function(
                "()=>{const e=document.querySelector('[data-testid=browser-session-panel] img');return e?.naturalWidth>0&&e.naturalHeight>0&&e.naturalHeight<900}"
            )
            dimensions = await frame.evaluate(
                "e=>({width:e.naturalWidth,height:e.naturalHeight})"
            )
            box = await frame.bounding_box()
            assert box and dimensions["width"] and dimensions["height"]
            await frame.click(
                position={
                    "x": 140 * box["width"] / dimensions["width"],
                    "y": 264 * box["height"] / dimensions["height"],
                }
            )
            await frame.press("Control+a")
            await panel.get_by_label(browser["text"], exact=True).fill(human_note)
            await panel.get_by_role(
                "button", name=browser["insert"], exact=True
            ).click()
            deadline = time.monotonic() + 20
            while not notes or notes[-1]["text"] != human_note:
                assert time.monotonic() < deadline, (
                    "Select-all and Unicode insertion did not replace the actual AI value"
                )
                await asyncio.sleep(0.1)
            assert notes[-1]["trusted"]
            await page.screenshot(path=str(output / "text-edit.png"))
            print(
                "PageSurface Ctrl+A replaced the AI value with exact trusted Unicode input",
                flush=True,
            )
        # Missing authentication and a changed control epoch must not stage bytes.
        upload_path = (
            config["origin"] + f"/api/conversations/{sid}/browser/files/upload"
        )
        headers = {
            "Origin": config["origin"],
            "Content-Type": "application/octet-stream",
            "X-Browser-File-Name": "stale.txt",
            "X-Browser-Control-Epoch": str(loaded["controlEpoch"]),
            "X-Browser-Target-Epoch": str(loaded["targetEpoch"]),
        }
        stale = await page.request.post(upload_path, headers=headers, data=b"stale")
        assert stale.status == 409, await stale.text()
        anonymous = await driver.request.new_context()
        try:
            unauthenticated = await anonymous.post(
                upload_path, headers=headers, data=b"unauthenticated"
            )
            assert unauthenticated.status == 401
        finally:
            await anonymous.dispose()
        start = len(messages)
        return_panel = panel
        if args.viewer_return:
            async with chrome.contexts[0].expect_page() as popup:
                await panel.get_by_role(
                    "button", name=browser["openViewer"], exact=True
                ).click()
            viewer = await popup.value
            await viewer.set_viewport_size({"width": 1365, "height": 900})
            observe_page(viewer)
            return_panel = viewer.get_by_test_id("browser-session-panel")
            await return_panel.wait_for(state="visible")
            assert "/#/browser-viewer/" + sid in viewer.url
            await page.close()
            print(
                "Closed the original chat before returning from the independent viewer",
                flush=True,
            )
        readback = (
            " Also report the exact Browser note value after the completion marker, without changing it."
            if args.verify_text_edit
            else ""
        )
        await return_panel.get_by_label(browser["note"], exact=True).fill(
            f"I uploaded {filename}. Observe the page and verify its receipt contains {unique}. Then click Download uploaded receipt using a trusted browser_action input; freshly observe until the completed download appears. Do not submit again or use shell. Reply with {done}.{readback}"
        )
        await return_panel.get_by_role(
            "button", name=browser["return"], exact=True
        ).click()
        if args.viewer_return:
            page = await chrome.contexts[0].new_page()
            await page.set_viewport_size({"width": 1365, "height": 900})
            # The viewer remains the single model event source. Recording both
            # tabs would duplicate every streamed text delta in the observer.
            observe_page(page, is_stream_source=False)
            await page.goto(config["origin"] + "/#/conversation/" + sid)
            # The replayed permission card can already hide the chat editor.
            await page.get_by_role(
                "tab", name=labels["rightPanel"]["tabs"]["browser"], exact=True
            ).wait_for(state="visible", timeout=30000)
            await page.get_by_role(
                "tab", name=labels["rightPanel"]["tabs"]["browser"], exact=True
            ).click()
            panel = page.get_by_test_id("browser-session-panel")
        print(
            "Waiting for the real AI to observe the upload and download its receipt",
            flush=True,
        )
        completion_text = await wait_turn(start, done)
        if args.verify_text_edit:
            assert human_note in completion_text, (
                "The actual AI did not read back the human-edited note"
            )
        if args.reconnect_approval:
            assert has_reconnected, (
                "No actual pending permission was available to exercise reconnect"
            )
        await expect(
            page.get_by_text(labels["chat"]["processing"], exact=True)
        ).to_be_hidden(timeout=10000)
        downloaded = await wait_state(
            lambda value: any(
                file["name"] == f"receipt_{unique}.txt"
                for file in value.get("downloads", [])
            )
        )
        file = next(
            file
            for file in downloaded["downloads"]
            if file["name"] == f"receipt_{unique}.txt"
        )
        assert (
            file["bytes"] == len(download_payload)
            and file["sha256"] == hashlib.sha256(download_payload).hexdigest()
        )
        await expect(panel.get_by_test_id("browser-downloads")).to_be_visible()
        async with page.expect_download() as download_event:
            await panel.get_by_role(
                "button",
                name=browser["downloadFile"].replace("{{name}}", file["name"]),
                exact=True,
            ).click()
        result = await download_event.value
        await result.save_as(output / result.suggested_filename)
        assert (output / file["name"]).read_bytes() == download_payload
        await page.screenshot(path=str(output / "file-download.png"))
        assert (
            downloaded["profileId"] == loaded["profileId"]
            and downloaded["browserSessionId"] == loaded["browserSessionId"]
        )
        assert len(received) == 1 and not errors
        (output / "file-transfer-evidence.json").write_text(
            json.dumps(
                {
                    "sessionId": sid,
                    "modelReady": ready,
                    "modelCompleted": done,
                    "profileId": loaded["profileId"],
                    "browserSessionId": loaded["browserSessionId"],
                    "upload": received[0],
                    "download": file,
                    "textEdit": {
                        "aiValue": ai_note,
                        "humanValue": human_note,
                        "trusted": notes[-1]["trusted"],
                        "modelReadback": True,
                    }
                    if args.verify_text_edit
                    else None,
                    "staleUploadStatus": stale.status,
                    "anonymousUploadStatus": unauthenticated.status,
                    "pageErrors": errors,
                    "visibleOneTimeApprovals": approvals,
                    "returnFromIndependentViewer": args.viewer_return,
                    "pendingApprovalRecoveredAfterReload": has_reconnected,
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        print(
            "Real WebUI model, native file picker, authenticated upload and download passed",
            flush=True,
        )
    finally:
        if (
            page
            and page.is_closed() is False
            and not (output / "file-transfer-evidence.json").exists()
        ):
            await page.screenshot(path=str(output / "failure.png"))
        summary = []
        for raw in messages:
            if not isinstance(raw, str):
                continue
            try:
                value = json.loads(raw)
            except ValueError:
                continue
            summary.append(
                {
                    "kind": value.get("kind"),
                    "type": value.get("event", {}).get("type"),
                    "error": value.get("event", {}).get("is_error"),
                }
            )
        (output / "stream-summary.json").write_text(
            json.dumps(summary, indent=2), encoding="utf-8"
        )
        (output / "transfer-summary.json").write_text(
            json.dumps(transfers, indent=2), encoding="utf-8"
        )
        (output / "fixture-summary.json").write_text(
            json.dumps({"notes": notes, "uploads": received}, indent=2),
            encoding="utf-8",
        )
        await driver.stop()
        await asyncio.to_thread(browser_stop, session_id=own["session_id"])
        site.shutdown()
        site.server_close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=pathlib.Path, required=True)
    parser.add_argument("--output", type=pathlib.Path, required=True)
    parser.add_argument("--locale", default="zh-CN")
    parser.add_argument("--fixture-origin", required=True)
    parser.add_argument("--fixture-port", type=int, default=50181)
    parser.add_argument("--turn-timeout", type=int, default=240)
    parser.add_argument(
        "--stop-existing",
        action="store_true",
        help="Stop the owned completed browser through actual UI controls before the journey",
    )
    parser.add_argument(
        "--verify-text-edit",
        action="store_true",
        help="Replace a real AI-prefilled field through PageSurface Ctrl+A, then require model readback and matching download bytes",
    )
    parser.add_argument(
        "--viewer-return",
        action="store_true",
        help="Close the original chat and return from the independent viewer",
    )
    parser.add_argument(
        "--reconnect-approval",
        action="store_true",
        help="Reload the real chat while its return-turn permission is pending",
    )
    asyncio.run(main(parser.parse_args()))
