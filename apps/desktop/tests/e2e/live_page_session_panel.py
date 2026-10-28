"""Real shared BrowserSessionPanel, checked worker input and mid-drag disconnect.

This isolated host supplies authentication only. The session, profile, targets,
gestures and decoded page pixels come from the installed browser worker.
"""

import argparse
import asyncio
import base64
import hmac
import json
from pathlib import Path
import secrets
import tempfile
import time

import aiohttp
from aiohttp import web

from ai_dev_browser.core.browser import browser_start, browser_stop
from ai_dev_browser.remote.cdp import CDP
from ai_dev_browser.remote.worker import Worker, application
from live_window_stream_surface import wait_for


async def run_case(assets, evidence, transport):
    evidence.mkdir(parents=True, exist_ok=False)
    host_token, ai_token, cookie = (secrets.token_hex(32) for _ in range(3))
    binding = {
        "orgId": "page-panel-fixture",
        "userId": "owner",
        "sessionId": "page-panel-live",
    }
    controller = "user-page-panel"
    worker_runner = viewer_runner = viewer_browser = viewer = None
    actions = []
    proof = {
        "transport": transport,
        "accepted": False,
        "productionRouteAccepted": False,
    }
    with tempfile.TemporaryDirectory(prefix="sudowork-page-panel-") as profile:
        worker = Worker(
            profile,
            host_token,
            ai_token,
            extension_directory=Path("/opt/browser/extension")
            if transport == "extension"
            else None,
            chrome_args=["--no-sandbox"],
        )
        async with aiohttp.ClientSession() as http:

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
                    value = await response.json()
                    assert response.status == 200, (response.status, value)
                    return value

            async def source():
                return await (await worker.session._connect_page()).js(
                    "({pan,events:panEvents})"
                )

            async def start_viewer():
                nonlocal viewer_browser, viewer
                viewer_browser = await asyncio.to_thread(
                    browser_start,
                    headless=True,
                    stealth=False,
                    extra_args=["--no-sandbox", "--window-size=1400,1100"],
                )
                async with http.get(
                    f"http://127.0.0.1:{viewer_browser['port']}/json/list"
                ) as response:
                    tabs = await response.json()
                tab = next(
                    tab
                    for tab in tabs
                    if tab["id"] == viewer_browser["automation_target_id"]
                )
                viewer = CDP(await http.ws_connect(tab["webSocketDebuggerUrl"]))
                await viewer.call("Page.enable")
                await viewer.call("Page.bringToFront")
                await viewer.call(
                    "Network.setCookie",
                    {
                        "name": "page_panel_fixture",
                        "value": cookie,
                        "url": viewer_url,
                        "httpOnly": True,
                        "sameSite": "Strict",
                    },
                )
                await viewer.call("Page.navigate", {"url": viewer_url})
                return await wait_for(
                    lambda: viewer.js(
                        """(()=>{const i=document.querySelector('img');if(!i?.complete||!i.naturalWidth)return null;const r=i.getBoundingClientRect();return r.width&&r.height?{x:r.x,y:r.y,width:r.width,height:r.height,w:i.naturalWidth,h:i.naturalHeight}:null})()"""
                    )
                )

            try:
                worker_runner = web.AppRunner(application(worker))
                await worker_runner.setup()
                worker_site = web.TCPSite(
                    worker_runner, "127.0.0.1", 8080 if transport == "extension" else 0
                )
                await worker_site.start()
                worker_url = f"http://127.0.0.1:{worker_site._server.sockets[0].getsockname()[1]}"

                @web.middleware
                async def authorize(request, handler):
                    if not hmac.compare_digest(
                        request.cookies.get("page_panel_fixture", ""), cookie
                    ):
                        raise web.HTTPForbidden()
                    origin = request.headers.get("Origin")
                    if origin and origin != viewer_url:
                        raise web.HTTPForbidden()
                    return await handler(request)

                async def browser_host(request):
                    value = await request.json()
                    assert value["conversationId"] == binding["sessionId"]
                    action = value["action"]
                    entry = {
                        "kind": action["kind"],
                        "startedAt": time.perf_counter(),
                        "input": action.get("input"),
                    }
                    actions.append(entry)
                    reply = await host(action)
                    entry["acknowledgedAt"] = time.perf_counter()
                    # Same host capability enrichment as the real Moss gateway.
                    reply["session"]["capabilities"]["conversationControl"] = True
                    return web.json_response(reply)

                async def target(_request):
                    return web.Response(
                        content_type="text/html",
                        text="""<!doctype html>
                    <style>body{margin:24px}canvas{display:block;background:#17212b;touch-action:none}</style>
                    <canvas id="stage" width="600" height="300"></canvas><script>
                    window.pan={x:0,y:0};window.panEvents=[];let gesture;
                    const ctx=stage.getContext('2d');function draw(){ctx.clearRect(0,0,600,300);ctx.fillStyle='#66bb99';ctx.fillRect(200+pan.x,120+pan.y,100,60)}draw();
                    for(const kind of ['pointerdown','pointermove','pointerup'])stage.addEventListener(kind,e=>{
                      panEvents.push({kind:e.type,trusted:e.isTrusted,buttons:e.buttons});
                      if(kind==='pointerdown'){gesture={x:e.clientX,y:e.clientY,ox:pan.x,oy:pan.y,armed:false};return}
                      if(kind==='pointerup'){gesture=null;return}if(!gesture)return;
                      const dx=e.clientX-gesture.x,dy=e.clientY-gesture.y;
                      if(!gesture.armed){if(Math.hypot(dx,dy)>8)gesture.armed=true;return}
                      pan={x:gesture.ox+dx,y:gesture.oy+dy};draw();
                    });</script>""",
                    )

                app = web.Application(middlewares=[authorize])
                app.add_routes(
                    [
                        web.get(
                            "/",
                            lambda _request: web.FileResponse(assets / "index.html"),
                        ),
                        web.post("/api/browser", browser_host),
                    ]
                )
                app.router.add_static("/assets/", assets / "assets")
                viewer_runner = web.AppRunner(app)
                await viewer_runner.setup()
                viewer_site = web.TCPSite(viewer_runner, "127.0.0.1", 0)
                await viewer_site.start()
                viewer_url = f"http://127.0.0.1:{viewer_site._server.sockets[0].getsockname()[1]}"
                # Target and viewer have separate browser profiles/origins;
                # only the viewer has the fixture's HttpOnly host cookie.
                target_app = web.Application()
                target_app.add_routes([web.get("/", target)])
                target_runner = web.AppRunner(target_app)
                await target_runner.setup()
                target_site = web.TCPSite(target_runner, "127.0.0.1", 0)
                await target_site.start()
                state = (
                    await host(
                        {"kind": "start", "isHeadless": True, "transport": transport}
                    )
                )["session"]
                state = (
                    await host(
                        {
                            "kind": "navigate",
                            "url": f"http://127.0.0.1:{target_site._server.sockets[0].getsockname()[1]}/",
                            "controlEpoch": state["controlEpoch"],
                            "targetEpoch": state["targetEpoch"],
                        }
                    )
                )["session"]
                assert "page" in state["capabilities"].get("liveDragSurfaces", []), (
                    "Install the released SDK with page drag support before running this consumer acceptance"
                )
                assert worker.display is None
                rect = await start_viewer()

                async def pointer(kind, x, y):
                    await viewer.call(
                        "Input.dispatchMouseEvent",
                        {
                            "type": kind,
                            "x": rect["x"] + x * rect["width"] / rect["w"],
                            "y": rect["y"] + y * rect["height"] / rect["h"],
                            "button": "left",
                            "buttons": 0 if kind == "mouseReleased" else 1,
                            **({"clickCount": 1} if kind != "mouseMoved" else {}),
                        },
                    )

                await pointer("mouseMoved", 500, 250)
                await pointer("mousePressed", 500, 250)
                started = await viewer.js("performance.now()")
                await pointer("mouseMoved", 400, 200)
                visible = await wait_for(
                    lambda: viewer.js(
                        """(()=>{const i=document.querySelector('img');if(!i?.complete||!i.naturalWidth)return null;const c=document.createElement('canvas');c.width=i.naturalWidth;c.height=i.naturalHeight;const x=c.getContext('2d');x.drawImage(i,0,0);return Array.from(x.getImageData(140,110,1,1).data).slice(0,3)})()"""
                    ),
                    lambda rgb: rgb
                    and all(abs(a - b) < 12 for a, b in zip(rgb, (102, 187, 153))),
                )
                proof["motionToVisibleUpperBoundMs"] = (
                    await viewer.js("performance.now()")
                ) - started
                held = await source()
                assert (
                    abs(held["pan"]["x"] + 100) < 0.0001
                    and abs(held["pan"]["y"] + 50) < 0.0001
                )
                assert all(e["trusted"] for e in held["events"]) and not any(
                    e["kind"] == "pointerup" for e in held["events"]
                )
                proof.update(decodedPixelWhilePressed=visible, sourceWhilePressed=held)
                (evidence / "panel-drag-held.png").write_bytes(
                    base64.b64decode(
                        (await viewer.call("Page.captureScreenshot"))["data"]
                    )
                )
                await pointer("mouseReleased", 400, 200)
                await wait_for(
                    source,
                    lambda value: sum(e["kind"] == "pointerup" for e in value["events"])
                    == 1,
                )
                # Source release precedes the checked HTTP response. Match
                # the mapper's acknowledgement barrier before the next drag.
                await wait_for(
                    lambda: viewer.js(
                        "document.documentElement.dataset.lastInputAcknowledgement === 'end'"
                    )
                )
                await pointer("mousePressed", 500, 250)
                await pointer("mouseMoved", 450, 225)
                await wait_for(
                    source, lambda value: abs(value["pan"]["x"] + 150) < 0.0001
                )
                await viewer.close()
                viewer = None
                stopped = await asyncio.to_thread(
                    browser_stop, session_id=viewer_browser["session_id"]
                )
                assert stopped.get("stopped") is True, stopped
                viewer_browser = None
                await wait_for(
                    source,
                    lambda value: sum(e["kind"] == "pointerup" for e in value["events"])
                    == 2,
                )
                after = (await host({"kind": "state"}))["session"]
                assert (
                    after["isController"]
                    and after["state"] == "human"
                    and after["isHumanControlHeld"]
                )
                assert (
                    after["browserSessionId"] == state["browserSessionId"]
                    and after["profileId"] == state["profileId"]
                )
                assert after["controlEpoch"] > state["controlEpoch"]
                rect = await start_viewer()
                assert (await host({"kind": "state"}))["session"][
                    "browserSessionId"
                ] == state["browserSessionId"]
                (evidence / "panel-reconnected.png").write_bytes(
                    base64.b64decode(
                        (await viewer.call("Page.captureScreenshot"))["data"]
                    )
                )
                proof.update(
                    accepted=True,
                    humanLeasePreserved=True,
                    sameBrowserOnReconnect=True,
                    disconnectedPressReleased=True,
                )
            except Exception:
                if viewer:
                    (evidence / "failure.png").write_bytes(
                        base64.b64decode(
                            (await viewer.call("Page.captureScreenshot"))["data"]
                        )
                    )
                raise
            finally:
                proof["actions"] = actions
                (evidence / "receipt.json").write_text(json.dumps(proof, indent=2))
                if viewer:
                    await viewer.close()
                if viewer_browser:
                    await asyncio.to_thread(
                        browser_stop, session_id=viewer_browser["session_id"]
                    )
                if viewer_runner:
                    await viewer_runner.cleanup()
                if worker_runner:
                    await worker_runner.cleanup()
                if "target_runner" in locals():
                    await target_runner.cleanup()
    print(json.dumps({"transport": transport, "accepted": proof["accepted"]}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--assets", type=Path, required=True)
    parser.add_argument("--evidence", type=Path, required=True)
    parser.add_argument(
        "--transport", choices=["cdp", "extension", "both"], default="both"
    )
    args = parser.parse_args()
    for transport in (
        ["cdp", "extension"] if args.transport == "both" else [args.transport]
    ):
        asyncio.run(run_case(args.assets, args.evidence / transport, transport))
