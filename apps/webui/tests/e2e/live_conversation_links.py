"""Verify an externally created conversation link with a real model and UI."""

import argparse
import asyncio
import json
from pathlib import Path
import time
from urllib.parse import urlparse
from uuid import uuid4

from ai_dev_browser.core.browser import browser_start, browser_stop
from playwright.async_api import async_playwright, expect

from live_browser_ui import continue_from_conversation


async def main(args):
    config = json.loads(args.config.read_text(encoding="utf8"))
    origin = config["origin"].rstrip("/")
    labels = json.loads(
        (
            Path(__file__).resolve().parents[4]
            / "packages/renderer/src/i18n/locales"
            / args.locale
            / "login.json"
        ).read_text(encoding="utf8")
    )
    args.output.mkdir(parents=True, exist_ok=False)
    evidence = {
        "passed": False,
        "actualPhone": False,
        "createdSessionIds": [],
        "turns": [],
    }
    owned = browser_start(
        headless=True,
        temp=True,
        reuse="none",
        silent_stderr=True,
        **({"extra_args": ["--no-sandbox"]} if args.container_fixture else {}),
    )
    created = set()
    context = None
    driver = None
    page = None
    responses = []
    frames = []

    async def check(response, expected, action):
        if response.status != expected:
            evidence["rejection"] = {
                "action": action,
                "status": response.status,
                "body": (await response.text())[:1500],
            }
            raise AssertionError("Official API refused: " + action)
        return await response.json()

    async def observe(response):
        path = urlparse(response.url).path
        if (
            response.request.method == "POST"
            and path == "/api/conversations"
            and response.status == 201
        ):
            created.add((await response.json())["id"])
        if response.request.method == "GET" and path.startswith("/api/conversations/"):
            evidence.setdefault("detailReads", []).append(
                {"path": path, "status": response.status}
            )

    def socket_open(socket):
        path = urlparse(socket.url).path
        if not path.startswith("/ws/conversations/"):
            return
        evidence.setdefault("chatSockets", []).append(path)

        def capture(direction, raw):
            if isinstance(raw, str):
                frames.append(
                    {"direction": direction, "path": path, "payload": json.loads(raw)}
                )

        socket.on("framesent", lambda raw: capture("sent", raw))
        socket.on("framereceived", lambda raw: capture("received", raw))

    try:
        assert not owned.get("error"), owned
        driver = await async_playwright().start()
        browser = await driver.chromium.connect_over_cdp(
            "http://127.0.0.1:" + str(owned["port"])
        )
        context = await browser.new_context(
            viewport={"width": 1440, "height": 1000}, locale=args.locale
        )
        cookie = config.get("deploymentCookie")
        if cookie:
            await context.add_cookies(
                [{**cookie, "url": origin, "secure": True, "sameSite": "Lax"}]
            )
        health = await context.request.get(
            origin + "/health/live?conversation_link=" + uuid4().hex
        )
        await check(health, 200, "Read deployment health")
        assert health.headers.get("x-pc3-browser-canary") == config.get(
            "deploymentReceipt"
        )
        page = await context.new_page()
        page.on(
            "response",
            lambda response: responses.append(asyncio.create_task(observe(response))),
        )
        page.on("websocket", socket_open)
        await page.goto(origin + "/#/login", wait_until="domcontentloaded")
        await page.get_by_text(labels["apiKeyTab"], exact=True).click()
        await page.get_by_placeholder(labels["apiKeyPlaceholder"], exact=True).fill(
            config["apiKey"]
        )
        async with page.expect_response(
            lambda response: response.request.method == "GET"
            and urlparse(response.url).path == "/api/conversations"
            and response.status == 200
        ) as initial_history:
            await page.get_by_role(
                "button", name=labels["pwdLoginTab"], exact=True
            ).click()
        await (await initial_history.value).finished()
        await page.wait_for_url(lambda url: "/login" not in url, timeout=30_000)
        # The host may create the browser session outside this renderer's list cache.
        response = await context.request.post(
            origin + "/api/conversations",
            headers={"Origin": origin},
            data={
                "assistantName": "",
                "enabledSkills": [],
                **({"modelId": config["modelId"]} if config.get("modelId") else {}),
            },
        )
        session = (await check(response, 201, "Create isolated conversation"))["id"]
        created.add(session)
        evidence["sessionId"] = session
        target = origin + "/#/conversation/" + session
        await page.goto(target, wait_until="domcontentloaded")
        editor = page.locator("textarea").first
        await expect(editor).to_be_visible(timeout=30_000)
        assert page.url == target, (
            "The exact conversation link redirected before any user input"
        )
        marker = "CONVERSATION_LINK_" + uuid4().hex
        for turn in (1, 2):
            if turn == 2:
                await page.reload(wait_until="domcontentloaded")
                await expect(editor).to_be_visible(timeout=30_000)
                assert page.url == target, "Reload changed the bound conversation"
            begin = len(frames)
            prompt = (
                "Do not use tools. Reply exactly " + marker
                if turn == 1
                else "Do not use tools. Reply exactly the marker from my previous message."
            )
            await continue_from_conversation(page, prompt)
            processed, result, assistant = begin, None, ""
            deadline = time.monotonic() + 180
            while result is None:
                for frame in frames[processed:]:
                    processed += 1
                    assert frame["path"] == "/ws/conversations/" + session, (
                        "Input or output used another conversation"
                    )
                    payload = frame["payload"]
                    if frame["direction"] != "received":
                        continue
                    assert payload.get("kind") != "error", payload
                    event = payload.get("event", {})
                    if payload.get("kind") != "upstream":
                        continue
                    if event.get("type") == "assistant":
                        content = event.get("message", {}).get("content", [])
                        assistant += (
                            content
                            if isinstance(content, str)
                            else "".join(
                                block.get("text", "")
                                for block in content
                                if isinstance(block, dict)
                            )
                        )
                    if event.get("type") == "result":
                        result = event
                assert time.monotonic() < deadline, "No real model completion"
                if result is None:
                    await asyncio.sleep(0.1)
            assert not result.get("is_error") and marker in assistant, result
            assert page.url == target
            evidence["turns"].append(
                {
                    "turn": turn,
                    "sessionId": session,
                    "markerObserved": True,
                    "usage": result.get("usage"),
                }
            )
        assert created == {session}, "The UI created an extra conversation"
        assert set(evidence["chatSockets"]) == {"/ws/conversations/" + session}
        assert any(
            read["path"] == "/api/conversations/" + session and read["status"] == 200
            for read in evidence.get("detailReads", [])
        ), "The real authoritative detail fallback was not exercised"
        await page.screenshot(path=str(args.output / "conversation.png"))
        evidence["interactionPassed"] = True
    except BaseException as error:
        evidence["failure"] = (
            type(error).__name__ + ": " + str(error).split("\nCall log:", 1)[0]
        )
        raise
    finally:
        cleanup_error = None
        try:
            if context:
                # Close polling clients before ending every fixture-created session.
                for owned_page in context.pages:
                    await owned_page.close()
                if responses:
                    await asyncio.gather(*responses)
                evidence["createdSessionIds"] = sorted(created)
                evidence["terminatedSessionIds"] = []
                for session in sorted(created):
                    response = await context.request.post(
                        origin + "/api/conversations/" + session + "/terminate",
                        headers={"Origin": origin},
                        data={},
                    )
                    await check(
                        response, 200, "Terminate owned conversation " + session
                    )
                    evidence["terminatedSessionIds"].append(session)
                await context.close()
        except BaseException as error:
            cleanup_error = error
            evidence["cleanupFailure"] = type(error).__name__ + ": " + str(error)
        try:
            if driver:
                await driver.stop()
            if owned.get("session_id"):
                evidence["browserCleanup"] = browser_stop(
                    session_id=owned["session_id"]
                )
            elif owned.get("port") and owned.get("pid"):
                evidence["browserCleanup"] = browser_stop(port=owned["port"])
        except BaseException as error:
            cleanup_error = error
            evidence["browserCleanupFailure"] = type(error).__name__ + ": " + str(error)
        evidence["passed"] = bool(
            evidence.get("interactionPassed")
            and not cleanup_error
            and set(evidence.get("terminatedSessionIds", [])) == created
            and evidence.get("browserCleanup", {}).get("stopped")
        )
        text = json.dumps(evidence, indent=2, ensure_ascii=False).replace(
            config["apiKey"], "[redacted]"
        )
        (args.output / "evidence.json").write_text(text, encoding="utf8")
        print(text, flush=True)
        if cleanup_error:
            raise cleanup_error


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--locale", default="zh-CN")
    parser.add_argument("--container-fixture", action="store_true")
    asyncio.run(main(parser.parse_args()))
