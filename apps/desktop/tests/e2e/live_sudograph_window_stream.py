"""Read actual Cytoscape state while inputs travel through the shared viewer.

The graph API is an observation oracle. Every pan and zoom is dispatched through
the real React/noVNC surface and checked host input. Timings use separate page,
viewer and proxy clocks; they are not subtracted across clock domains.
"""

import asyncio
import base64
import hashlib
import json
import time


GRAPH = """(()=>{const el=[...document.querySelectorAll('div')].find(e=>e._cyreg?.cy);
if(!el)return null;const cy=el._cyreg.cy,r=el.getBoundingClientRect();
const candidates=cy.nodes().filter(n=>{const p=n.renderedPosition();return !n.isParent()&&p.x>20&&p.y>20&&p.x<r.width-20&&p.y<r.height-20;});
const focus=candidates.filter(n=>/orders/i.test(n.id()+' '+String(n.data('label')||''))).first()||candidates.first();
const chosen=focus?.length?focus:candidates.first(),p=chosen?.length?chosen.renderedPosition():null;
return {pan:cy.pan(),zoom:cy.zoom(),nodes:cy.nodes().length,edges:cy.edges().length,
focus:p?{id:chosen.id(),x:r.x+p.x,y:r.y+p.y}:null,
rect:{x:r.x,y:r.y,w:r.width,h:r.height},
offset:{x:screenX+(outerWidth-innerWidth)/2,y:screenY+outerHeight-innerHeight-(outerWidth-innerWidth)/2},
events:window.graphInputMeasurements||[]}})()"""

SAMPLE = """bounds=>{window.graphPixelMeasurements=[];let last;
const probe=document.createElement('canvas');probe.width=probe.height=48;
const context=probe.getContext('2d',{willReadFrequently:true});
function sample(){const source=document.querySelector('canvas');if(source?.width){
context.drawImage(source,bounds.x,bounds.y,bounds.w,bounds.h,0,0,48,48);
let hash=2166136261;for(const byte of context.getImageData(0,0,48,48).data)
hash=Math.imul(hash^byte,16777619);hash>>>=0;
if(hash!==last){window.graphPixelMeasurements.push({at:performance.now(),hash});last=hash;}}
window.graphSampleAnimation=requestAnimationFrame(sample);}sample();} """


async def wait_for(operation, predicate=bool, timeout=30):
    deadline = time.monotonic() + timeout
    while True:
        value = await operation()
        if predicate(value):
            return value
        assert time.monotonic() < deadline, (
            "Actual graph or changed decoded pixels did not arrive"
        )
        await asyncio.sleep(0.05)


async def screenshot(viewer, destination):
    destination.write_bytes(
        base64.b64decode((await viewer.call("Page.captureScreenshot"))["data"])
    )


async def matching_graph_pixels(page, viewer, state, bounds, evidence, label):
    rect = state["rect"]
    # Clipped source capture can disturb this headful Chrome's compositor.
    # Capture its complete viewport, then crop only the measurement image.
    captured = await page.call(
        "Page.captureScreenshot", {"format": "png", "captureBeyondViewport": False}
    )
    (evidence / (label + "-source.png")).write_bytes(base64.b64decode(captured["data"]))
    await viewer.js(
        """(async()=>{const image=new Image();image.src=SOURCE;await image.decode();
    window.graphPreviousReferenceImage=window.graphReferenceImage||null;
    window.graphReferenceImage=image;return true})()""".replace(
            "SOURCE", json.dumps("data:image/png;base64," + captured["data"])
        )
    )
    expression = (
        """(()=>{const n=64,probe=document.createElement('canvas');probe.width=probe.height=n;
    const ctx=probe.getContext('2d',{willReadFrequently:true}),r=SOURCE_RECT;
    ctx.drawImage(graphReferenceImage,r.x,r.y,r.w,r.h,0,0,n,n);
    const expected=ctx.getImageData(0,0,n,n).data,counts=new Map();let previous;
    if(window.graphPreviousReferenceImage){ctx.clearRect(0,0,n,n);ctx.drawImage(graphPreviousReferenceImage,r.x,r.y,r.w,r.h,0,0,n,n);previous=ctx.getImageData(0,0,n,n).data;}
    const correlate=(left,right)=>{let l=0,r=0,ll=0,rr=0,lr=0;for(let i=0;i<left.length;i+=4){
    const a=(left[i]+left[i+1]+left[i+2])/3,b=(right[i]+right[i+1]+right[i+2])/3;
    l+=a;r+=b;ll+=a*a;rr+=b*b;lr+=a*b;}return (n*n*lr-l*r)/Math.sqrt((n*n*ll-l*l)*(n*n*rr-r*r));};
    for(let i=0;i<expected.length;i+=4){const key=[expected[i],expected[i+1],expected[i+2]].join(',');counts.set(key,(counts.get(key)||0)+1);}
    const background=[...[...counts].sort((a,b)=>b[1]-a[1])[0][0].split(',').map(Number)];
    const b=BOUNDS,canvas=document.querySelector('canvas'),radius=CALIBRATE?8:0;let best;
    for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){
    ctx.clearRect(0,0,n,n);ctx.drawImage(canvas,b.x+dx,b.y+dy,b.w,b.h,0,0,n,n);
    const actual=ctx.getImageData(0,0,n,n).data;let foreground=0,matched=0,error=0,sumE=0,sumA=0,sumEE=0,sumAA=0,sumEA=0;
    for(let i=0;i<expected.length;i+=4){
    const e=(expected[i]+expected[i+1]+expected[i+2])/3,a=(actual[i]+actual[i+1]+actual[i+2])/3;
    sumE+=e;sumA+=a;sumEE+=e*e;sumAA+=a*a;sumEA+=e*a;
    if(Math.max(...background.map((value,c)=>Math.abs(expected[i+c]-value)))<18)continue;
    foreground++;const delta=[0,1,2].map(c=>Math.abs(expected[i+c]-actual[i+c]));
    error+=delta.reduce((a,b)=>a+b,0)/3;if(Math.max(...delta)<=25)matched++;}
    const sample={foregroundPixels:foreground,matchedRatio:foreground?matched/foreground:0,
    meanForegroundError:foreground?error/foreground:255,offsetX:dx,offsetY:dy,
    luminanceCorrelation:(n*n*sumEA-sumE*sumA)/Math.sqrt((n*n*sumEE-sumE*sumE)*(n*n*sumAA-sumA*sumA)),
    previousFrameCorrelation:previous?correlate(previous,actual):null};
    if(!best||sample.luminanceCorrelation>best.luminanceCorrelation)best=sample;}
    return {at:performance.now(),...best,viewerUrl:location.href,
    canvas:{width:canvas.width,height:canvas.height,label:canvas.getAttribute('aria-label')},bounds:b}})()""".replace(
            "BOUNDS", json.dumps(bounds)
        )
        .replace("CALIBRATE", "true" if label == "initial" else "false")
        .replace("SOURCE_RECT", json.dumps(rect))
    )

    last_export = 0.0

    async def observe():
        nonlocal last_export
        value = await viewer.js(expression)
        crop_path = evidence / (label + "-decoded-crop.png")
        if not crop_path.exists() or time.monotonic() - last_export > 3:
            crop = {
                **bounds,
                "x": bounds["x"] + value["offsetX"],
                "y": bounds["y"] + value["offsetY"],
            }
            encoded = await viewer.js(
                """(()=>{const b=BOUNDS,c=document.createElement('canvas');
            c.width=Math.ceil(b.w);c.height=Math.ceil(b.h);c.getContext('2d').drawImage(document.querySelector('canvas'),b.x,b.y,b.w,b.h,0,0,c.width,c.height);
            return c.toDataURL('image/png').split(',')[1]})()""".replace(
                    "BOUNDS", json.dumps(crop)
                )
            )
            crop_path.write_bytes(base64.b64decode(encoded))
            last_export = time.monotonic()
        (evidence / (label + "-pixel-match.json")).write_text(
            json.dumps(value, indent=2), encoding="utf8"
        )
        return value

    # Cross-compositor screenshots have different text/color rasterization.
    # Compare normalized image structure, and require each changed graph to
    # reject its preceding real frame. Keep raw color differences diagnostic.
    return await wait_for(
        observe,
        lambda value: (
            value["foregroundPixels"] >= 30
            and value["luminanceCorrelation"] >= 0.9
            and (
                label not in ("pan", "pan-held", "zoom")
                or value["luminanceCorrelation"] - value["previousFrameCorrelation"]
                >= 0.15
            )
        ),
    )


async def verify_graph(page, viewer, evidence, graph_html, stream_events):
    initial = await wait_for(lambda: page.js(GRAPH))
    assert initial["nodes"] > 1 and initial["edges"] > 0, (
        "Require an actual compiled graph with relationships"
    )
    (evidence / "graph-initial-state.json").write_text(
        json.dumps(initial, indent=2), encoding="utf8"
    )
    metadata = {}
    for name, connection in (("target", page), ("viewer", viewer)):
        metadata[
            name
        ] = await connection.js("""({url:location.href,title:document.title,
        innerWidth,innerHeight,outerWidth,outerHeight,devicePixelRatio,
        canvases:[...document.querySelectorAll('canvas')].map(c=>({width:c.width,height:c.height,label:c.getAttribute('aria-label')}))})""")
    (evidence / "graph-document-metadata.json").write_text(
        json.dumps(metadata, indent=2), encoding="utf8"
    )
    await page.js("""(()=>{const cy=[...document.querySelectorAll('div')].find(e=>e._cyreg?.cy)._cyreg.cy;
    window.graphInputMeasurements=[];for(const kind of ['pointerdown','pointermove','pointerup','wheel'])
    document.addEventListener(kind,e=>graphInputMeasurements.push({kind:e.type,at:performance.now(),trusted:e.isTrusted}),true);
    cy.on('pan zoom render',e=>graphInputMeasurements.push({kind:e.type,at:performance.now()}));return true})()""")
    bounds = {
        "x": initial["offset"]["x"] + initial["rect"]["x"],
        "y": initial["offset"]["y"] + initial["rect"]["y"],
        "w": initial["rect"]["w"],
        "h": initial["rect"]["h"],
    }
    await viewer.js("(" + SAMPLE + ")(" + json.dumps(bounds) + ")")
    await wait_for(lambda: viewer.js("window.graphPixelMeasurements.length"))
    calibration = await matching_graph_pixels(
        page, viewer, initial, bounds, evidence, "initial"
    )
    # Chrome/WM borders need not equal half outerWidth-innerWidth. Calibrate
    # that fixed display offset once before input, then freeze it for every
    # later image comparison; never align away a pan or zoom discrepancy.
    bounds["x"] += calibration["offsetX"]
    bounds["y"] += calibration["offsetY"]
    await viewer.js("cancelAnimationFrame(window.graphSampleAnimation)")
    await viewer.js("(" + SAMPLE + ")(" + json.dumps(bounds) + ")")
    await screenshot(viewer, evidence / "graph-initial.png")

    async def point(x, y):
        geometry = await viewer.js("""(()=>{const c=document.querySelector('canvas'),r=c.getBoundingClientRect();
        return {x:r.x,y:r.y,w:r.width,h:r.height,pw:c.width,ph:c.height}})()""")
        return {
            "x": geometry["x"] + x * geometry["w"] / geometry["pw"],
            "y": geometry["y"] + y * geometry["h"] / geometry["ph"],
        }

    actions = []
    for kind in ("pan", "zoom"):
        held_match = None
        before = await page.js(GRAPH)
        started = await viewer.js(
            "({at:performance.now(),pixel:window.graphPixelMeasurements.at(-1)})"
        )
        proxy_start = time.perf_counter()
        if kind == "zoom":
            assert before["focus"], (
                "Locate an actual visible graph object before zooming"
            )
            x = before["offset"]["x"] + before["focus"]["x"]
            y = before["offset"]["y"] + before["focus"]["y"]
        else:
            x = before["offset"]["x"] + before["rect"]["x"] + before["rect"]["w"] * 0.9
            y = before["offset"]["y"] + before["rect"]["y"] + before["rect"]["h"] * 0.9
        start = await point(x, y)
        await viewer.call("Input.dispatchMouseEvent", {"type": "mouseMoved", **start})
        if kind == "pan":
            await viewer.call(
                "Input.dispatchMouseEvent",
                {
                    "type": "mousePressed",
                    **start,
                    "button": "left",
                    "buttons": 1,
                    "clickCount": 1,
                },
            )
            for step in range(1, 11):
                current = await point(x - step * 10, y - step * 5)
                await viewer.call(
                    "Input.dispatchMouseEvent",
                    {"type": "mouseMoved", **current, "button": "left", "buttons": 1},
                )
                await asyncio.sleep(0.03)
            held = await wait_for(
                lambda: page.js(GRAPH),
                lambda value: (
                    abs(value["pan"]["x"] - before["pan"]["x"] + 100) < 2
                    and abs(value["pan"]["y"] - before["pan"]["y"] + 50) < 2
                ),
            )
            assert not any(
                event["kind"] == "pointerup"
                for event in held["events"][len(before["events"]) :]
            ), "Require graph motion while the native pointer remains pressed"
            held_match = await matching_graph_pixels(
                page, viewer, held, bounds, evidence, "pan-held"
            )
            await screenshot(viewer, evidence / "graph-pan-before-release.png")
            await viewer.call(
                "Input.dispatchMouseEvent",
                {
                    "type": "mouseReleased",
                    **current,
                    "button": "left",
                    "buttons": 0,
                    "clickCount": 1,
                },
            )
        else:
            await viewer.call(
                "Input.dispatchMouseEvent",
                {"type": "mouseWheel", **start, "deltaX": 0, "deltaY": -160},
            )
        dispatched = await viewer.js("performance.now()")

        async def observe_action():
            observed = await page.js(GRAPH)
            (evidence / ("graph-" + kind + "-observed.json")).write_text(
                json.dumps({"before": before, "observed": observed}, indent=2),
                encoding="utf8",
            )
            return observed

        # A drag is acknowledged after its paced native movement. Do not
        # mistake its first intermediate pan for the completed gesture.
        if kind == "pan":
            after = await wait_for(
                observe_action,
                lambda value: (
                    abs(value["pan"]["x"] - before["pan"]["x"] + 100) < 2
                    and abs(value["pan"]["y"] - before["pan"]["y"] + 50) < 2
                ),
            )
        else:
            after = await wait_for(
                observe_action, lambda value: value["zoom"] > before["zoom"]
            )
        if kind == "pan":
            assert abs(after["pan"]["x"] - before["pan"]["x"] + 100) < 15
            assert abs(after["pan"]["y"] - before["pan"]["y"] + 50) < 15
        else:
            assert after["zoom"] > before["zoom"], "The actual graph did not zoom in"
        stable_key = None
        stable_samples = 0

        def is_stable(value):
            nonlocal stable_key, stable_samples
            key = (value["pan"]["x"], value["pan"]["y"], value["zoom"])
            stable_samples = stable_samples + 1 if key == stable_key else 1
            stable_key = key
            return stable_samples >= 4

        after = await wait_for(observe_action, is_stable)
        matched = held_match or await matching_graph_pixels(
            page, viewer, after, bounds, evidence, kind
        )
        pixels = await wait_for(
            lambda: viewer.js("window.graphPixelMeasurements"),
            lambda values: any(
                p["at"] >= started["at"] and p["hash"] != started["pixel"]["hash"]
                for p in values
            ),
        )
        changed = [
            p
            for p in pixels
            if p["at"] >= started["at"] and p["hash"] != started["pixel"]["hash"]
        ]
        native = after["events"][len(before["events"]) :]
        trusted = [event for event in native if "trusted" in event]
        assert trusted and all(event["trusted"] for event in trusted), (
            "Require actual trusted Chrome input"
        )
        renders = [
            event
            for event in native
            if event["kind"] == "render" and event["at"] >= trusted[0]["at"]
        ]
        assert renders, "Require actual graph render after input"

        async def payloads():
            return [
                event
                for event in stream_events
                if event["towardViewer"] and event["at"] >= proxy_start
            ]

        chunks = await wait_for(payloads)
        action = {
            "kind": kind,
            "verifiedChangedPixelsBeforePointerRelease": held_match is not None,
            "zoomFocusObject": before["focus"]["id"] if kind == "zoom" else None,
            "before": {key: before[key] for key in ("pan", "zoom")},
            "after": {key: after[key] for key in ("pan", "zoom")},
            "viewerInputToChangedPixelsMs": round(changed[0]["at"] - started["at"], 2),
            "viewerInputToVerifiedFinalPixelsUpperBoundMs": round(
                matched["at"] - started["at"], 2
            ),
            "finalPixelMatch": matched,
            "inputDispatchMs": round(dispatched - started["at"], 2),
            "pageInputToFirstGraphRenderMs": round(
                renders[0]["at"] - trusted[0]["at"], 2
            ),
            "distinctDecodedGraphFrames": len(changed),
            "nativeInputEvents": len(trusted),
            "rfbPayloadBytes": sum(event["bytes"] for event in chunks),
            "proxyWaitToFirstPayloadMs": round(
                (chunks[0]["at"] - proxy_start) * 1000, 2
            ),
        }
        actions.append(action)
        (evidence / "graph-actions.json").write_text(
            json.dumps(actions, indent=2), encoding="utf8"
        )
        await screenshot(viewer, evidence / ("graph-" + kind + ".png"))

    before_reload = await page.js(GRAPH)
    boot = await viewer.js("document.documentElement.dataset.streamBoot")
    await viewer.call("Page.reload")
    await wait_for(
        lambda: viewer.js(
            "({boot:document.documentElement.dataset.streamBoot,status:document.querySelector('#status')?.textContent})"
        ),
        lambda value: value.get("boot") != boot and value.get("status") == "ready",
    )
    after_reload = await page.js(GRAPH)
    assert (
        before_reload["pan"] == after_reload["pan"]
        and before_reload["zoom"] == after_reload["zoom"]
    )
    await matching_graph_pixels(
        page, viewer, after_reload, bounds, evidence, "reconnected"
    )
    await screenshot(viewer, evidence / "graph-reconnected.png")
    return {
        "actualCompiledSudograph": True,
        "graphSourceSha256": hashlib.sha256(graph_html.read_bytes()).hexdigest(),
        "graphNodes": initial["nodes"],
        "graphEdges": initial["edges"],
        "graphActions": actions,
        "viewerReloadPreservedGraphState": True,
        "graphApiUsedOnlyForObservation": True,
        "fixedInitialDisplayCalibration": calibration,
        "finalPixelsMatchedActualChromeScreenshot": True,
        "pixelTimingIncludesReadOnlyMeasurementOverhead": True,
        "sourceCaptureClipUsed": False,
        "latencyScope": "Local isolated component and native graph; production network, comment delivery and phone remain separate",
    }
