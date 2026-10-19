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
    receipts = []
    visits = []
    evidence = {
        "origin": origin,
        "headful": True,
        "actualPhone": False,
        "candidateAssets": bool(args.assets_dir),
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
            body = (
                """<!doctype html><meta charset="utf-8"><title>Remote login fixture</title>
<style>body{margin:0;font:24px sans-serif}input,button{position:absolute;left:40px;width:360px;height:48px;font:24px sans-serif}input{top:100px}button{top:170px}</style>
<input id="login" aria-label="Login confirmation"><button id="submit">Sign in</button><p id="result">Signed out</p>
<script>let n=0;const ticker=setInterval(()=>document.body.style.background=`rgb(${30+(n++%100)},80,160)`,100);
submit.onclick=async e=>{const response=await fetch('/submit',{method:'POST',body:JSON.stringify({value:document.querySelector('#login').value,trusted:e.isTrusted})});
if(response.ok){clearInterval(ticker);document.body.style.background='rgb(0,128,0)';document.querySelector('#result').textContent='Signed in';}};</script>"""
            ).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):
            assert self.path == "/submit"
            receipt = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            receipt["receivedAt"] = time.monotonic()
            receipts.append(receipt)
            self.send_response(200)
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
    page = None
    is_browser_owned = False
    is_termination_attempted = False
    try:
        async with async_playwright() as driver, AsyncExitStack() as cleanup:
            browser = await driver.chromium.connect_over_cdp(
                "http://127.0.0.1:" + str(own["port"])
            )
            context = await browser.new_context(
                viewport={"width": 1440, "height": 1100}, locale=args.locale
            )

            async def terminate_owned_session():
                nonlocal is_termination_attempted
                if session_id and not is_termination_attempted:
                    is_termination_attempted = True
                    stopped = await context.request.post(
                        origin + "/api/conversations/" + session_id + "/terminate",
                        headers={"Origin": origin},
                        data={},
                    )
                    evidence["ownedSessionTerminated"] = stopped.status == 200
                    await require_status(stopped, "Terminate owned fixture")
                    assert evidence["ownedSessionTerminated"], (
                        "Owned fixture cleanup was not acknowledged"
                    )

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
                                "ms": round(
                                    timing["responseEnd"] - timing["requestStart"], 2
                                ),
                            }
                        )

                page = await context.new_page()
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
                    await panel.get_by_role(
                        "button", name=labels["take"], exact=True
                    ).click()
                else:
                    assert initial["state"] == "human" and initial["isController"], (
                        "The fixture's real human lease is not available"
                    )
                await expect(
                    panel.get_by_role("button", name=labels["return"], exact=True)
                ).to_be_enabled(timeout=30000)
                is_browser_owned = True
                url_input = panel.get_by_role(
                    "textbox", name=labels["address"], exact=True
                )
                await url_input.fill(fixture + "/review?run=" + nonce)
                await url_input.press("Enter")
                deadline = time.monotonic() + 15
                while not any(nonce in path for path in visits):
                    assert time.monotonic() < deadline, (
                        "The actual cloud Chrome did not reach this run's isolated fixture"
                    )
                    await asyncio.sleep(0.1)
                image = panel.get_by_role("img", name=labels["page"], exact=True)
                await expect(image).to_be_visible()
                await expect(image).to_have_js_property("naturalWidth", 1280)
                await image.evaluate("""image => {
                    window.browserViewMeasurements = [];
                    let previous = '';
                    image.addEventListener('load', () => {
                        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
                        const context = canvas.getContext('2d');
                        context.drawImage(image, image.naturalWidth * .8, image.naturalHeight * .8, 1, 1, 0, 0, 1, 1);
                        const rgb = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
                        window.browserViewMeasurements.push({at:performance.now(), distinct:image.src !== previous, rgb});
                        previous = image.src;
                    });
                }""")
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
                box = await image.bounding_box()
                assert box and dimensions["w"]

                async def click_page(x, y):
                    await image.click(
                        position={
                            "x": x * box["width"] / dimensions["w"],
                            "y": y * box["height"] / dimensions["h"],
                        }
                    )

                await click_page(120, 125)
                text = panel.get_by_role("textbox", name=labels["text"], exact=True)
                await text.fill(expected)
                await panel.get_by_role(
                    "button", name=labels["insert"], exact=True
                ).click()
                before_submit = time.monotonic()
                await click_page(120, 195)
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
                assert evidence["renderedFramesPerSecond"] >= args.minimum_fps, (
                    "Remote view did not meet the configured real acceptance rate"
                )
                evidence["passed"] = True
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
                        returned = await context.request.post(
                            origin + "/api/conversations/" + session_id + "/browser",
                            headers={"Origin": origin},
                            data={
                                "kind": "return",
                                "controlEpoch": state["controlEpoch"],
                                "targetEpoch": state["targetEpoch"],
                                "note": "The isolated browser fixture is finished. Keep Chrome stopped. Do not use tools or restart the browser. Reply exactly "
                                + marker,
                            },
                        )
                        await require_status(returned, "Return stopped fixture to AI")
                        evidence["humanLeaseReturned"] = True
                        deadline = time.monotonic() + 180
                        assistant = ""
                        result = None
                        processed = 0
                        while result is None:
                            for payload in model_events[processed:]:
                                processed += 1
                                if not isinstance(payload, str):
                                    continue
                                message = json.loads(payload)
                                if message.get("kind") != "upstream":
                                    continue
                                event = message.get("event", {})
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
    asyncio.run(main(parser.parse_args()))
