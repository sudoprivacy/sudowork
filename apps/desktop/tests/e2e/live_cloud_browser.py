"""Actual Electron enterprise login, cloud BrowserPanel and real AI readback."""

import argparse
import asyncio
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import sqlite3
import threading
import uuid

import aiohttp
from playwright.async_api import async_playwright, expect

from live_shared_browser import UI, wait_for

REPOSITORY = Path(__file__).resolve().parents[4]


async def run(args):
    config = json.loads(args.config.read_text(encoding="utf-8"))
    api_key = config["apiKey"]
    moss_origin = config["mossBaseUrl"].rstrip("/")
    assert moss_origin.startswith("https://")
    output = args.output
    output.mkdir(parents=True, mode=0o700)
    metadata = {
        "cdp": args.port,
        "home": str(args.home),
        "userData": str(args.user_data),
    }
    labels = json.loads(
        (
            REPOSITORY / "packages/renderer/src/i18n/locales/zh-CN/conversation.json"
        ).read_text(encoding="utf-8")
    )["browserSession"]
    login = json.loads(
        (REPOSITORY / "packages/renderer/src/i18n/locales/zh-CN/login.json").read_text(
            encoding="utf-8"
        )
    )
    nonce = uuid.uuid4().hex[:10]
    expected = "Desktop cloud 中文 " + nonce
    receipts = []
    evidence = {
        "actualElectron": True,
        "actualPhone": False,
        "passed": False,
        "bootstrapMarker": "CLOUD_DESKTOP_" + nonce,
    }
    access_token = None
    local_id = None
    moss_sid = None

    async def moss_api(path, method="GET", body=None):
        headers = {"Authorization": "Bearer " + access_token} if access_token else {}
        async with aiohttp.ClientSession(trust_env=False) as client:
            async with client.request(
                method, moss_origin + path, json=body, headers=headers
            ) as response:
                result = await response.json()
                if response.status not in (200, 201):
                    evidence["rejection"] = {
                        "action": method + " " + path,
                        "status": response.status,
                        "reason": result.get("message") or result.get("error"),
                        "noRetry": True,
                    }
                    raise AssertionError(
                        "Moss rejected the request; original reason retained"
                    )
                return result

    def bound_session():
        if local_id is None:
            return None
        with sqlite3.connect(
            "file:" + str(args.home / ".nexus/sudowork.db") + "?mode=ro", uri=True
        ) as database:
            row = database.execute(
                "SELECT type,extra FROM conversations WHERE id=?", (local_id,)
            ).fetchone()
        assert (
            row and row[0] == "remote-agent"
        ), "This must be an actual Desktop cloud conversation"
        return json.loads(row[1]).get("mossSessionId")

    class Site(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            body = b"""<!doctype html><meta charset="utf-8"><title>Desktop cloud fixture</title><style>body{margin:0;font:24px sans-serif}input,button{position:absolute;left:40px;width:360px;height:48px;font:24px sans-serif}input{top:100px}button{top:170px}</style><input id="identity" aria-label="Human identity"><button id="submit">Save once</button><p id="result">Waiting</p><script>submit.onclick=async e=>{await fetch('/submit',{method:'POST',body:JSON.stringify({value:document.querySelector('#identity').value,trusted:e.isTrusted})});document.querySelector('#result').textContent='Saved';}</script>"""
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):
            assert self.path == "/submit"
            receipts.append(
                json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            )
            self.send_response(200)
            self.send_header("Content-Length", "2")
            self.end_headers()
            self.wfile.write(b"{}")

    fixture = ThreadingHTTPServer(("127.0.0.1", args.fixture_port), Site)
    threading.Thread(target=fixture.serve_forever, daemon=True).start()
    try:
        access_token = (
            await moss_api(
                "/api/v1/auth/login",
                "POST",
                {"grant_type": "api_key", "api_key": api_key},
            )
        )["access_token"]
        async with aiohttp.ClientSession() as http, async_playwright() as driver:

            async def renderer_ready():
                try:
                    async with http.get(
                        f'http://127.0.0.1:{metadata["cdp"]}/json/list'
                    ) as response:
                        return any(
                            t.get("type") == "page"
                            and "/renderer/index.html" in t.get("url", "")
                            for t in await response.json()
                        )
                except aiohttp.ClientConnectorError:
                    return False

            await wait_for(
                renderer_ready, 60, "The actual Electron renderer did not start"
            )
            browser = await driver.chromium.connect_over_cdp(
                f'http://127.0.0.1:{metadata["cdp"]}'
            )
            page = next(
                p
                for c in browser.contexts
                for p in c.pages
                if "/renderer/index.html" in p.url
            )
            async with http.get(
                f'http://127.0.0.1:{metadata["cdp"]}/json/list'
            ) as response:
                target = next(
                    t
                    for t in await response.json()
                    if t["type"] == "page" and "/renderer/index.html" in t["url"]
                )
            ui = UI(http, target)
            await page.wait_for_url(lambda value: "/login" in value, timeout=30000)
            assert "/login" in page.url, "Use a fresh isolated Desktop login instance"
            if moss_origin != "https://agent.sudoprivacy.com":
                await page.get_by_text(login["customServerToggle"], exact=True).click()
                await page.get_by_placeholder(
                    "https://agent.sudoprivacy.com", exact=True
                ).fill(moss_origin)
                await page.get_by_role(
                    "button", name=login["serverApply"], exact=True
                ).click()
            await page.get_by_text(login["apiKeyTab"], exact=True).click()
            await page.get_by_placeholder(login["apiKeyPlaceholder"], exact=True).fill(
                api_key
            )
            await page.get_by_role("button", name=login["submit"], exact=True).click()
            await expect(page.get_by_text("新建任务", exact=True).first).to_be_visible(
                timeout=30000
            )
            await page.get_by_text("新建任务", exact=True).first.click()
            cloud = page.get_by_text("服务器执行", exact=True)
            await expect(cloud).to_be_visible(timeout=30000)
            await cloud.click()
            bootstrap = "Reply exactly CLOUD_DESKTOP_" + nonce + ". Do not use tools."
            await page.locator("textarea").first.fill(bootstrap)
            await page.get_by_role("button", name="发送", exact=True).click()
            await page.wait_for_url(
                lambda value: "/conversation/" in value, timeout=30000
            )
            local_id = page.url.rsplit("/", 1)[1].split("?", 1)[0]
            evidence["localConversationId"] = local_id

            async def bootstrapped():
                return (
                    any(
                        "CLOUD_DESKTOP_" + nonce in reply
                        for reply in await ui.assistant_messages()
                    )
                    and await ui.turn_finished()
                )

            await wait_for(
                bootstrapped,
                180,
                "Actual Desktop cloud model did not finish its bootstrap",
            )
            sid = bound_session()
            assert sid
            moss_sid = sid
            evidence.update(
                localConversationId=local_id,
                mossSessionId=sid,
                cloudModelBootstrap=True,
            )
            (output / "session.json").write_text(json.dumps(evidence, indent=2))
            await page.get_by_text("浏览器", exact=True).last.click()
            panel = page.get_by_test_id("browser-session-panel")
            await expect(panel).to_be_visible()
            await panel.get_by_role(
                "combobox", name=labels["launchMode"], exact=True
            ).click()
            await page.get_by_role("option", name=labels["headful"], exact=True).click()
            await panel.get_by_role("button", name=labels["start"], exact=True).click()
            await expect(
                panel.get_by_role("button", name=labels["take"], exact=True)
            ).to_be_enabled(timeout=90000)
            await panel.get_by_role("button", name=labels["take"], exact=True).click()
            await expect(
                panel.get_by_role("button", name=labels["return"], exact=True)
            ).to_be_enabled(timeout=30000)
            await panel.get_by_role(
                "button", name=labels["openViewer"], exact=True
            ).click()

            async def separate_viewer():
                return next(
                    (
                        p
                        for c in browser.contexts
                        for p in c.pages
                        if "#/browser-viewer/" + local_id in p.url
                    ),
                    None,
                )

            viewer = await wait_for(
                separate_viewer, 20, "The actual Desktop cloud viewer did not open"
            )
            panel = viewer.get_by_test_id("browser-session-panel")
            await expect(panel).to_be_visible()
            evidence["independentCloudViewer"] = True
            await panel.get_by_role(
                "combobox", name=labels["viewMode"], exact=True
            ).click()
            await viewer.get_by_role(
                "option", name=labels["pageView"], exact=True
            ).click()
            image = panel.get_by_role("img", name=labels["page"], exact=True)
            await expect(image).to_be_visible(timeout=30000)
            address = panel.get_by_role("textbox", name=labels["address"], exact=True)
            await expect(address).to_be_enabled()
            await address.fill(
                args.fixture_origin.rstrip("/") + "/review?desktop=" + nonce
            )
            await address.press("Enter")
            await asyncio.sleep(1)
            box = await image.bounding_box()
            dimensions = await image.evaluate(
                "e=>({w:e.naturalWidth,h:e.naturalHeight})"
            )
            assert box and dimensions["w"]

            async def click(x, y):
                await image.click(
                    position={
                        "x": x * box["width"] / dimensions["w"],
                        "y": y * box["height"] / dimensions["h"],
                    }
                )

            await click(120, 125)
            await panel.get_by_role("textbox", name=labels["text"], exact=True).fill(
                expected
            )
            await panel.get_by_role("button", name=labels["insert"], exact=True).click()
            await click(120, 195)
            await wait_for(
                lambda: asyncio.sleep(0, result=bool(receipts)),
                15,
                "Cloud Chrome did not submit",
            )
            assert receipts == [{"value": expected, "trusted": True}]
            await viewer.screenshot(path=str(output / "desktop-cloud-human.png"))
            await panel.get_by_role("textbox", name=labels["note"], exact=True).fill(
                "Use browser tools to inspect the current page. Report the exact value of #identity and text of #result. Do not navigate, click, type or submit."
            )
            await panel.get_by_role("button", name=labels["return"], exact=True).click()

            async def observed():
                once = page.get_by_text("Allow Once", exact=False)
                if await once.count():
                    card = once.last.locator(
                        "xpath=ancestor::div[contains(@class,'max-w-800px')][1]"
                    )
                    text = await card.inner_text()
                    assert "mcp__sudowork-browser__" in text or (
                        "ToolSearch" in text and "sudowork-browser" in text
                    ), "Unexpected tool permission"
                    await once.last.click()
                return (
                    any(
                        expected in reply and "Saved" in reply
                        for reply in await ui.assistant_messages()
                    )
                    and await ui.turn_finished()
                )

            await wait_for(observed, 180, "Cloud AI did not read the exact user edit")
            assert receipts == [{"value": expected, "trusted": True}]
            evidence.update(exactCloudModelReadback=True, oneTrustedSubmission=True)
            await page.screenshot(path=str(output / "desktop-cloud-ai-readback.png"))
            await panel.get_by_role("button", name=labels["take"], exact=True).click()
            await expect(
                panel.get_by_role("button", name=labels["return"], exact=True)
            ).to_be_enabled(timeout=30000)
            await panel.get_by_role("button", name=labels["stop"], exact=True).click()
            await viewer.get_by_role("dialog").get_by_role(
                "button", name=labels["stop"], exact=True
            ).click()
            await expect(
                panel.get_by_role("button", name=labels["start"], exact=True)
            ).to_be_enabled(timeout=30000)
            await panel.get_by_role("textbox", name=labels["note"], exact=True).fill(
                "Fixture finished. Keep Chrome stopped. Do not use tools. Reply exactly CLOUD_CLEANUP_"
                + nonce
            )
            await panel.get_by_role("button", name=labels["return"], exact=True).click()
            await wait_for(
                lambda: cleanup_ready(ui, nonce),
                180,
                "Cloud cleanup return was not acknowledged",
            )
            assert not (Path(metadata["userData"]) / "browser-runtime").exists()
            evidence.update(
                passed=True,
                ownedBrowserStopped=True,
                humanLeaseReturned=True,
                localWorkerAllocated=False,
            )
    except BaseException as error:
        evidence["passed"] = False
        evidence["failure"] = (
            type(error).__name__ + ": " + str(error).split("\nCall log:", 1)[0]
        ).replace(api_key, "[redacted]")
        raise
    finally:
        try:
            moss_sid = moss_sid or bound_session()
            if moss_sid and access_token and not evidence.get("rejection"):
                session = (await moss_api("/api/v1/sessions/" + moss_sid))["session"]
                assert (
                    session["userId"] == config["ownerId"]
                    and session["orgId"] == config["orgId"]
                )
                assert (
                    await moss_api(
                        "/api/v1/sessions/" + moss_sid + "/terminate", "POST", {}
                    )
                )["ok"] is True
                for _ in range(3):
                    assert (await moss_api("/api/v1/sessions/" + moss_sid))["session"][
                        "desiredState"
                    ] == "terminated"
                evidence["ownedCloudSessionTerminated"] = True
        except BaseException:
            evidence["passed"] = False
            raise
        finally:
            (output / "evidence.json").write_text(
                json.dumps(evidence, indent=2), encoding="utf-8"
            )
            fixture.shutdown()
            fixture.server_close()
    return evidence


async def cleanup_ready(ui, nonce):
    return (
        any(
            "CLOUD_CLEANUP_" + nonce in reply for reply in await ui.assistant_messages()
        )
        and await ui.turn_finished()
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--home", type=Path, required=True)
    parser.add_argument("--user-data", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--fixture-port", type=int, default=0)
    parser.add_argument("--fixture-origin", required=True)
    asyncio.run(run(parser.parse_args()))
