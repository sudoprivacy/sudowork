"""Phone-width sign-in, model selection, real first turn and restored history."""

import argparse
import asyncio
import json
import mimetypes
import time
import uuid
from contextlib import AsyncExitStack
from pathlib import Path
from urllib.parse import urlparse

from ai_dev_browser.core.browser import browser_start, browser_stop
from live_browser_ui import open_browser_panel
from playwright.async_api import Error as PlaywrightError
from playwright.async_api import async_playwright, expect


async def wait_for_reply(frames, marker, evidence, timeout, start=0):
    deadline = time.monotonic() + timeout
    text = ""
    for_loop_index = start
    while time.monotonic() < deadline:
        for response in evidence["createdSessions"]:
            assert response["status"] in (200, 201), (
                f"Original session creation failed; no replay: {response}"
            )
        for payload in frames[for_loop_index:]:
            for_loop_index += 1
            if not isinstance(payload, str):
                continue
            try:
                event = json.loads(payload).get("event", {})
            except ValueError:
                continue
            event_type = event.get("type")
            if event_type:
                counts = evidence["upstreamEventCounts"]
                counts[event_type] = counts.get(event_type, 0) + 1
            if event_type == "system" and isinstance(event.get("model"), str):
                evidence["runtimeModels"].append(event["model"])
            if event_type == "assistant":
                content = event.get("message", {}).get("content", [])
                text += (
                    content
                    if isinstance(content, str)
                    else "".join(
                        block.get("text", "")
                        for block in content
                        if isinstance(block, dict)
                    )
                )
            if event_type == "result":
                result = {
                    key: event[key]
                    for key in ("subtype", "status", "is_error", "duration_ms", "usage")
                    if key in event
                }
                evidence.setdefault("results", []).append(result)
                if marker in text or marker in str(event.get("result", "")):
                    assert (
                        not event.get("is_error")
                        and event.get("status") in (None, "success")
                        and event.get("subtype") in (None, "success")
                    ), f"Fresh turn failed: {result}"
                    return
        await asyncio.sleep(0.25)
    raise AssertionError("The real model never completed the fresh dependent turn")


async def main(args):
    config = json.loads(args.config.read_text(encoding="utf-8"))
    origin = config["origin"].rstrip("/")
    assert urlparse(origin).scheme in ("http", "https")
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    locale_root = (
        Path(__file__).resolve().parents[4]
        / "packages/renderer/src/i18n/locales"
        / args.locale
    )
    login = json.loads((locale_root / "login.json").read_text(encoding="utf-8"))
    conversation = json.loads(
        (locale_root / "conversation.json").read_text(encoding="utf-8")
    )
    common = json.loads((locale_root / "common.json").read_text(encoding="utf-8"))
    evidence = {
        "origin": origin,
        "actualPhone": False,
        "clientEngine": "chromium",
        "candidateAssets": args.assets_dir is not None,
        "realApi": True,
        "requestedModel": args.model,
        "viewports": [],
        "createdSessions": [],
        "upstreamEventCounts": {},
        "runtimeModels": [],
        "catalogFaultInjection": args.exercise_model_unavailable,
        "failedRequests": [],
    }
    own = browser_start(headless=True, temp=True, reuse="none", silent_stderr=True)
    assert "error" not in own, "Could not start the isolated inspection browser"
    session_id = None
    page = None
    pending = []
    try:
        async with async_playwright() as driver, AsyncExitStack() as cleanup:
            browser = await driver.chromium.connect_over_cdp(
                f"http://127.0.0.1:{own['port']}"
            )
            device = dict(driver.devices["iPhone 13"])
            device.pop("default_browser_type", None)
            context = await browser.new_context(**device, locale=args.locale)

            async def terminate_owned_session():
                if pending:
                    await asyncio.gather(*pending)
                if session_id:
                    response = await context.request.post(
                        origin + f"/api/conversations/{session_id}/terminate",
                        headers={"Origin": origin},
                        data={},
                    )
                    evidence["cleanupHttpStatus"] = response.status
                    assert response.status == 200, (
                        f"Owned test session cleanup failed with {response.status}; no retry"
                    )
                    evidence["ownedTestSessionTerminated"] = True

            cleanup.push_async_callback(terminate_owned_session)
            if args.assets_dir:
                assets = args.assets_dir.resolve()
                assert (assets / "index.html").is_file()

                async def candidate(route):
                    path = urlparse(route.request.url).path
                    relative = "index.html" if path == "/" else path.lstrip("/")
                    target = (assets / relative).resolve()
                    if (
                        (path == "/" or path.startswith("/assets/"))
                        and target.is_relative_to(assets)
                        and target.is_file()
                    ):
                        await route.fulfill(
                            path=str(target),
                            content_type=mimetypes.guess_type(str(target))[0]
                            or "application/octet-stream",
                        )
                    else:
                        await route.continue_()

                # Only candidate SPA files are replaced. Login, cookies, model
                # preferences, session APIs and WebSockets use the real origin.
                await context.route(origin + "/**", candidate)

            page = await context.new_page()
            pending_requests = set()
            page.on("request", lambda request: pending_requests.add(request))
            page.on(
                "requestfinished", lambda request: pending_requests.discard(request)
            )

            def request_failed(request):
                pending_requests.discard(request)
                evidence["failedRequests"].append(
                    {
                        "path": urlparse(request.url).path,
                        "method": request.method,
                        "resourceType": request.resource_type,
                        "error": request.failure,
                    }
                )

            page.on("requestfailed", request_failed)

            async def capture_failed_view():
                if not evidence.get("passed"):
                    try:
                        await page.screenshot(
                            path=str(output / "failed.png"), full_page=True
                        )
                    except PlaywrightError as screenshot_error:
                        evidence["failureScreenshotError"] = str(screenshot_error)

            cleanup.push_async_callback(capture_failed_view)
            frames = []
            page.on(
                "websocket",
                lambda socket: socket.on(
                    "framereceived", lambda data: frames.append(data)
                ),
            )

            async def created(response):
                nonlocal session_id
                if (
                    response.request.method != "POST"
                    or response.url != origin + "/api/conversations"
                ):
                    return
                value = await response.json()
                if response.status in (200, 201) and value.get("id"):
                    session_id = value["id"]
                body = response.request.post_data_json
                evidence["createdSessions"].append(
                    {
                        "status": response.status,
                        **{
                            key: value[key]
                            for key in ("id", "code", "error", "sessionId")
                            if key in value
                        },
                        "requestedModel": body.get("modelId") or body.get("model"),
                    }
                )

            page.on(
                "response",
                lambda response: pending.append(asyncio.create_task(created(response))),
            )

            is_catalog_fault_active = args.exercise_model_unavailable

            async def empty_catalog(route):
                if not is_catalog_fault_active:
                    await route.continue_()
                    return
                # Only the model list is fault-injected. Authentication, the
                # catalog request, skills and agents still use the real server.
                response = await route.fetch()
                assert response.status == 200, (
                    "The real catalog lookup failed; no replay"
                )
                body = await response.json()
                body["models"] = []
                await route.fulfill(response=response, json=body)

            if args.exercise_model_unavailable:
                await context.route(
                    origin + "/api/conversations/options", empty_catalog
                )
            await page.goto(origin + "/#/login", wait_until="domcontentloaded")
            if config.get("apiKey"):
                await page.get_by_text(login["apiKeyTab"], exact=True).click()
                await page.get_by_placeholder(
                    login["apiKeyPlaceholder"], exact=True
                ).fill(config["apiKey"])
            else:
                await page.get_by_text(login["passwordTab"], exact=True).click()
                await page.get_by_placeholder(
                    login["pwdAccountPlaceholder"], exact=True
                ).fill(config["username"])
                await page.locator('input[type="password"]').fill(config["password"])
            await page.get_by_role(
                "button", name=login["pwdLoginTab"], exact=True
            ).click()
            await page.wait_for_url(lambda url: "/login" not in url, timeout=45000)

            if args.exercise_model_unavailable:
                alert = page.get_by_role("alert").filter(
                    has_text=conversation["welcome"]["modelServiceUnavailable"]
                )
                await expect(alert).to_be_visible(timeout=30000)
                await expect(
                    page.get_by_role(
                        "button",
                        name=conversation["welcome"]["selectModel"],
                        exact=True,
                    )
                ).to_be_disabled()
                draft = "MODEL_CATALOG_DRAFT_" + uuid.uuid4().hex[:12]
                editor = page.locator("textarea").first
                await editor.fill(draft)
                await expect(
                    page.get_by_role("button", name=common["send"], exact=True)
                ).to_be_disabled()
                await editor.press("Enter")
                await expect(editor).to_have_value(draft)
                assert not evidence["createdSessions"], (
                    "An unavailable catalog allowed task creation"
                )
                assert (
                    conversation["welcome"]["modelSwitchNotSupported"]
                    not in await page.locator("body").inner_text()
                )
                assert await page.evaluate(
                    "document.documentElement.scrollWidth <= innerWidth"
                ), "The model-service error widens the phone viewport"
                await alert.scroll_into_view_if_needed()
                await expect(alert).to_be_in_viewport(ratio=1)
                await page.screenshot(
                    path=str(output / "catalog-unavailable-draft.png")
                )
                evidence["unavailableCatalogPreservedDraft"] = True
                # Removing the last route changes Chromium's Fetch/cache mode
                # while the old page still has requests in flight. Keep the
                # interceptor stable and pass subsequent catalog requests on.
                is_catalog_fault_active = False
                await page.reload(wait_until="domcontentloaded")

            options_response = await context.request.get(
                origin + "/api/conversations/options"
            )
            assert options_response.status == 200, (
                f"Model options HTTP{options_response.status}"
            )
            models = (await options_response.json())["models"]
            matching = [model for model in models if model["id"] == args.model]
            if not matching:
                matching = [
                    model for model in models if model.get("name") == args.model
                ]
            assert len(matching) == 1, (
                "Choose one unambiguous available model ID or label"
            )
            target_model = matching[0]
            target_id = target_model["id"]
            target_label = target_model.get("name") or target_id
            assert (
                sum(
                    (model.get("name") or model["id"]) == target_label
                    for model in models
                )
                == 1
            ), "The requested model label is ambiguous in the menu"
            evidence["requestedModelId"] = target_id
            select_model = conversation["welcome"]["selectModel"]
            for width in (320, 375, 390):
                await page.set_viewport_size({"width": width, "height": 740})
                # Enter New task through the actual phone sidebar, including
                # when the current route is already /guid.
                await page.get_by_role(
                    "button", name=common["expandMore"], exact=True
                ).tap()
                await page.get_by_role(
                    "button",
                    name=conversation["welcome"]["newConversation"],
                    exact=True,
                ).tap()
                button = page.get_by_role("button", name=select_model, exact=True)
                await expect(button).to_be_visible(timeout=30000)
                assert await page.evaluate("innerWidth") == width, (
                    "The layout viewport expanded beyond the configured phone width"
                )
                editor = page.locator("textarea").first
                await editor.scroll_into_view_if_needed()
                bounds = await editor.bounding_box()
                assert bounds and bounds["width"] >= width - 80, (
                    f"Composer remains compressed at {width}px: {bounds}"
                )
                assert await editor.evaluate(
                    "element => parseFloat(getComputedStyle(element).fontSize) >= 16"
                ), "Phone task input text is too small"
                await button.scroll_into_view_if_needed()
                await expect(button).to_be_in_viewport(ratio=1)
                bounds = await button.bounding_box()
                assert bounds and bounds["width"] >= 120 and bounds["height"] >= 44, (
                    f"Model label or touch target is clipped: {bounds}"
                )
                assert bounds["x"] >= 0 and bounds["x"] + bounds["width"] <= width + 1
                assert await page.evaluate(
                    "document.documentElement.scrollWidth <= innerWidth"
                )
                if width == 320:
                    alternative = next(
                        model for model in models if model["id"] != target_id
                    )
                    alternative_label = alternative.get("name") or alternative["id"]
                    await button.tap()
                    alternative_option = page.get_by_text(
                        alternative_label, exact=True
                    ).last
                    await alternative_option.tap()
                    await expect(alternative_option).to_be_hidden()
                    await expect(button).to_contain_text(alternative_label)
                    await page.reload(wait_until="domcontentloaded")
                    await expect(button).to_contain_text(
                        alternative_label, timeout=30000
                    )
                    evidence["alternativePreferenceSurvivedReload"] = alternative["id"]
                await button.tap()
                option = page.get_by_text(target_label, exact=True).last
                await expect(option).to_be_visible()
                await option.scroll_into_view_if_needed()
                await expect(option).to_be_in_viewport(ratio=1)
                await option.tap()
                await expect(option).to_be_hidden()
                await expect(button).to_contain_text(target_label)
                await page.screenshot(path=str(output / f"model-selected-{width}.png"))
                evidence["viewports"].append(
                    {
                        "width": width,
                        "composerWidth": (await editor.bounding_box())["width"],
                        "modelButton": bounds,
                        "actualTouchSelection": True,
                    }
                )

            await page.set_viewport_size({"width": 1440, "height": 900})
            await expect(button).to_be_visible()
            bounds = await page.locator("textarea").first.bounding_box()
            assert bounds and bounds["width"] >= 500, (
                f"Desktop composer became compressed: {bounds}"
            )
            assert await page.evaluate(
                "document.documentElement.scrollWidth <= innerWidth"
            )
            await page.screenshot(path=str(output / "desktop-new-task.png"))
            evidence["desktopComposerWidth"] = bounds["width"]
            await page.set_viewport_size({"width": 390, "height": 740})
            await page.reload(wait_until="domcontentloaded")
            await expect(
                page.get_by_role("button", name=select_model, exact=True)
            ).to_contain_text(target_label, timeout=30000)
            evidence["modelPreferenceSurvivedReload"] = True
            marker = "MOBILE_MODEL_" + uuid.uuid4().hex[:12]
            await page.locator("textarea").first.fill(
                "Reply exactly " + marker + ". Do not call any tools."
            )
            await page.get_by_role("button", name=common["send"], exact=True).tap()
            print(
                json.dumps(
                    {
                        "touchSelectionWidths": [320, 375, 390],
                        "desktopChecked": True,
                        "waitingForRealModel": True,
                    }
                ),
                flush=True,
            )
            await wait_for_reply(frames, marker, evidence, args.turn_timeout)
            assert session_id, "The real turn has no session identity"
            assert len(evidence["createdSessions"]) == 1, (
                "One Send must create exactly one session"
            )
            assert evidence["createdSessions"][0]["requestedModel"] == target_id, (
                "Task creation omitted or changed the selected model"
            )
            model_response = await context.request.get(
                origin + f"/api/conversations/{session_id}/model"
            )
            assert model_response.status == 200, (
                f"Session model readback failed with {model_response.status}"
            )
            actual_model = (await model_response.json())["modelId"]
            assert actual_model == target_id, (
                f"Session saved a different model: {actual_model}"
            )
            evidence["sessionModelReadback"] = actual_model
            preference_response = await context.request.get(
                origin + "/api/conversations/user-model"
            )
            assert preference_response.status == 200, (
                f"Model preference HTTP{preference_response.status}"
            )
            preference = (await preference_response.json())["modelId"]
            assert preference == target_id, (
                f"The backend saved a different preference: {preference}"
            )
            evidence["backendModelPreference"] = preference
            evidence["runtimeModelIdentityExposed"] = bool(evidence["runtimeModels"])
            await page.reload(wait_until="domcontentloaded")
            await expect(page.get_by_text(marker, exact=True).first).to_be_visible(
                timeout=45000
            )
            editor = page.locator("textarea").first
            bounds = await editor.bounding_box()
            assert bounds and bounds["width"] >= 300, (
                f"Workspace displaced the phone conversation: {bounds}"
            )
            workspace = page.get_by_role(
                "button", name=conversation["workspace"]["title"], exact=True
            )
            await workspace.tap()
            drawer = page.locator(".arco-drawer:visible").filter(
                has=page.get_by_role(
                    "tab",
                    name=conversation["rightPanel"]["tabs"]["workspace"],
                    exact=True,
                )
            )
            await expect(drawer).to_be_visible()
            bounds = await drawer.bounding_box()
            assert bounds and bounds["width"] >= 380
            await page.get_by_role(
                "tab", name=conversation["rightPanel"]["tabs"]["browser"], exact=True
            ).tap()
            await expect(page.get_by_test_id("browser-session-panel")).to_be_visible()
            await page.screenshot(path=str(output / "phone-browser-drawer.png"))
            close = drawer.locator(".arco-drawer-close-icon")
            bounds = await close.bounding_box()
            assert bounds and bounds["width"] >= 44 and bounds["height"] >= 44
            await close.tap()
            await expect(drawer).to_be_hidden()
            await expect(editor).to_be_visible()
            await open_browser_panel(
                page, conversation["rightPanel"]["tabs"]["browser"]
            )
            await expect(drawer).to_be_visible()
            await close.tap()
            await expect(drawer).to_be_hidden()
            evidence["phoneWorkspaceAndBrowserDrawer"] = True
            followup = "MOBILE_FOLLOWUP_" + uuid.uuid4().hex[:12]
            await editor.fill("Reply exactly " + followup + ". Do not call any tools.")
            send = page.get_by_role("button", name=common["send"], exact=True)
            await expect(send).to_be_in_viewport(ratio=1)
            bounds = await send.bounding_box()
            assert bounds and bounds["width"] >= 44 and bounds["height"] >= 44
            assert bounds["x"] >= 0 and bounds["x"] + bounds["width"] <= 390
            frame_start = len(frames)
            await send.tap()
            await wait_for_reply(
                frames, followup, evidence, args.turn_timeout, frame_start
            )
            await page.reload(wait_until="domcontentloaded")
            await expect(page.get_by_text(followup, exact=True).first).to_be_visible(
                timeout=45000
            )
            assert len(evidence["createdSessions"]) == 1, (
                "Follow-up created a duplicate session"
            )
            evidence["phoneFollowupSendCompleted"] = True
            evidence["freshFollowupMarker"] = followup
            await page.screenshot(path=str(output / "real-model-history-restored.png"))
            evidence.update(
                {
                    "passed": True,
                    "freshAssistantMarker": marker,
                    "realTurnCompleted": True,
                    "historyRestored": True,
                    "conversationUrl": page.url,
                    "sessionId": session_id,
                }
            )
            print(json.dumps(evidence, ensure_ascii=False), flush=True)
    except (
        AssertionError,
        PlaywrightError,
        OSError,
        ValueError,
        KeyError,
        TypeError,
    ) as error:
        evidence["pendingRequestsAtFailure"] = (
            [
                {
                    "path": urlparse(request.url).path,
                    "method": request.method,
                    "resourceType": request.resource_type,
                }
                for request in pending_requests
            ]
            if page is not None
            else []
        )
        safe = str(error)
        for field in ("password", "apiKey", "username"):
            if config.get(field):
                safe = safe.replace(config[field], "[redacted]")
        evidence.update({"passed": False, "failure": safe})
        print(
            json.dumps(
                {"passed": False, "failure": safe, "noAutomaticReplay": True},
                ensure_ascii=False,
            ),
            flush=True,
        )
        raise SystemExit(1)
    finally:
        (output / "acceptance.json").write_text(
            json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        stopped = browser_stop(session_id=own["session_id"])
        assert stopped.get("stopped"), "Owned viewing browser did not stop"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--locale", default="zh-CN")
    parser.add_argument(
        "--assets-dir",
        type=Path,
        help="Candidate compiled SPA; all APIs still use the real origin",
    )
    parser.add_argument("--turn-timeout", type=int, default=210)
    parser.add_argument(
        "--exercise-model-unavailable",
        action="store_true",
        help="Fault-inject an empty model list in the real UI, then remove the fault and complete real model turns",
    )
    asyncio.run(main(parser.parse_args()))
