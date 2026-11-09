"""Exercise one real cloud conversation through WebUI and a dedicated Desktop."""

import argparse
import asyncio
import hashlib
import json
from pathlib import Path
import re
import sys
import time
from urllib.parse import parse_qs, quote, urlparse
from uuid import uuid4

from ai_dev_browser.core.browser import browser_start, browser_stop
from fixture_workspace import is_fixture_request, tool_arguments, workspace_from_result
from live_browser_ui import continue_from_conversation, direct_browser_arguments, read_conversation_event
from playwright.async_api import async_playwright, expect
from workspace_requests import trace_workspace_requests, workspace_request_summary


def tool_message_ids(messages):
    return {message["id"] for message in messages
            if message["type"] in ("tool_call", "tool_group", "acp_tool_call", "codex_tool_call")}


async def login(page, url, labels, credentials):
    is_web = urlparse(url).scheme == "https"
    assert is_web or urlparse(url).scheme == "file", "Require public WebUI or the published Desktop"
    await page.goto(url, wait_until="domcontentloaded")
    if credentials.get("apiKey"):
        await page.get_by_text(labels["apiKeyTab"], exact=True).click()
        await page.get_by_placeholder(labels["apiKeyPlaceholder"], exact=True).fill(credentials["apiKey"])
    else:
        await page.get_by_text(labels["passwordTab"], exact=True).click()
        await page.get_by_placeholder(labels["pwdAccountPlaceholder"], exact=True).fill(credentials["username"])
        await page.get_by_placeholder(labels["pwdPasswordPlaceholder"], exact=True).fill(credentials["password"])
    endpoint = "/api/auth/login/" + ("api-key" if credentials.get("apiKey") else "password")
    if is_web:
        async with page.expect_response(
            lambda response: response.request.method == "POST"
            and urlparse(response.url).netloc == urlparse(url).netloc
            and urlparse(response.url).path == endpoint,
            timeout=30_000,
        ) as authentication:
            await page.get_by_role("button", name=labels["pwdLoginTab"], exact=True).click()
        response = await authentication.value
        assert response.status == 200, f"WebUI login refused {endpoint}: HTTP {response.status}"
    else:
        # The published Desktop authenticates through its native IPC bridge.
        await page.get_by_role("button", name=labels["pwdLoginTab"], exact=True).click()
    await page.wait_for_url(
        lambda value: "/login" not in value, wait_until="domcontentloaded", timeout=30_000,
    )


async def api(page, path, method="GET", data=None, params=None):
    """Use the viewer's actual HTTPS transport and authenticated cookies."""
    assert path.startswith("/api/conversations")
    return await page.evaluate(
        """async ({path, method, data, params}) => {
            const url = new URL(path, location.origin);
            const started = performance.now();
            if (url.origin !== location.origin) throw Error('Fixture request changed origin');
            for (const [name, value] of Object.entries(params || {})) url.searchParams.set(name, value);
            let response, text;
            try {
                response = await fetch(url, {
                    method, credentials: 'same-origin', redirect: 'error',
                    signal: AbortSignal.timeout(30000),
                    ...(data === null ? {} : {headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)}),
                });
                text = await response.text();
            } catch (error) {
                const elapsedMs = Math.round(performance.now() - started);
                throw Error(`${method} ${url.pathname}: ${error.name}: ${error.message}; elapsedMs=${elapsedMs}`);
            }
            let body = null;
            try { body = JSON.parse(text); } catch {}
            return {status: response.status, body, elapsedMs: performance.now() - started};
        }""",
        {"path": path, "method": method, "data": data, "params": params},
    )


async def displayed_reply(page, required, timeout=30):
    """Read assistant text through the real shared-renderer message surface."""
    rows = page.locator("[data-message-id].text.justify-start")
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        for row in await rows.all():
            # Playwright follows the markdown renderer's open shadow roots.
            text = "\n".join(await row.locator("p, pre").all_text_contents())
            if all(value in text for value in required):
                await row.scroll_into_view_if_needed()
                await expect(row).to_be_visible()
                return await row.get_attribute("data-message-id")
        await asyncio.sleep(0.1)
    raise AssertionError("The assistant message was not restored in the actual UI")


async def approve_fixture_request(page, event, fixture, nonce, evidence, phase, locale):
    """Answer the real permission card once, for this exact fixture operation."""
    request = event["request"]
    tool = request.get("tool_name", "")
    arguments = tool_arguments(request.get("rawInput") or request.get("input") or {})
    safe = is_fixture_request(tool, arguments, phase, fixture, nonce, evidence.get("workspaceRootFromTool"))
    pending = {"phase": phase, "requestId": event["request_id"], "toolName": tool,
               "inputKeys": sorted(arguments), "fixtureScopeVerified": bool(safe),
               "requestedPath": arguments.get("path"), "expectedPath": fixture,
               "contentMatchesNonce": arguments.get("content", "").strip() == nonce,
               "contentLength": len(arguments.get("content", "")), "expectedContentLength": len(nonce)}
    evidence.setdefault("permissions", []).append(pending)
    assert safe, "Permission request exceeded the exact temporary file operation"
    options = request.get("options", [
        {"optionId": "allow_once", "name": "Allow", "kind": "allow_once"},
    ])
    choices = [option for option in options if isinstance(option, dict)
               and (option.get("kind") == "allow_once"
                    or option.get("optionId") in ("proceed_once", "allow_once"))]
    assert len(choices) == 1, "Require one explicit single-use approval option"
    choice = choices[0]
    label = choice["name"]
    namespace, _, key = label.partition(".")
    if key and re.fullmatch(r"[A-Za-z0-9_-]+", namespace):
        source = Path(__file__).resolve().parents[4] / "packages/renderer/src/i18n/locales" / locale / (namespace + ".json")
        if source.exists():
            translated = json.loads(source.read_text(encoding="utf8"))
            for part in key.split("."):
                translated = translated.get(part, {}) if isinstance(translated, dict) else {}
            if isinstance(translated, str):
                label = translated
    card = page.get_by_role("region", name=tool, exact=True)
    await expect(card).to_be_visible()
    option = card.get_by_role(
        "button", name=re.compile(r"^(?:Enter|Y|[1-9])\s*" + re.escape(label) + r"$")
    )
    await expect(option).to_have_count(1)
    expected_operation = "pwd -P" if phase == "workspace" else fixture
    assert expected_operation in await card.inner_text(), "The visible permission card belongs to another operation"
    await option.click()
    pending.update(optionId=choice["optionId"], approvedThroughUi=True)


async def web_turn(page, prompt, frames, evidence, phase, fixture, nonce, locale):
    start = len(frames)
    await continue_from_conversation(page, prompt)
    deadline = time.monotonic() + 180
    tools, results = {}, {}
    while time.monotonic() < deadline:
        for raw in frames[start:]:
            start += 1
            event = read_conversation_event(raw, evidence, phase)
            if event is None:
                continue
            if event.get("type") == "tool_use":
                call_id = event.get("tool_use_id") or event.get("uuid")
                assert call_id, "Tool call identity is missing"
                previous = tools.get(call_id, {})
                # Moss publishes the call's terminal status under the same ACP
                # identity. That update keeps the original input and name.
                for field in ("name", "input"):
                    if field in previous and field in event:
                        assert previous[field] == event[field], "Tool call identity changed its " + field
                tools[call_id] = {**previous, **event}
            if event.get("type") == "tool_result":
                call_id = event["tool_use_id"]
                if call_id in results:
                    for field in ("content", "is_error"):
                        assert results[call_id].get(field) == event.get(field), "Tool result changed after completion"
                results[call_id] = event
            if event.get("type") == "control_request":
                await approve_fixture_request(page, event, fixture, nonce, evidence, phase, locale)
            if event.get("type") == "result":
                assert not event.get("is_error")
                assert event.get("subtype") in (None, "success")
                assert event.get("status") in (None, "success")
                return tools, results
        await asyncio.sleep(0.1)
    raise AssertionError("No real model completion within the normal 180s deadline")


async def main(args):
    config = json.loads(args.config.read_text(encoding="utf8"))
    origin = config["origin"].rstrip("/")
    browser_arguments = direct_browser_arguments(origin, config.get("directAddress"))
    assert urlparse(origin).scheme == "https", "Cloud acceptance requires HTTPS"
    desktop = json.loads(args.desktop_proof.read_text(encoding="utf8"))
    assert desktop["githubSha256Verified"] and desktop["productArchiveUnmodified"]
    assert not desktop["testProviderInjected"]
    assert not desktop["e2eModeEnabled"]
    archive = Path(desktop["productArchive"])
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    assert digest == desktop["productArchiveSha256"]
    runtime_proof = json.loads((Path(desktop["profile"]) / "fixture-proof.json").read_text())
    assert Path(runtime_proof["home"]) == Path(desktop["profile"])
    assert Path(runtime_proof["archive"]) == archive
    assert runtime_proof["version"] == desktop["version"]
    locale_root = (Path(__file__).resolve().parents[4]
                   / "packages/renderer/src/i18n/locales" / args.locale)
    labels = json.loads((locale_root / "login.json").read_text(encoding="utf8"))
    preview_labels = json.loads((locale_root / "preview.json").read_text(encoding="utf8"))
    args.output.mkdir(parents=True, exist_ok=False)
    evidence = {"passed": False, "origin": origin, "desktopVersion": desktop["version"],
                "desktopArchiveSha256": digest, "createdSessionIds": [],
                "directAddress": config.get("directAddress")}
    owned = None
    context = None
    control = None
    driver = None
    web = None
    app = None
    created = set()
    responses = []
    frames = []
    workspace_traces = []
    fixture = "qa-cross-client-" + uuid4().hex + ".txt"
    nonce = "CONTEXT_" + uuid4().hex
    marker = "DESKTOP_" + uuid4().hex

    async def checked(response, status, action):
        evidence.setdefault('apiReads', []).append({
            'action': action, 'status': response['status'], 'elapsedMs': response.get('elapsedMs'),
        })
        if response["status"] != status:
            body = response.get("body") or {}
            evidence["rejection"] = {"action": action, "status": response["status"],
                                     "error": body.get("error", body.get("message")) if isinstance(body, dict) else None}
            raise AssertionError(f"Official API refused {action}: HTTP {response['status']}")
        assert response["body"] is not None, "Official API returned an invalid JSON body"
        return response["body"]

    async def observe(response):
        if (response.request.method == "POST"
                and urlparse(response.url).path == "/api/conversations"
                and response.status == 201):
            created.add((await response.json())["id"])

    def socket_open(socket):
        if urlparse(socket.url).path.startswith("/ws/conversations/"):
            evidence.setdefault("chatSockets", []).append(urlparse(socket.url).path)
            socket.on("framereceived", lambda raw: frames.append(raw))

    def observe_workspace_request(request, phase):
        parsed = urlparse(request.url)
        session = evidence.get("sessionId")
        if (session and parsed.netloc == urlparse(origin).netloc
                and parsed.path.startswith("/api/conversations/" + session + "/workspace/")):
            evidence.setdefault("workspaceNetwork", []).append({
                "phase": phase, "path": parsed.path, "method": request.method,
                "timing": request.timing, "failure": request.failure,
            })

    try:
        owned = browser_start(headless=True, temp=True, reuse="none", silent_stderr=True,
                              match_proxy=False, extra_args=browser_arguments)
        assert not owned.get("error"), owned
        driver = await async_playwright().start()
        browser = await driver.chromium.connect_over_cdp("http://127.0.0.1:" + str(owned["port"]))
        context = await browser.new_context(viewport={"width": 1440, "height": 1000}, locale=args.locale)
        web = await context.new_page()
        workspace_traces.append(await trace_workspace_requests(context, web, "browser", evidence, origin))
        web.on("response", lambda response: responses.append(asyncio.create_task(observe(response))))
        web.on("websocket", socket_open)
        await login(web, origin + "/#/login", labels, config)
        control = await context.new_page()
        workspace_traces.append(await trace_workspace_requests(context, control, "control", evidence, origin))
        control.on("requestfinished", lambda request: observe_workspace_request(request, "finished"))
        control.on("requestfailed", lambda request: observe_workspace_request(request, "failed"))
        health = await control.goto(origin + "/health/live", wait_until="domcontentloaded")
        assert health and health.status == 200
        response = await api(
            control, "/api/conversations", method="POST",
            data={"assistantName": "", "enabledSkills": [],
                  **({"modelId": config["modelId"]} if config.get("modelId") else {})},
        )
        session = (await checked(response, 201, "Create isolated conversation"))["id"]
        created.add(session)
        evidence["sessionId"] = session
        target = origin + "/#/conversation/" + session
        await web.goto(target, wait_until="domcontentloaded")
        await expect(web.locator("textarea").first).to_be_visible(timeout=30_000)
        base = "/api/conversations/" + quote(session, safe="") + "/workspace"
        evidence["toolCalls"] = []
        tools, results = await web_turn(
            web, 'Use bash with exactly these JSON arguments: {"command":"pwd -P"}. '
            'Do not modify any files. Report the current workspace.',
            frames, evidence, "workspace", fixture, nonce, args.locale,
        )
        probes = [(key, call) for key, call in tools.items()
                  if call.get("name") == "bash" and tool_arguments(call.get("input")).get("command") == "pwd -P"]
        assert len(tools) == len(probes) == 1, "Require only the real read-only workspace probe"
        probe_id, _ = probes[0]
        evidence["workspaceRootFromTool"] = workspace_from_result(results[probe_id], session)
        evidence["toolCalls"].append({"phase": "workspace", "id": probe_id, "name": "bash"})
        prompts = [
            ("create", "Use write_file with exactly these JSON arguments: "
             + json.dumps({"path": fixture, "content": nonce})
             + ". Keep it for the next turn. Do not modify any other file. Reply with its filename."),
            ("read", f"Use read_file with the relative path {fixture}. Report its filename and exact content. "
             "Keep the file for the next turn. Do not modify any file."),
            ("delete", f"Use bash to run exactly: rm -- {fixture}. Do not modify any other file. "
             "Confirm its filename when complete."),
        ]
        for phase, prompt in prompts:
            tools, results = await web_turn(web, prompt, frames, evidence, phase, fixture, nonce, args.locale)
            relevant = {key: call for key, call in tools.items() if fixture in json.dumps(call.get("input"))}
            assert relevant, "The model completed without the requested real file tool"
            assert all(key in results and results[key].get("is_error") is False for key in relevant)
            if phase == "read":
                assert any(nonce in json.dumps(results[key]) for key in relevant), "The real read did not return the nonce"
                await displayed_reply(web, [fixture, nonce])
            if phase in ("create", "read"):
                preview = await checked(await api(control, base + "/file", params={"path": fixture}),
                                        200, "Read actual workspace bytes after " + phase)
                assert preview["kind"] == "text" and preview["content"].strip() == nonce
            if phase == "read":
                panel = web.locator(".preview-panel")
                if await panel.is_visible():
                    await panel.get_by_title(preview_labels["collapsePanel"], exact=True).click()
                entry = web.locator(".workspace-tree").get_by_text(fixture, exact=True)
                await expect(entry).to_be_visible(timeout=30_000)
                async with web.expect_response(
                    lambda response: response.request.method == "GET"
                    and urlparse(response.url).netloc == urlparse(origin).netloc
                    and urlparse(response.url).path == base + "/file"
                    and parse_qs(urlparse(response.url).query).get("path") == [fixture],
                    timeout=30_000,
                ) as preview_response:
                    await entry.click()
                response = await preview_response.value
                try:
                    preview_body = await response.json()
                except ValueError:
                    preview_body = None
                body = await checked({"status": response.status, "body": preview_body},
                                     200, "Read actual file through workspace preview UI")
                assert body["kind"] == "text" and body["content"].strip() == nonce
                await expect(panel).to_be_visible(timeout=30_000)
                await expect(panel).to_contain_text(fixture)
                await expect(panel.locator("code")).to_have_text(nonce, timeout=30_000)
                evidence["workspacePreview"] = {"path": fixture, "clickedThroughUi": True,
                                                "httpStatus": response.status, "contentVerified": True}
                await web.screenshot(path=str(args.output / "browser-file-preview.png"))
                await panel.get_by_title(preview_labels["collapsePanel"], exact=True).click()
                await expect(panel).not_to_be_visible()
            if phase == "delete":
                await expect(web.locator(".workspace-tree")).to_be_visible(timeout=30_000)
                await expect(web.locator(".workspace-tree").get_by_text(fixture, exact=True)).to_have_count(0, timeout=30_000)
            evidence["toolCalls"].extend({"phase": phase, "id": key, "name": call.get("name")}
                                         for key, call in relevant.items())
        tree = await checked(await api(control, base + "/tree"), 200, "Read fixture workspace")
        assert tree["isDir"] and tree["relativePath"] == "" and fixture not in json.dumps(tree)
        missing = await api(control, base + "/file", params={"path": fixture})
        assert missing["status"] == 404, "The temporary file remains in the actual workspace"
        history_url = "/api/conversations/" + quote(session, safe="") + "/context"
        history = await checked(await api(control, history_url), 200, "Read durable tool history")
        previous_tools = tool_message_ids(history["messages"])
        assert previous_tools, "The completed file tools were not persisted"
        await web.screenshot(path=str(args.output / "browser-tools.png"))

        app_browser = await driver.chromium.connect_over_cdp("http://127.0.0.1:" + str(desktop["port"]))
        app_pages = [page for browser_context in app_browser.contexts for page in browser_context.pages
                     if urlparse(page.url).scheme == "file" and "index.html" in page.url]
        assert len(app_pages) == 1, "Require exactly the dedicated Desktop renderer"
        app = app_pages[0]
        focus = await app.context.new_cdp_session(app)
        await focus.send("Emulation.setFocusEmulationEnabled", {"enabled": True})
        app_root = app.url.split("#", 1)[0]
        if "/login" in app.url:
            await login(app, app_root + "#/login", labels, config)
        await app.goto(app_root + "#/conversation/" + session, wait_until="domcontentloaded")
        await displayed_reply(app, [fixture, nonce])
        await expect(app.locator("textarea").first).to_be_enabled(timeout=30_000)
        # Neither unpredictable value is in the Desktop prompt. Visible history
        # alone cannot make the engine pass this restored-context assertion.
        await continue_from_conversation(
            app, "Use only this conversation's context; do not use tools. What temporary "
            "filename and exact content did you just create, read and delete? "
            "Include both, then append this marker: " + marker, is_foreground=False,
        )
        evidence["desktopReplyId"] = await displayed_reply(app, [fixture, nonce, marker], timeout=180)
        assert app.url == app_root + "#/conversation/" + session
        await expect(app.locator("textarea").first).to_be_enabled(timeout=180_000)
        await app.screenshot(path=str(args.output / "desktop-recall.png"))
        await web.reload(wait_until="domcontentloaded")
        evidence["reloadedReplyId"] = await displayed_reply(web, [fixture, nonce, marker])
        assert evidence["reloadedReplyId"] == evidence["desktopReplyId"]
        restored = await checked(await api(control, history_url), 200, "Read restored durable history")
        assert tool_message_ids(restored["messages"]) == previous_tools, "Desktop used tools instead of context"
        assert web.url == target
        assert set(evidence["chatSockets"]) == {"/ws/conversations/" + session}
        assert created == {session}, "A client silently replaced the persistent conversation"
        assert hashlib.sha256(archive.read_bytes()).hexdigest() == digest
        await web.screenshot(path=str(args.output / "browser-restored-desktop.png"))
        evidence["interactionPassed"] = True
    except BaseException as error:
        evidence["failure"] = type(error).__name__ + ": " + str(error).split("\nCall log:", 1)[0]
        for label, page in (("browser", web), ("desktop", app)):
            if (page and not page.is_closed() and evidence.get("sessionId")
                    and urlparse(page.url).fragment == "/conversation/" + evidence["sessionId"]):
                try:
                    await page.screenshot(path=str(args.output / (label + "-failure.png")))
                except Exception as screenshot_error:
                    evidence.setdefault("screenshotFailures", {})[label] = type(screenshot_error).__name__
        raise
    finally:
        cleanup_error = None

        def record_cleanup_failure(action, error):
            nonlocal cleanup_error
            cleanup_error = cleanup_error or error
            evidence.setdefault("cleanupFailures", []).append(
                {"action": action, "error": type(error).__name__ + ": " + str(error)}
            )

        async def cleanup(action, operation):
            try:
                return await operation
            except BaseException as error:
                record_cleanup_failure(action, error)

        if app and not app.is_closed():
            await cleanup("Close Desktop renderer", app.close())
        if context:
            for page in context.pages:
                if page != control:
                    await cleanup("Close WebUI renderer", page.close())
            if responses:
                observations = await cleanup("Observe created sessions", asyncio.gather(*responses, return_exceptions=True))
                for observation in observations or []:
                    if isinstance(observation, BaseException):
                        record_cleanup_failure("Observe created session", observation)
            evidence["createdSessionIds"] = sorted(created)
            evidence["terminatedSessionIds"] = []
            for session in sorted(created):
                try:
                    response = await api(
                        control, "/api/conversations/" + quote(session, safe="") + "/terminate",
                        method="POST", data={},
                    )
                    await checked(response, 200, "Terminate owned fixture")
                    evidence["terminatedSessionIds"].append(session)
                except BaseException as error:
                    record_cleanup_failure("Terminate owned fixture " + session, error)
            await cleanup("Close browser context", context.close())
        if driver:
            await cleanup("Detach Playwright", driver.stop())
        if owned and owned.get("session_id"):
            try:
                evidence["browserCleanup"] = browser_stop(session_id=owned["session_id"])
            except BaseException as error:
                record_cleanup_failure("Stop owned browser", error)
        directory_reads = workspace_request_summary(evidence.get("workspaceRequests", []))
        evidence["directoryReadConcurrency"] = directory_reads
        workspace_queue_error = None
        if evidence.get("interactionPassed") and not cleanup_error:
            try:
                assert directory_reads["requestsByPage"].get("browser", 0) > 0, "The real workspace UI did not read its directory"
                assert directory_reads["requestsByPage"].get("control", 0) > 0, "The independent directory read was not observed"
                assert directory_reads["maxPendingByPage"]["browser"] <= 1, "The workspace UI queued duplicate root reads"
                assert directory_reads["maxPendingByPage"]["control"] <= 1, "The independent viewer queued duplicate root reads"
                assert directory_reads["maxPending"] <= 2, "Workspace views queued duplicate root reads"
            except AssertionError as error:
                workspace_queue_error = error
                evidence["failure"] = type(error).__name__ + ": " + str(error)
        evidence["passed"] = bool(evidence.get("interactionPassed") and not cleanup_error and not workspace_queue_error
                                  and set(evidence.get("terminatedSessionIds", [])) == created
                                  and evidence.get("browserCleanup", {}).get("stopped"))
        text = json.dumps(evidence, indent=2, ensure_ascii=False)
        for key in ("apiKey", "username", "password"):
            if config.get(key):
                text = text.replace(config[key], "[redacted]")
        (args.output / "evidence.json").write_text(text, encoding="utf8")
        print(text, flush=True)
        if cleanup_error:
            raise cleanup_error
        if workspace_queue_error:
            raise workspace_queue_error


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf8")
    sys.stderr.reconfigure(encoding="utf8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--desktop-proof", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--locale", default="zh-CN")
    try:
        asyncio.run(main(parser.parse_args()))
    except Exception as error:
        # Playwright's raw call log may include the value sent to a login field.
        # The structured evidence above carries the redacted failure instead.
        print("Cloud session acceptance failed: " + type(error).__name__, flush=True)
        raise SystemExit(1) from None
