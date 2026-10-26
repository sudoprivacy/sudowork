"""Real shared React/noVNC surface, checked native input, mode changes and reconnect.

Run in the managed Linux Chrome image with the normally built fixture assets.
The isolated cookie-authenticated host uses the public worker; this is component
acceptance, not production WebUI account/graph/model/phone acceptance.
"""

import argparse
import asyncio
import base64
import hmac
import json
import secrets
import sys
import tempfile
import time
import uuid
from pathlib import Path
from urllib.parse import quote

import aiohttp
from aiohttp import web

from ai_dev_browser.core.browser import browser_start, browser_stop
from ai_dev_browser.remote.cdp import CDP
from ai_dev_browser.remote.worker import Worker, application

sys.path.insert(0, str(Path(__file__).resolve().parents[4] / "apps/webui/tests/e2e"))
from live_browser_pixels import START_RENDER_SAMPLING


async def wait_for(operation, predicate=bool, timeout=30):
    deadline = asyncio.get_running_loop().time() + timeout
    while True:
        value = await operation()
        if predicate(value):
            return value
        if asyncio.get_running_loop().time() >= deadline:
            raise AssertionError(f"Expected visible state did not arrive: {value!r}")
        await asyncio.sleep(0.05)


async def click(page, point):
    await page.call("Input.dispatchMouseEvent", {"type": "mouseMoved", **point})
    for phase in ("mousePressed", "mouseReleased"):
        await page.call(
            "Input.dispatchMouseEvent",
            {
                "type": phase,
                **point,
                "button": "left",
                "buttons": 1 if phase == "mousePressed" else 0,
                "clickCount": 1,
            },
        )


async def element_center(page, selector):
    return await page.js(
        """(()=>{const r=document.querySelector(SELECTOR).getBoundingClientRect();
        return {x:r.x+r.width/2,y:r.y+r.height/2}})()""".replace(
            "SELECTOR", json.dumps(selector)
        )
    )


async def run_case(assets, evidence, transport, graph_html=None):
    evidence.mkdir(parents=True, exist_ok=False)
    host_token, ai_token, cookie = (secrets.token_hex(32) for _ in range(3))
    binding = {
        "orgId": "component-fixture",
        "userId": "owner",
        "sessionId": "react-stream",
    }
    controller = "user-react-stream"
    receipts, contexts = [], {}
    input_log, point_log = [], []
    stream_events = []
    page = None
    active_context = {}
    viewer_browser = viewer = None
    web_runner = worker_runner = None
    worker = None
    stage = "setup"
    result = {
        "transport": transport,
        "accepted": False,
        "productionRouteAccepted": False,
    }

    with tempfile.TemporaryDirectory(prefix="sudowork-stream-ui-") as profile:
        async with aiohttp.ClientSession() as http:
            try:
                worker = Worker(
                    profile,
                    host_token,
                    ai_token,
                    display_mode="x11",
                    extension_directory=Path("/opt/browser/extension")
                    if transport == "extension"
                    else None,
                    chrome_args=["--no-sandbox"],
                )
                worker_runner = web.AppRunner(application(worker))
                await worker_runner.setup()
                worker_site = web.TCPSite(
                    worker_runner, "127.0.0.1", 8080 if transport == "extension" else 0
                )
                await worker_site.start()
                worker_url = f"http://127.0.0.1:{worker_site._server.sockets[0].getsockname()[1]}"

                async def host(action):
                    async with http.post(
                        worker_url + "/invoke",
                        headers={"Authorization": "Bearer " + host_token},
                        json={
                            "binding": binding,
                            "controller": controller,
                            "action": action,
                        },
                    ) as response:
                        body = await response.json()
                        assert response.status == 200, (response.status, body)
                        return body

                def epochs(state):
                    return {key: state[key] for key in ("controlEpoch", "targetEpoch")}

                def authorize(request):
                    if not hmac.compare_digest(
                        request.cookies.get("fixture_viewer", ""), cookie
                    ):
                        raise web.HTTPForbidden()
                    origin = request.headers.get("Origin")
                    if origin and origin != viewer_url:
                        raise web.HTTPForbidden()

                async def target(_request):
                    if graph_html is not None:
                        return web.Response(
                            body=graph_html.read_bytes(), content_type="text/html"
                        )
                    return web.Response(
                        content_type="text/html",
                        text="""<!doctype html><meta charset="utf-8">
                <style>body{margin:0;background:#22aa66}input,button{display:block;margin:24px;width:220px;height:40px}</style>
                <input id="name"><button id="submit">Submit once</button><pre id="receipt"></pre>
                <script>window.nativeEvents=[];window.nativeErrors=[];
                let color=0;setInterval(()=>document.body.style.background=`rgb(${30+(color++%100)},80,160)`,100);
                addEventListener('error',e=>nativeErrors.push(e.message));
                for(const kind of ['pointerdown','pointerup','mousedown','mouseup','click','keydown','input'])
                  document.addEventListener(kind,e=>nativeEvents.push({kind,id:e.target.id,x:e.clientX,y:e.clientY,trusted:e.isTrusted}),true);
                document.cookie='target_profile=isolated; SameSite=Lax';let press=null;
                submit.onmousedown=e=>press={buttons:e.buttons,trusted:e.isTrusted};
                submit.onclick=async e=>{const r=await fetch('/receipt',{method:'POST',headers:{'Content-Type':'application/json'},
                  body:JSON.stringify({name:document.querySelector('#name').value,trusted:e.isTrusted,press})});
                  receipt.textContent=JSON.stringify(await r.json())};</script>""",
                    )

                async def receipt(request):
                    value = await request.json()
                    value.update(
                        cookie=request.cookies.get("target_profile"),
                        sequence=len(receipts) + 1,
                    )
                    receipts.append(value)
                    return web.json_response(value)

                async def context(request):
                    authorize(request)
                    viewer_id = str(uuid.uuid4())
                    await host(
                        {"kind": "attach", "viewerId": viewer_id, "surface": "window"}
                    )
                    state = await worker.state(controller)
                    reply = await host(
                        {
                            "kind": "window-stream",
                            "viewerId": viewer_id,
                            **epochs(state),
                        }
                    )
                    current = {
                        "binding": binding,
                        "controller": controller,
                        "viewerId": viewer_id,
                        **epochs(reply["session"]),
                    }
                    contexts[viewer_id] = current
                    active_context.clear()
                    active_context.update(current)
                    query = f"viewerId={viewer_id}&controlEpoch={current['controlEpoch']}&targetEpoch={current['targetEpoch']}"
                    return web.json_response(
                        {
                            "viewerId": viewer_id,
                            "password": reply["stream"]["password"],
                            "socketPath": "/ws/browser/react-stream?" + query,
                            "browserSessionId": reply["session"]["browserSessionId"],
                            **epochs(reply["session"]),
                        }
                    )

                async def input_event(request):
                    authorize(request)
                    event = await request.json()
                    input_log.append(
                        {
                            key: event[key]
                            for key in ("kind", "x", "y", "key")
                            if key in event
                        }
                    )
                    return web.json_response(
                        await host(
                            {
                                "kind": "input",
                                "surface": "window",
                                "input": event,
                                **epochs(active_context),
                            }
                        )
                    )

                async def proxy(request):
                    authorize(request)
                    current = contexts.get(request.query.get("viewerId"))
                    if current is None or any(
                        request.query.get(key) != str(current[key])
                        for key in ("controlEpoch", "targetEpoch")
                    ):
                        raise web.HTTPConflict()
                    async with http.ws_connect(
                        worker_url + "/window-stream",
                        protocols=("binary",),
                        headers={
                            "Authorization": "Bearer " + host_token,
                            "X-ADB-Browser-Context": quote(json.dumps(current)),
                        },
                    ) as upstream:
                        downstream = web.WebSocketResponse(protocols=("binary",))
                        await downstream.prepare(request)

                        async def forward(source, destination):
                            async for message in source:
                                if message.type != aiohttp.WSMsgType.BINARY:
                                    break
                                stream_events.append(
                                    {
                                        "at": time.perf_counter(),
                                        "bytes": len(message.data),
                                        "towardViewer": destination is downstream,
                                    }
                                )
                                await destination.send_bytes(message.data)

                        tasks = [
                            asyncio.create_task(forward(downstream, upstream)),
                            asyncio.create_task(forward(upstream, downstream)),
                        ]
                        try:
                            await asyncio.wait(
                                tasks, return_when=asyncio.FIRST_COMPLETED
                            )
                        finally:
                            for task in tasks:
                                task.cancel()
                            await asyncio.gather(*tasks, return_exceptions=True)
                            await downstream.close()
                        return downstream

                app = web.Application()
                app.add_routes(
                    [
                        web.get("/target", target),
                        web.post("/receipt", receipt),
                        web.get("/stream-context", context),
                        web.post("/input", input_event),
                        web.get("/ws/browser/react-stream", proxy),
                        web.get(
                            "/",
                            lambda _request: web.FileResponse(assets / "index.html"),
                        ),
                    ]
                )
                app.router.add_static("/assets/", assets / "assets")
                web_runner = web.AppRunner(app)
                await web_runner.setup()
                site = web.TCPSite(web_runner, "127.0.0.1", 0)
                await site.start()
                viewer_url = (
                    f"http://127.0.0.1:{site._server.sockets[0].getsockname()[1]}"
                )
                await host({"kind": "state"})
                await worker.agent(
                    {"kind": "start", "isHeadless": False, "transport": transport}
                )
                await worker.agent(
                    {
                        "kind": "navigate",
                        "url": viewer_url + "/target",
                        **epochs(await worker.state()),
                    }
                )
                held = (await host({"kind": "take", **epochs(await worker.state())}))[
                    "session"
                ]
                page = await worker.session._connect_page()
                viewer_browser = await asyncio.to_thread(
                    browser_start,
                    headless=True,
                    temp=True,
                    silent_stderr=True,
                    extra_args=["--no-sandbox", "--window-size=1280,1000"],
                )
                assert "error" not in viewer_browser, viewer_browser
                async with http.get(
                    f"http://127.0.0.1:{viewer_browser['port']}/json/list"
                ) as response:
                    target_info = next(
                        t
                        for t in await response.json()
                        if t["id"] == viewer_browser["automation_target_id"]
                    )
                viewer = CDP(await http.ws_connect(target_info["webSocketDebuggerUrl"]))
                await viewer.call("Page.enable")
                await viewer.call(
                    "Network.setCookie",
                    {
                        "name": "fixture_viewer",
                        "value": cookie,
                        "url": viewer_url,
                        "httpOnly": True,
                        "sameSite": "Strict",
                    },
                )
                await viewer.call("Page.navigate", {"url": viewer_url})
                stage = "paint"
                await wait_for(
                    lambda: viewer.js("document.querySelector('#status')?.textContent"),
                    lambda value: value == "ready",
                )
                if graph_html is not None:
                    from live_sudograph_window_stream import verify_graph

                    stage = "real-graph"
                    result.update(
                        await verify_graph(
                            page, viewer, evidence, graph_html, stream_events
                        )
                    )
                    state = await worker.state(controller)
                    assert state["browserSessionId"] == held["browserSessionId"]
                    assert state["state"] == "human" and state["isController"]
                    result.update(
                        accepted=True,
                        actualReactAndNoVnc=True,
                        preservedBrowserAndHumanLease=True,
                    )
                    return result
                await viewer.js(
                    "("
                    + START_RENDER_SAMPLING
                    + ")(document.querySelector('canvas').parentElement)"
                )
                changes = await wait_for(
                    lambda: viewer.js("window.browserViewMeasurements"),
                    lambda samples: (
                        len(
                            [
                                sample
                                for sample in samples
                                if sample["surface"] == "canvas"
                                and abs(sample["rgb"][1] - 80) < 12
                                and abs(sample["rgb"][2] - 160) < 12
                            ]
                        )
                        >= 3
                    ),
                )
                result["observedDecodedPixelChanges"] = len(changes)
                (evidence / "first-frame.png").write_bytes(
                    base64.b64decode(
                        (await viewer.call("Page.captureScreenshot"))["data"]
                    )
                )

                async def remote_point(selector):
                    location = await page.js(
                        """(()=>{const r=document.querySelector(SELECTOR).getBoundingClientRect();return {
                    x:screenX+r.x+r.width/2,y:screenY+outerHeight-innerHeight+r.y+r.height/2}})()""".replace(
                            "SELECTOR", json.dumps(selector)
                        )
                    )
                    geometry = await viewer.js("""(()=>{const c=document.querySelector('canvas'),r=c.getBoundingClientRect();return {
                    x:r.x,y:r.y,w:r.width,h:r.height,pw:c.width,ph:c.height}})()""")
                    point = {
                        "x": geometry["x"]
                        + location["x"] * geometry["w"] / geometry["pw"],
                        "y": geometry["y"]
                        + location["y"] * geometry["h"] / geometry["ph"],
                    }
                    point_log.append(
                        {
                            "selector": selector,
                            "native": location,
                            "canvas": geometry,
                            "viewer": point,
                        }
                    )
                    return point

                stage = "trusted-input"
                await viewer.js(
                    "window.viewerEvents=[];for(const kind of ['pointerdown','pointerup','mousedown','mouseup','click'])document.addEventListener(kind,e=>viewerEvents.push({kind,tag:e.target.tagName,x:e.clientX,y:e.clientY,trusted:e.isTrusted}),true)"
                )
                await click(viewer, await remote_point("#name"))
                await viewer.call(
                    "Input.dispatchKeyEvent",
                    {"type": "keyDown", "key": "r", "code": "KeyR", "text": "r"},
                )
                await viewer.call(
                    "Input.dispatchKeyEvent",
                    {"type": "keyUp", "key": "r", "code": "KeyR"},
                )
                await wait_for(
                    lambda: page.js("document.querySelector('#name').value"),
                    lambda value: value == "r",
                )
                await click(viewer, await remote_point("#submit"))
                await wait_for(
                    lambda: asyncio.sleep(0, result=len(receipts)),
                    lambda value: value == 1,
                )
                assert receipts[0] == {
                    "name": "r",
                    "trusted": True,
                    "press": {"buttons": 1, "trusted": True},
                    "cookie": "isolated",
                    "sequence": 1,
                }

                stage = "gesture-rebind"
                await click(viewer, await element_center(viewer, "button"))
                await wait_for(
                    lambda: viewer.js(
                        "document.querySelector('button').getAttribute('aria-pressed')"
                    ),
                    lambda value: value == "true",
                )
                await wait_for(
                    lambda: viewer.js("document.querySelector('#status').textContent"),
                    lambda value: value == "ready",
                )
                stage = "disabled-input"
                await click(
                    viewer, await element_center(viewer, "input[type=checkbox]")
                )
                await wait_for(
                    lambda: viewer.js(
                        "getComputedStyle(document.querySelector('canvas')).pointerEvents"
                    ),
                    lambda value: value == "none",
                )
                await click(viewer, await remote_point("#submit"))
                assert len(receipts) == 1
                await click(
                    viewer, await element_center(viewer, "input[type=checkbox]")
                )
                await wait_for(
                    lambda: viewer.js(
                        "getComputedStyle(document.querySelector('canvas')).pointerEvents"
                    ),
                    lambda value: value == "auto",
                )

                stage = "zoom"
                await click(viewer, await element_center(viewer, "select"))
                for key, code, virtual in [("End", "End", 35), ("Enter", "Enter", 13)]:
                    for phase in ("keyDown", "keyUp"):
                        await viewer.call(
                            "Input.dispatchKeyEvent",
                            {
                                "type": phase,
                                "key": key,
                                "code": code,
                                "windowsVirtualKeyCode": virtual,
                            },
                        )
                await wait_for(
                    lambda: viewer.js("document.querySelector('select').value"),
                    lambda value: value == "1.5",
                )
                await click(viewer, await remote_point("#submit"))
                await wait_for(
                    lambda: asyncio.sleep(0, result=len(receipts)),
                    lambda value: value == 2,
                )
                assert all(
                    value["trusted"] and value["cookie"] == "isolated"
                    for value in receipts
                )
                state = await worker.state(controller)
                assert (
                    state["browserSessionId"] == held["browserSessionId"]
                    and state["state"] == "human"
                    and state["isController"]
                )
                (evidence / "zoomed-input.png").write_bytes(
                    base64.b64decode(
                        (await viewer.call("Page.captureScreenshot"))["data"]
                    )
                )
                stage = "reconnect"
                boot = await viewer.js("document.documentElement.dataset.streamBoot")
                await viewer.call("Page.reload")
                await wait_for(
                    lambda: viewer.js(
                        "({boot:document.documentElement.dataset.streamBoot,status:document.querySelector('#status')?.textContent})"
                    ),
                    lambda value: (
                        bool(value.get("boot"))
                        and value["boot"] != boot
                        and value.get("status") == "ready"
                    ),
                )
                state = await worker.state(controller)
                assert (
                    state["browserSessionId"] == held["browserSessionId"]
                    and state["isController"]
                )
                assert "target_profile=isolated" in await page.js("document.cookie")
                assert len(receipts) == 2
                (evidence / "reconnected.png").write_bytes(
                    base64.b64decode(
                        (await viewer.call("Page.captureScreenshot"))["data"]
                    )
                )
                result.update(
                    accepted=True,
                    exactTrustedSubmissions=2,
                    gestureRebind=True,
                    disabledInputBlocked=True,
                    zoom150Mapped=True,
                    preservedBrowserAndHumanLease=True,
                    actualReactAndNoVnc=True,
                    reconnectedSameBrowser=True,
                )
            except BaseException as error:
                result.update(
                    stage=stage, errorType=type(error).__name__, error=str(error)[:500]
                )
                if viewer:
                    try:
                        diagnostics = {"inputs": input_log, "points": point_log}
                        if page:
                            diagnostics["target"] = await page.js(
                                "({events:window.nativeEvents,errors:window.nativeErrors,handler:typeof document.querySelector('#submit')?.onclick,active:document.activeElement?.id})"
                            )
                        diagnostics["viewer"] = await viewer.js(
                            "({events:window.viewerEvents,status:document.querySelector('#status')?.textContent})"
                        )
                        (evidence / "diagnostics.json").write_text(
                            json.dumps(diagnostics, indent=2), encoding="utf-8"
                        )
                        (evidence / "failure.png").write_bytes(
                            base64.b64decode(
                                (await viewer.call("Page.captureScreenshot"))["data"]
                            )
                        )
                    except Exception:
                        pass
                raise
            finally:
                cleanup_errors = []
                if viewer:
                    try:
                        await viewer.close()
                    except Exception as error:
                        cleanup_errors.append(type(error).__name__)
                if viewer_browser:
                    try:
                        stopped = await asyncio.to_thread(
                            browser_stop, session_id=viewer_browser["session_id"]
                        )
                        result["viewerStopped"] = stopped.get("stopped") is True
                        if not result["viewerStopped"]:
                            cleanup_errors.append("viewer_stop_unconfirmed")
                    except Exception as error:
                        cleanup_errors.append(type(error).__name__)
                for runner in (web_runner, worker_runner):
                    if runner:
                        try:
                            await runner.cleanup()
                        except Exception as error:
                            cleanup_errors.append(type(error).__name__)
                result["ownedServicesClosed"] = not cleanup_errors
                result["cleanupErrors"] = cleanup_errors
                result["accepted"] = result["accepted"] and not cleanup_errors
                (evidence / "receipt.json").write_text(
                    json.dumps(result, indent=2), encoding="utf-8"
                )
                if cleanup_errors:
                    raise AssertionError(f"Owned cleanup incomplete: {cleanup_errors}")
    return result


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--assets", type=Path, required=True)
    parser.add_argument("--evidence", type=Path, required=True)
    parser.add_argument(
        "--graph-html",
        type=Path,
        help="Actual compiled Sudograph HTML for graph interaction and pixel timing",
    )
    parser.add_argument(
        "--transport", choices=("cdp", "extension", "both"), default="both"
    )
    args = parser.parse_args()
    assert (args.assets / "index.html").is_file()
    assert args.graph_html is None or args.graph_html.is_file()
    transports = ("cdp", "extension") if args.transport == "both" else (args.transport,)
    try:
        for transport in transports:
            result = await run_case(
                args.assets, args.evidence / transport, transport, args.graph_html
            )
            print(json.dumps(result), flush=True)
    finally:
        args.evidence.mkdir(parents=True, exist_ok=True)
        metrics = {}
        for name in ("pids.peak", "pids.events", "memory.events"):
            source = Path("/sys/fs/cgroup") / name
            if source.is_file():
                metrics[name] = source.read_text()
        (args.evidence / "resources.json").write_text(
            json.dumps(metrics), encoding="utf8"
        )


if __name__ == "__main__":
    asyncio.run(main())
