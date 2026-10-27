"""Measure an actual authenticated remote Chrome window and human input.

The fixture runs locally or behind an authorized tunnel. No browser pixels,
control ownership, Chrome input or WebUI APIs are mocked. Candidate SPA assets
may be served against the real authenticated origin before deployment.
"""

import argparse
import asyncio
from contextlib import AsyncExitStack
import json
import mimetypes
from pathlib import Path
import threading
import time
from urllib.parse import urlparse
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from ai_dev_browser.core.browser import browser_start, browser_stop
from playwright.async_api import async_playwright, expect
from live_browser_permissions import approve_browser_permission, browser_tool_name
from live_browser_ui import (
    interrupt_shared_browser,
    continue_from_conversation,
    open_browser_source,
    read_conversation_event,
    configure_deployment_cookie,
)
from live_browser_clipboard import fixture_html, verify_clipboard
from live_browser_pixels import START_RENDER_SAMPLING


async def main(args):
    config = json.loads(args.config.read_text(encoding="utf-8"))
    origin = config["origin"].rstrip("/")
    args.output.mkdir(parents=True, exist_ok=False)
    locales = (
        Path(__file__).resolve().parents[4]
        / "packages/renderer/src/i18n/locales"
        / args.locale
    )
    login = json.loads((locales / "login.json").read_text(encoding="utf-8"))
    labels = json.loads((locales / "conversation.json").read_text(encoding="utf-8"))[
        "browserSession"
    ]
    nonce = uuid.uuid4().hex[:10]
    expected = "Human login 中文 " + nonce
    is_profile_acceptance = getattr(args, "verify_profile_persistence", False)
    is_mobile_acceptance = getattr(args, "verify_mobile_view", False)
    is_clipboard_acceptance = getattr(args, "verify_selection_clipboard", False)
    is_touch_selection_acceptance = getattr(args, "verify_touch_selection", False)
    is_window_stream_required = getattr(args, "require_window_stream", False)
    assert not is_touch_selection_acceptance or is_mobile_acceptance, (
        "Touch selection requires --verify-mobile-view"
    )
    assert not (is_mobile_acceptance and is_clipboard_acceptance), (
        "Run desktop clipboard and mobile view preflights separately"
    )
    selected_phrase = "Exact WebUI review phrase"
    selection_layouts, clipboard_inputs, clipboard_receipts = [], [], []
    receipts = []
    visits = []
    authenticated_visits = []
    evidence = {
        "origin": origin,
        "headful": True,
        "actualPhone": False,
        "emulatedMobile": is_mobile_acceptance,
        "candidateAssets": bool(args.assets_dir),
        "pixelRateMeaning": "Lower bound of distinct decoded background changes; not a display FPS or graph latency measurement",
        "passed": False,
    }

    async def require_status(response, action, expected_status=200):
        if response.status == expected_status:
            return
        body = await response.text()
        for secret in (config.get("apiKey"), config.get("password")):
            if secret:
                body = body.replace(secret, "[redacted]")
        rejection = {
            "action": action,
            "status": response.status,
            "body": body,
            "noRetry": True,
        }
        evidence.setdefault("rejection", rejection)
        evidence.setdefault("rejections", []).append(rejection)
        raise AssertionError(
            f"{action} returned HTTP {response.status}; original response retained"
        )

    class Site(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_GET(self):
            visits.append(self.path)
            is_signed_in = (
                is_profile_acceptance
                and "fixture_login=" + nonce
                in self.headers.get("Cookie", "").split("; ")
            )
            if is_signed_in:
                authenticated_visits.append(self.path)
            body = (
                """<!doctype html><meta charset="utf-8"><title>Remote login fixture</title>
<style>body{margin:0;font:24px sans-serif}input,button{position:absolute;left:40px;width:360px;height:48px;font:24px sans-serif}input{top:100px}button{top:170px}</style>
<input id="login" aria-label="Login confirmation"><button id="submit">Sign in</button><p id="result">Signed out</p>
<script>let n=0;const ticker=setInterval(()=>{n++;document.body.style.background=`rgb(${n%2?240:20},${n%3?220:30},${n%5?200:40})`},100);
submit.onclick=async e=>{const response=await fetch('/submit',{method:'POST',body:JSON.stringify({value:document.querySelector('#login').value,trusted:e.isTrusted})});
if(response.ok){clearInterval(ticker);document.body.style.background='rgb(0,128,0)';document.querySelector('#result').textContent='Signed in';}};</script>"""
            ).encode()
            if is_mobile_acceptance:
                body = body.replace(b"left:40px", b"left:820px")
            if is_signed_in:
                body = (
                    '<!doctype html><meta charset="utf-8">'
                    "<title>Persisted remote login</title>"
                    "<style>body{background:rgb(120,0,200)}</style>"
                    '<p id="result">Signed in</p><p id="identity">' + expected + "</p>"
                ).encode()
            if (
                is_clipboard_acceptance or is_touch_selection_acceptance
            ) and not is_signed_in:
                body += fixture_html(
                    selected_phrase, left=820 if is_mobile_acceptance else 40
                ).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):
            clipboard_events = {
                "/selection-layout": selection_layouts,
                "/clipboard-input": clipboard_inputs,
                "/clipboard-submit": clipboard_receipts,
            }
            assert self.path == "/submit" or self.path in clipboard_events
            receipt = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            if self.path == "/submit":
                receipt["receivedAt"] = time.monotonic()
                receipts.append(receipt)
            else:
                clipboard_events[self.path].append(receipt)
            self.send_response(200)
            if self.path == "/submit":
                self.send_header(
                    "Set-Cookie",
                    "fixture_login=" + nonce + "; Path=/; Max-Age=3600; SameSite=Lax",
                )
            self.send_header("Content-Length", "2")
            self.end_headers()
            self.wfile.write(b"{}")

    server = ThreadingHTTPServer((args.fixture_bind, args.fixture_port), Site)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    fixture = args.fixture_origin or "http://127.0.0.1:" + str(server.server_port)
    own = browser_start(headless=True, temp=True, reuse="none", silent_stderr=True)
    assert "error" not in own, "The owned viewing Chrome did not start"
    session_id = None
    requests = []
    tasks = []
    model_events = []
    window_streams = []
    page = None
    chat = None
    is_browser_owned = False
    is_termination_attempted = False
    try:
        async with async_playwright() as driver, AsyncExitStack() as cleanup:
            browser = await driver.chromium.connect_over_cdp(
                "http://127.0.0.1:" + str(own["port"])
            )
            context = await browser.new_context(
                viewport=(
                    {"width": 390, "height": 844}
                    if is_mobile_acceptance
                    else {"width": 1440, "height": 1100}
                ),
                locale=args.locale,
                is_mobile=is_mobile_acceptance,
                has_touch=is_mobile_acceptance,
            )
            await configure_deployment_cookie(
                context, origin, config.get("deploymentCookie")
            )
            if config.get("deploymentCookie"):
                health = await context.request.get(origin + "/health/live")
                await require_status(health, "Read isolated deployment health")
                receipt = health.headers.get("x-pc3-browser-canary")
                assert receipt == config["deploymentReceipt"]
                evidence["deploymentCanaryReceipt"] = receipt
            if is_clipboard_acceptance or is_touch_selection_acceptance:
                # This grants permission only to the owned test viewer context.
                # The application still uses the real native clipboard API.
                await context.grant_permissions(
                    ["clipboard-read", "clipboard-write"], origin=origin
                )

            async def terminate_owned_session():
                nonlocal is_termination_attempted
                if session_id and not is_termination_attempted:
                    is_termination_attempted = True
                    # Real UI metadata reads can overlap an explicit terminate.
                    # A successful HTTP response alone must not hide recovery
                    # that resurrects the old execution and retains its profile.
                    model_url = origin + "/api/conversations/" + session_id + "/model"
                    metadata, stopped = await asyncio.gather(
                        context.request.get(model_url),
                        context.request.post(
                            origin + "/api/conversations/" + session_id + "/terminate",
                            headers={"Origin": origin},
                            data={},
                        ),
                    )
                    evidence["terminationAcknowledged"] = stopped.status == 200
                    await require_status(stopped, "Terminate owned fixture")
                    await require_status(
                        metadata, "Read fixture metadata during termination"
                    )
                    for _ in range(3):
                        current = await context.request.get(model_url)
                        await require_status(
                            current, "Read terminated fixture metadata"
                        )
                        listed = await context.request.get(
                            origin + "/api/conversations"
                        )
                        await require_status(
                            listed, "Verify fixture remains terminated"
                        )
                        conversations = (await listed.json())["conversations"]
                        assert all(
                            item["id"] != session_id for item in conversations
                        ), (
                            "A terminated fixture was resurrected by a concurrent metadata read"
                        )
                        await asyncio.sleep(0.1)
                    evidence["ownedSessionTerminated"] = True
                    evidence["terminationSurvivedConcurrentMetadataReads"] = True

            cleanup.push_async_callback(terminate_owned_session)
            try:
                if args.assets_dir:
                    assets = args.assets_dir.resolve()
                    assert (assets / "index.html").is_file()

                    async def candidate(route):
                        path = urlparse(route.request.url).path
                        target = (
                            assets / ("index.html" if path == "/" else path.lstrip("/"))
                        ).resolve()
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

                    await context.route(origin + "/**", candidate)

                async def capture(request):
                    if (
                        session_id
                        and request.url
                        == origin + "/api/conversations/" + session_id + "/browser"
                    ):
                        response = await request.response()
                        if response is None:
                            return
                        body = request.post_data_json
                        timing = request.timing
                        requests.append(
                            {
                                "kind": body["kind"],
                                "status": response.status,
                                "at": time.monotonic(),
                                "errorBody": await response.text()
                                if response.status >= 400
                                else None,
                                "ms": round(
                                    timing["responseEnd"] - timing["requestStart"], 2
                                ),
                            }
                        )

                page = await context.new_page()
                evidence["pageErrors"] = []
                evidence["consoleErrors"] = []
                evidence["failedRequests"] = []
                evidence["assetResponses"] = []
                page.on(
                    "pageerror", lambda error: evidence["pageErrors"].append(str(error))
                )
                page.on(
                    "console",
                    lambda message: evidence["consoleErrors"].append(message.text)
                    if message.type == "error"
                    else None,
                )
                page.on(
                    "requestfailed",
                    lambda request: evidence["failedRequests"].append(
                        {"path": urlparse(request.url).path, "failure": request.failure}
                    ),
                )
                page.on(
                    "response",
                    lambda response: evidence["assetResponses"].append(
                        {"path": urlparse(response.url).path, "status": response.status}
                    )
                    if urlparse(response.url).path.startswith("/assets/")
                    else None,
                )

                def capture_window_stream(socket):
                    path = urlparse(socket.url).path
                    if not session_id or path != "/ws/browser/" + session_id:
                        return
                    observed = {
                        "path": path,
                        "binaryFrames": 0,
                        "binaryBytes": 0,
                        "closed": False,
                        "openedAt": time.monotonic(),
                        "frameTimeline": [],
                    }
                    window_streams.append(observed)

                    def received(payload):
                        if isinstance(payload, bytes):
                            if observed["binaryFrames"] == 0:
                                observed["initialServerBytes"] = payload[:16].hex()
                            observed["binaryFrames"] += 1
                            observed["binaryBytes"] += len(payload)
                            if len(observed["frameTimeline"]) < 32:
                                observed["frameTimeline"].append(
                                    {"at": time.monotonic(), "bytes": len(payload)}
                                )

                    socket.on("framereceived", received)
                    socket.on(
                        "socketerror",
                        lambda error: observed.update(socketError=str(error)),
                    )
                    socket.on(
                        "close",
                        lambda *_args: observed.update(
                            closed=True, closedAt=time.monotonic()
                        ),
                    )

                page.on("websocket", capture_window_stream)
                page.on(
                    "requestfinished",
                    lambda request: tasks.append(asyncio.create_task(capture(request))),
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
                    await page.locator('input[type="password"]').fill(
                        config["password"]
                    )
                await page.get_by_role(
                    "button", name=login["pwdLoginTab"], exact=True
                ).click()
                await page.wait_for_url(
                    lambda value: "/login" not in value, timeout=30000
                )
                response = await context.request.post(
                    origin + "/api/conversations",
                    headers={"Origin": origin},
                    data={"assistantName": "", "enabledSkills": []},
                )
                await require_status(
                    response, "Create fresh isolated conversation", 201
                )
                session_id = (await response.json())["id"]
                evidence["sessionId"] = session_id
                await page.goto(
                    origin + "/#/browser-viewer/" + session_id,
                    wait_until="domcontentloaded",
                )
                panel = page.get_by_test_id("browser-session-panel")
                response = await context.request.post(
                    origin + "/api/conversations/" + session_id + "/browser",
                    headers={"Origin": origin},
                    data={"kind": "state"},
                )
                await require_status(response, "Read initial browser state")
                initial = (await response.json())["session"]
                if initial["state"] == "stopped":
                    await open_browser_source(panel, labels)
                    await expect(
                        panel.get_by_role("button", name=labels["start"], exact=True)
                    ).to_be_enabled(timeout=30000)
                    await panel.get_by_role(
                        "combobox", name=labels["launchMode"], exact=True
                    ).click()
                    await page.get_by_role(
                        "option", name=labels["headful"], exact=True
                    ).click()
                    await panel.get_by_role(
                        "button", name=labels["start"], exact=True
                    ).click()
                    deadline = time.monotonic() + 90
                    while initial["state"] in ("stopped", "pausing"):
                        assert time.monotonic() < deadline, (
                            "The requested real Chrome did not finish starting"
                        )
                        await asyncio.sleep(0.25)
                        response = await context.request.post(
                            origin + "/api/conversations/" + session_id + "/browser",
                            headers={"Origin": origin},
                            data={"kind": "state"},
                        )
                        await require_status(
                            response, "Read requested browser startup state"
                        )
                        initial = (await response.json())["session"]
                else:
                    allowed = config.get("allowedExistingFixtureOrigins", [])
                    assert allowed and all(
                        any(tab["url"].startswith(value + "/") for value in allowed)
                        or tab["url"] in ("about:blank", "chrome://newtab/")
                        for tab in initial["tabs"]
                    ), (
                        "An existing browser is outside this test's explicit fixture scope; no navigation attempted"
                    )
                    assert (
                        initial["isHeadless"] is False
                        and initial["transport"] == "extension"
                    )
                if initial["state"] == "ai":
                    await interrupt_shared_browser(page, panel, labels)
                else:
                    assert initial["state"] == "human" and initial["isController"], (
                        "The fixture's real human lease is not available"
                    )
                await expect(
                    panel.get_by_text(labels["state"]["human"], exact=True)
                ).to_be_visible(timeout=30000)
                is_browser_owned = True
                # Takeover changes the frame epoch. Wait for the refreshed
                # surface before typing; the stale frame's recovery temporarily
                # disables navigation, so Enter during that transition is lost.
                image = panel.get_by_role("img", name=labels["page"], exact=True)
                surface = panel.locator("canvas:visible").or_(image)
                await expect(surface).to_be_visible()
                surface_tag = await surface.evaluate("element => element.tagName")
                width_property = "width" if surface_tag == "CANVAS" else "naturalWidth"
                await expect(surface).to_have_js_property(width_property, 1280)
                evidence["windowSurface"] = surface_tag.lower()
                if is_window_stream_required:
                    assert initial["capabilities"].get("windowStream") is True
                    assert surface_tag == "CANVAS", (
                        "Required binary window stream fell back to JPEG"
                    )
                    current = await context.request.post(
                        origin + "/api/conversations/" + session_id + "/browser",
                        headers={"Origin": origin},
                        data={"kind": "state"},
                    )
                    await require_status(current, "Read browser before viewer refresh")
                    before_refresh = (await current.json())["session"]
                    assert before_refresh["state"] == "human"
                    evidence["viewerRefreshStartedAt"] = time.monotonic()
                    await page.reload(wait_until="domcontentloaded")
                    evidence["viewerRefreshDomReadyAt"] = time.monotonic()
                    await expect(surface).to_be_visible()
                    evidence["viewerRefreshVisibleAt"] = time.monotonic()
                    await expect(surface).to_have_js_property("width", 1280)
                    current = await context.request.post(
                        origin + "/api/conversations/" + session_id + "/browser",
                        headers={"Origin": origin},
                        data={"kind": "state"},
                    )
                    await require_status(current, "Read browser after viewer refresh")
                    after_refresh = (await current.json())["session"]
                    for key in (
                        "browserSessionId",
                        "profileId",
                        "controlEpoch",
                        "targetEpoch",
                        "state",
                    ):
                        assert after_refresh[key] == before_refresh[key], (
                            key,
                            before_refresh[key],
                            after_refresh[key],
                        )
                    assert len(window_streams) >= 2 and all(
                        item["binaryFrames"] > 0 for item in window_streams
                    )
                    evidence["authenticatedWindowStreamRefreshPreservedHumanLease"] = (
                        True
                    )
                url_input = panel.get_by_role(
                    "textbox", name=labels["address"], exact=True
                )
                await expect(url_input).to_be_enabled()
                await url_input.fill(fixture + "/review?run=" + nonce)
                async with page.expect_response(
                    lambda response: response.request.method == "POST"
                    and response.url
                    == origin + "/api/conversations/" + session_id + "/browser"
                    and response.request.post_data_json.get("kind") == "navigate"
                ) as navigation:
                    await url_input.press("Enter")
                await require_status(
                    await navigation.value, "Navigate to the owned fixture"
                )
                deadline = time.monotonic() + 15
                while not any(nonce in path for path in visits):
                    assert time.monotonic() < deadline, (
                        "The actual cloud Chrome did not reach this run's isolated fixture"
                    )
                    await asyncio.sleep(0.1)
                await expect(surface).to_be_visible()
                await expect(surface).to_have_js_property(width_property, 1280)
                await panel.evaluate(START_RENDER_SAMPLING)
                await asyncio.sleep(6)
                measured = await page.evaluate("window.browserViewMeasurements")
                assert len(measured) >= 2, (
                    "No continuing remote window frames were rendered"
                )
                distinct = [sample for sample in measured if sample["distinct"]]
                assert len(distinct) >= 2, (
                    "Remote pixels did not show the actual fixture's changing page"
                )
                duration = (measured[-1]["at"] - measured[0]["at"]) / 1000
                evidence["renderedFramesPerSecond"] = round(
                    (len(measured) - 1) / duration, 2
                )
                evidence["distinctFramesPerSecond"] = round(
                    max(0, len(distinct) - 1) / duration, 2
                )
                evidence["frameSamples"] = len(measured)
                evidence["distinctFrameSamples"] = len(distinct)
                evidence["frameMeasurement"] = (
                    "observed decoded pixel changes; lower bound on display updates"
                    if surface_tag == "CANVAS"
                    else "decoded JPEG images and observed pixel changes"
                )
                intervals = sorted(
                    measured[index]["at"] - measured[index - 1]["at"]
                    for index in range(1, len(measured))
                )
                evidence["renderIntervalMedianMs"] = round(
                    intervals[len(intervals) // 2], 2
                )
                evidence["renderIntervalP95Ms"] = round(
                    intervals[min(len(intervals) - 1, int(len(intervals) * 0.95))], 2
                )
                await page.screenshot(path=str(args.output / "headful-window.png"))
                # Page view keeps human form coordinates independent of Chrome's native toolbar height.
                await panel.get_by_role(
                    "combobox", name=labels["viewMode"], exact=True
                ).click()
                await page.get_by_role(
                    "option", name=labels["pageView"], exact=True
                ).click()
                page_frame = await page.wait_for_event(
                    "response",
                    predicate=lambda response: response.request.method == "POST"
                    and response.url
                    == origin + "/api/conversations/" + session_id + "/browser"
                    and response.request.post_data_json.get("kind") == "frame"
                    and response.request.post_data_json.get("surface") == "page",
                )
                await require_status(page_frame, "Read the selected page surface")
                actual_frame = (await page_frame.json())["frame"]
                await expect(image).to_have_js_property(
                    "naturalWidth", actual_frame["width"]
                )
                deadline = time.monotonic() + 15
                while True:
                    height = await image.evaluate("image => image.naturalHeight")
                    if 0 < height < 900:
                        break
                    assert time.monotonic() < deadline, (
                        "The viewer did not render the real page surface after switching from Window"
                    )
                    await asyncio.sleep(0.1)
                dimensions = await image.evaluate(
                    "image => ({w:image.naturalWidth,h:image.naturalHeight})"
                )
                if is_mobile_acceptance:
                    await panel.get_by_role(
                        "combobox", name=labels["imageZoom"], exact=True
                    ).click()
                    await page.get_by_role("option", name="100%", exact=True).click()
                    viewport = panel.get_by_label(labels["imageViewport"], exact=True)
                    await viewport.scroll_into_view_if_needed()
                    await expect(image).to_have_css(
                        "width", str(dimensions["w"]) + "px"
                    )
                    await expect(image).to_have_css("pointer-events", "none")
                    before_pan = sum(item["kind"] == "input" for item in requests)
                    view_box = await viewport.bounding_box()
                    assert view_box and view_box["width"] < 400
                    touch = await context.new_cdp_session(page)
                    for gesture in range(3):
                        x, y = (
                            view_box["x"] + view_box["width"] - 20,
                            view_box["y"] + view_box["height"] - 10,
                        )
                        await touch.send(
                            "Input.dispatchTouchEvent",
                            {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]},
                        )
                        for distance in (50, 100, 150, 200, 250):
                            await touch.send(
                                "Input.dispatchTouchEvent",
                                {
                                    "type": "touchMove",
                                    "touchPoints": [
                                        {
                                            "x": x - distance,
                                            "y": y
                                            - (
                                                80 * distance / 250
                                                if gesture == 0
                                                else 0
                                            ),
                                        }
                                    ],
                                },
                            )
                            # Model a continuous human swipe. Near-zero-duration
                            # CDP moves make Blink suppress the following tap.
                            await asyncio.sleep(0.03)
                        await touch.send(
                            "Input.dispatchTouchEvent",
                            {"type": "touchEnd", "touchPoints": []},
                        )
                    await touch.detach()
                    assert (
                        await viewport.evaluate("element => element.scrollLeft") >= 700
                    )
                    await page.wait_for_function(
                        "window.browserViewMeasurements.length > 0"
                    )
                    assert (
                        sum(item["kind"] == "input" for item in requests) == before_pan
                    ), "Moving the local image sent remote input"
                    assert (
                        await image.evaluate("image => image.naturalWidth")
                        == dimensions["w"]
                    ), "View zoom changed the actual remote viewport"
                    await panel.get_by_role(
                        "button", name=labels["interactPage"], exact=True
                    ).click()
                    await expect(image).to_have_css("pointer-events", "auto")
                    evidence["mobileLocalZoomAndTouchPan"] = True
                    await page.screenshot(
                        path=str(args.output / "mobile-zoom-and-pan.png")
                    )
                if is_clipboard_acceptance:
                    await verify_clipboard(
                        page,
                        panel,
                        labels,
                        selected_phrase,
                        selection_layouts,
                        clipboard_inputs,
                        clipboard_receipts,
                        nonce,
                        evidence,
                    )
                    await page.screenshot(
                        path=str(args.output / "selection-clipboard-ime.png")
                    )
                if is_touch_selection_acceptance:
                    await page.evaluate("""() => {
                        window.browserTouchDiagnostics = [];
                        for (const type of ['touchstart','touchend','pointerdown','pointerup','pointercancel','mousedown','mouseup','click']) {
                            document.addEventListener(type, event => window.browserTouchDiagnostics.push({type, trusted:event.isTrusted, target:event.target.tagName, label:event.target.getAttribute('aria-label'), text:event.target.textContent?.slice(0,80), prevented:event.defaultPrevented}), true);
                        }
                    }""")
                    await expect(
                        panel.get_by_role(
                            "button", name=labels["copySelection"], exact=True
                        )
                    ).to_be_enabled()
                    gesture = panel.get_by_role(
                        "button", name=labels["touchGesture"], exact=True
                    )
                    await expect(gesture).to_have_attribute("aria-pressed", "false")
                    await gesture.tap()
                    await expect(gesture).to_have_attribute("aria-pressed", "true")
                    await expect(
                        panel.get_by_role(
                            "button", name=labels["copySelection"], exact=True
                        )
                    ).to_be_enabled()
                    await viewport.scroll_into_view_if_needed()
                    await verify_clipboard(
                        page,
                        panel,
                        labels,
                        selected_phrase,
                        selection_layouts,
                        clipboard_inputs,
                        clipboard_receipts,
                        nonce,
                        evidence,
                        gesture="touch",
                        selection_only=True,
                    )
                    await page.screenshot(
                        path=str(args.output / "touch-phrase-selection.png")
                    )
                box = await image.bounding_box()
                assert box and dimensions["w"]

                async def click_page(x, y):
                    if is_mobile_acceptance:
                        await viewport.scroll_into_view_if_needed()
                        current_box = await image.bounding_box()
                        visible = await viewport.bounding_box()
                        target_x = (
                            current_box["x"]
                            + x * current_box["width"] / dimensions["w"]
                        )
                        target_y = (
                            current_box["y"]
                            + y * current_box["height"] / dimensions["h"]
                        )
                        assert visible["x"] < target_x < visible["x"] + visible["width"]
                        assert (
                            visible["y"] < target_y < visible["y"] + visible["height"]
                        )
                        await page.touchscreen.tap(target_x, target_y)
                        return
                    await image.click(
                        position={
                            "x": x * box["width"] / dimensions["w"],
                            "y": y * box["height"] / dimensions["h"],
                        }
                    )

                await click_page(900 if is_mobile_acceptance else 120, 125)
                text = panel.get_by_role("textbox", name=labels["text"], exact=True)
                await text.fill(expected)
                await panel.get_by_role(
                    "button", name=labels["insert"], exact=True
                ).click()
                before_submit = time.monotonic()
                await click_page(900 if is_mobile_acceptance else 120, 195)
                deadline = time.monotonic() + 15
                while True:
                    samples = await page.evaluate(
                        "() => window.browserViewMeasurements"
                    )
                    if any(
                        sample["rgb"][0] < 12
                        and abs(sample["rgb"][1] - 128) < 12
                        and sample["rgb"][2] < 12
                        for sample in samples
                    ):
                        break
                    assert time.monotonic() < deadline, (
                        "The successful login was not visible in the actual browser frame"
                    )
                    await asyncio.sleep(0.05)
                evidence["clickToVisibleLoginMs"] = round(
                    (time.monotonic() - before_submit) * 1000, 2
                )
                assert (
                    len(receipts) == 1
                    and receipts[0]["value"] == expected
                    and receipts[0]["trusted"]
                ), (
                    "The real shared Chrome did not submit the exact trusted human input once"
                )
                evidence["trustedUnicodeLoginOnce"] = True
                await page.screenshot(path=str(args.output / "human-login.png"))
                if is_profile_acceptance:
                    before_restart = await context.request.post(
                        origin + "/api/conversations/" + session_id + "/browser",
                        headers={"Origin": origin},
                        data={"kind": "state"},
                    )
                    await require_status(before_restart, "Read signed-in profile")
                    old_profile = (await before_restart.json())["session"]
                    await open_browser_source(panel, labels)
                    await panel.get_by_role(
                        "button", name=labels["stop"], exact=True
                    ).click()
                    await (
                        page.get_by_role("dialog")
                        .get_by_role("button", name=labels["stop"], exact=True)
                        .click()
                    )
                    await expect(
                        panel.get_by_role("button", name=labels["start"], exact=True)
                    ).to_be_enabled(timeout=30000)
                    await panel.get_by_role(
                        "button", name=labels["start"], exact=True
                    ).click()
                    await expect(
                        panel.get_by_text(labels["state"]["human"], exact=True)
                    ).to_be_visible(timeout=90000)
                    restarted = await context.request.post(
                        origin + "/api/conversations/" + session_id + "/browser",
                        headers={"Origin": origin},
                        data={"kind": "state"},
                    )
                    await require_status(restarted, "Read restarted profile")
                    new_profile = (await restarted.json())["session"]
                    assert new_profile["profileId"] == old_profile["profileId"]
                    assert new_profile["targetEpoch"] > old_profile["targetEpoch"]
                    await url_input.fill(fixture + "/review?resumed=" + nonce)
                    await url_input.press("Enter")
                    deadline = time.monotonic() + 15
                    while not any(
                        "resumed=" + nonce in path for path in authenticated_visits
                    ):
                        assert time.monotonic() < deadline, (
                            "The restarted Chrome did not retain its real login cookie"
                        )
                        await asyncio.sleep(0.1)
                    assert len(receipts) == 1, "Profile restart must not replay login"
                    # The HTTP visit proves cookie persistence. Independently
                    # wait for this page's distinct decoded color, so an old
                    # login frame or the startup placeholder cannot pass.
                    deadline = time.monotonic() + 15
                    while True:
                        samples = await page.evaluate(
                            "() => window.browserViewMeasurements"
                        )
                        if any(
                            abs(sample["rgb"][0] - 120) < 12
                            and sample["rgb"][1] < 12
                            and abs(sample["rgb"][2] - 200) < 12
                            for sample in samples
                        ):
                            break
                        assert time.monotonic() < deadline, (
                            "The persisted login page did not become visible after browser restart"
                        )
                        await asyncio.sleep(0.05)
                    evidence["persistedLoginVisibleAfterRestart"] = True
                    evidence["profileLoginSurvivedBrowserRestart"] = True
                    print(
                        json.dumps({"stage": "profileLoginSurvivedBrowserRestart"}),
                        flush=True,
                    )
                    await page.screenshot(path=str(args.output / "persisted-login.png"))

                    chat = await context.new_page()
                    observations = []

                    def capture_observation(socket):
                        if "/ws/conversations/" + session_id in socket.url:
                            socket.on(
                                "framereceived",
                                lambda payload: observations.append(payload),
                            )

                    chat.on("websocket", capture_observation)
                    await chat.goto(
                        origin + "/#/conversation/" + session_id,
                        wait_until="domcontentloaded",
                    )
                    await expect(chat.locator("textarea").first).to_be_visible(
                        timeout=30000
                    )
                    await continue_from_conversation(
                        chat,
                        "Observe the current browser page through its browser tools. "
                        "Report the exact text of #result and #identity. Do not navigate, "
                        "click or submit. Keep this browser open.",
                    )
                    deadline = time.monotonic() + 180
                    assistant = ""
                    is_finished = False
                    has_browser_tool = False
                    processed = 0
                    last_tool = None
                    approved_ids = set()
                    approvals = []
                    while not is_finished:
                        for payload in observations[processed:]:
                            processed += 1
                            event = read_conversation_event(
                                payload, evidence, "observation"
                            )
                            if event is None:
                                continue
                            if event.get("type") == "tool_use":
                                tool_input = event.get("input", {})
                                if isinstance(tool_input, str):
                                    tool_input = json.loads(tool_input)
                                last_tool = (event.get("name", ""), tool_input)
                                if browser_tool_name(*last_tool).startswith(
                                    "mcp__sudowork-browser__"
                                ):
                                    has_browser_tool = True
                            if event.get("type") == "control_request":
                                request_id = event.get("request_id")
                                if request_id not in approved_ids:
                                    approvals.append(
                                        await approve_browser_permission(
                                            chat, event, last_tool
                                        )
                                    )
                                    approved_ids.add(request_id)
                            if event.get("type") == "assistant":
                                content = event.get("message", {}).get("content", [])
                                if isinstance(content, str):
                                    assistant += content
                                else:
                                    for block in content:
                                        if not isinstance(block, dict):
                                            continue
                                        assistant += block.get("text", "")
                                        if (
                                            block.get("type") == "tool_use"
                                            and "browser"
                                            in block.get("name", "").lower()
                                        ):
                                            has_browser_tool = True
                            if event.get("type") == "result":
                                assert not event.get("is_error")
                                is_finished = True
                        assert time.monotonic() < deadline, (
                            "AI did not finish observing the persisted login"
                        )
                        if not is_finished:
                            await asyncio.sleep(0.25)
                    assert (
                        has_browser_tool
                        and expected in assistant
                        and "Signed in" in assistant
                    )
                    assert len(receipts) == 1
                    evidence["realModelObservedPersistedLogin"] = True
                    evidence["observationApprovals"] = approvals
                    await interrupt_shared_browser(page, panel, labels)
                    await chat.close()
                assert evidence["renderedFramesPerSecond"] >= args.minimum_fps, (
                    "Remote view did not meet the configured real acceptance rate"
                )
                evidence["passed"] = True
            except BaseException as error:
                evidence["workflowFailure"] = (
                    type(error).__name__ + ": " + str(error).split("\nCall log:", 1)[0]
                )
                try:
                    if chat and not chat.is_closed():
                        await chat.screenshot(
                            path=str(args.output / "failure-chat.png")
                        )
                        evidence["failureChatText"] = await chat.locator(
                            "body"
                        ).inner_text()
                    await page.screenshot(path=str(args.output / "failure.png"))
                    evidence["failureCapturedAt"] = time.monotonic()
                    evidence["failureResourceTiming"] = await page.evaluate(
                        "() => performance.getEntriesByType('resource').filter(entry => /BrowserSessionPanel|rfb-/.test(entry.name)).map(entry => ({path:new URL(entry.name).pathname,start:entry.startTime,duration:entry.duration,bytes:entry.transferSize}))"
                    )
                    evidence["failureCanvases"] = await panel.locator(
                        "canvas"
                    ).evaluate_all(
                        "canvases => canvases.map(canvas => ({width:canvas.width,height:canvas.height,visible:canvas.checkVisibility(),parentStyle:canvas.parentElement.parentElement.getAttribute('style')}))"
                    )
                    evidence["touchDiagnostics"] = await page.evaluate(
                        "window.browserTouchDiagnostics"
                    )
                    evidence["failureControls"] = await page.get_by_test_id(
                        "browser-session-panel"
                    ).evaluate(
                        "panel => Array.from(panel.querySelectorAll('button,[role=combobox],select')).map(el => ({tag:el.tagName,role:el.getAttribute('role'),label:el.getAttribute('aria-label'),text:el.textContent,disabled:el.disabled,ariaDisabled:el.getAttribute('aria-disabled'),expanded:el.getAttribute('aria-expanded'),className:el.className}))"
                    )
                except Exception as diagnostic_error:
                    evidence["failureCaptureError"] = type(diagnostic_error).__name__
                raise
            finally:
                if tasks:
                    await asyncio.gather(*tasks)
                if session_id:
                    if is_browser_owned:
                        current = await context.request.post(
                            origin + "/api/conversations/" + session_id + "/browser",
                            headers={"Origin": origin},
                            data={"kind": "state"},
                        )
                        await require_status(current, "Read owned fixture before Stop")
                        state = (await current.json())["session"]
                        if (
                            is_profile_acceptance
                            and evidence.get("profileLoginSurvivedBrowserRestart")
                            and state["state"] == "ai"
                        ):
                            # This test itself returned its owned profile to AI.
                            # A failed observation must still stop its own turn
                            # through the normal acknowledged takeover barrier.
                            taken = await context.request.post(
                                origin
                                + "/api/conversations/"
                                + session_id
                                + "/browser",
                                headers={"Origin": origin},
                                data={
                                    "kind": "take",
                                    "controlEpoch": state["controlEpoch"],
                                    "targetEpoch": state["targetEpoch"],
                                },
                            )
                            await require_status(
                                taken, "Take the owned observation fixture"
                            )
                            state = (await taken.json())["session"]
                        if state["state"] != "stopped":
                            assert (
                                state["state"] == "human" and state["isController"]
                            ), (
                                "Preserve the fixture for inspection: its ownership changed before cleanup"
                            )
                            stopped = await context.request.post(
                                origin
                                + "/api/conversations/"
                                + session_id
                                + "/browser",
                                headers={"Origin": origin},
                                data={
                                    "kind": "stop",
                                    "controlEpoch": state["controlEpoch"],
                                    "targetEpoch": state["targetEpoch"],
                                },
                            )
                            await require_status(stopped, "Stop owned browser")
                        evidence["ownedBrowserStopped"] = True
                        evidence["humanLeaseReturned"] = False
                        assert not evidence.get("conversationRejection"), (
                            "The browser is stopped; its human lease remains pending after the recorded conversation rejection. No second send attempted."
                        )
                        assert not evidence.get("modelFailure"), (
                            "No additional model send after the recorded failed completion; inspect the retained lease state."
                        )
                        # A persistent browser's human lease can outlive a
                        # conversation. Explicitly return the stopped browser
                        # before ending this fixture, and verify its normal
                        # real-model continuation instead of leaving it held.
                        chat = await context.new_page()

                        def stream(socket):
                            if "/ws/conversations/" + session_id in socket.url:
                                socket.on(
                                    "framereceived",
                                    lambda payload: model_events.append(payload),
                                )

                        chat.on("websocket", stream)
                        await chat.goto(
                            origin + "/#/conversation/" + session_id,
                            wait_until="domcontentloaded",
                        )
                        await expect(chat.locator("textarea").first).to_be_visible(
                            timeout=30000
                        )
                        current = await context.request.post(
                            origin + "/api/conversations/" + session_id + "/browser",
                            headers={"Origin": origin},
                            data={"kind": "state"},
                        )
                        await require_status(
                            current, "Read stopped fixture before Return"
                        )
                        state = (await current.json())["session"]
                        marker = "VIEW_CLEANUP_" + nonce
                        await continue_from_conversation(
                            chat,
                            "The isolated browser fixture is finished. Keep Chrome stopped. Do not use tools or restart the browser. Reply exactly "
                            + marker,
                        )
                        deadline = time.monotonic() + 180
                        assistant = ""
                        result = None
                        processed = 0
                        while result is None:
                            for payload in model_events[processed:]:
                                processed += 1
                                event = read_conversation_event(
                                    payload, evidence, "cleanup"
                                )
                                if event is None:
                                    continue
                                if event.get("type") == "assistant":
                                    content = event.get("message", {}).get(
                                        "content", []
                                    )
                                    assistant += (
                                        content
                                        if isinstance(content, str)
                                        else "".join(
                                            block.get("text", "")
                                            for block in content
                                            if isinstance(block, dict)
                                        )
                                    )
                                if (
                                    event.get("type") == "result"
                                    and marker in assistant
                                ):
                                    result = event
                            assert time.monotonic() < deadline, (
                                "The real model did not acknowledge the user's return note"
                            )
                            if result is None:
                                await asyncio.sleep(0.25)
                        assert not result.get("is_error") and result.get("status") in (
                            None,
                            "success",
                        )
                        evidence["realModelReturnAcknowledged"] = True
                        evidence["returnUsage"] = result.get("usage")
                        returned = await context.request.post(
                            origin + "/api/conversations/" + session_id + "/browser",
                            headers={"Origin": origin},
                            data={"kind": "state"},
                        )
                        await require_status(
                            returned,
                            "Verify human lease after conversation continuation",
                        )
                        assert (await returned.json())["session"][
                            "isHumanControlHeld"
                        ] is False
                        evidence["humanLeaseReturned"] = True
                    await terminate_owned_session()
                await context.close()
    except BaseException as error:
        evidence["passed"] = False
        evidence["failure"] = (
            type(error).__name__ + ": " + str(error).split("\nCall log:", 1)[0]
        )
        for secret in (config.get("apiKey"), config.get("password")):
            if secret:
                evidence["failure"] = evidence["failure"].replace(secret, "[redacted]")
        raise
    finally:
        evidence["browserRequests"] = requests
        evidence["windowStreams"] = window_streams
        (args.output / "evidence.json").write_text(
            json.dumps(evidence, indent=2), encoding="utf-8"
        )
        browser_stop(session_id=own["session_id"])
        server.shutdown()
        server.server_close()
        print(
            json.dumps(
                {
                    key: value
                    for key, value in evidence.items()
                    if key != "browserRequests"
                }
            ),
            flush=True,
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--locale", default="en-US")
    parser.add_argument("--assets-dir", type=Path)
    parser.add_argument("--fixture-bind", default="127.0.0.1")
    parser.add_argument("--fixture-port", type=int, default=0)
    parser.add_argument("--fixture-origin")
    parser.add_argument("--minimum-fps", type=float, default=0)
    parser.add_argument("--require-window-stream", action="store_true")
    parser.add_argument("--verify-profile-persistence", action="store_true")
    parser.add_argument("--verify-mobile-view", action="store_true")
    parser.add_argument("--verify-selection-clipboard", action="store_true")
    parser.add_argument("--verify-touch-selection", action="store_true")
    asyncio.run(main(parser.parse_args()))
