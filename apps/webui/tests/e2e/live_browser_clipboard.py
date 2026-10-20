"""Actual clipboard and Chromium composition through the authenticated viewer."""

import asyncio
import time


def fixture_html(phrase):
    return (
        '<span id="review-phrase" style="position:absolute;left:40px;top:280px;'
        'font:20px monospace;white-space:pre">'
        + phrase
        + "</span>"
        + """<textarea id="clipboard-field" style="position:absolute;left:40px;top:350px;width:500px;height:70px;font:20px monospace"></textarea>
<button id="clipboard-submit" style="top:460px">Submit multiline once</button>
<div id="clipboard-feedback" style="position:absolute;left:600px;top:350px;width:24px;height:24px;background:rgb(0,0,0)"></div>
<script>
const phrase=document.querySelector('#review-phrase'), area=document.querySelector('#clipboard-field');
requestAnimationFrame(()=>{const r=phrase.getBoundingClientRect();fetch('/selection-layout',{method:'POST',body:JSON.stringify({x:r.x,y:r.y,width:r.width,height:r.height})})});
area.addEventListener('input',event=>fetch('/clipboard-input',{method:'POST',body:JSON.stringify({value:area.value,trusted:event.isTrusted})}));
document.querySelector('#clipboard-submit').onclick=async event=>{
  const response=await fetch('/clipboard-submit',{method:'POST',body:JSON.stringify({value:area.value,trusted:event.isTrusted})});
  if(response.ok){document.querySelector('#clipboard-feedback').style.background='rgb(12,198,71)';document.querySelector('#clipboard-submit').textContent='Multiline accepted';}
};
</script>"""
    )


async def verify_clipboard(
    page, panel, labels, phrase, layouts, inputs, submissions, nonce, evidence
):
    async def wait_for(probe, description):
        deadline = time.monotonic() + 15
        while True:
            if probe():
                return
            assert time.monotonic() < deadline, description
            await asyncio.sleep(0.1)

    image = panel.get_by_role("img", name=labels["page"], exact=True)
    await wait_for(lambda: bool(layouts), "The actual page did not report its text range")
    layout = layouts[-1]
    box = await image.bounding_box()
    size = await image.evaluate("image=>({w:image.naturalWidth,h:image.naturalHeight})")
    assert box and size["w"] and size["h"]
    y = box["y"] + (layout["y"] + layout["height"] / 2) * box["height"] / size["h"]
    x1 = box["x"] + (layout["x"] + 0.5) * box["width"] / size["w"]
    x2 = box["x"] + (layout["x"] + layout["width"] - 0.5) * box["width"] / size["w"]
    saved = await page.evaluate("navigator.clipboard.readText()")
    pasted = "WebUI clipboard 中文\nSecond line ✓ " + nonce
    composed = "中文输入\nWebUI composed line ✓ " + nonce
    try:
        await page.mouse.move(x1, y)
        await page.mouse.down()
        await page.mouse.move(x2, y, steps=8)
        await page.mouse.up()
        await panel.get_by_role("button", name=labels["copySelection"], exact=True).click()
        deadline = time.monotonic() + 15
        while await page.evaluate("navigator.clipboard.readText()") != phrase:
            assert time.monotonic() < deadline, "The WebUI did not copy the exact selected phrase"
            await asyncio.sleep(0.1)
        evidence["exactPhraseCopiedFromRemoteSelection"] = True
        await page.evaluate("text=>navigator.clipboard.writeText(text)", pasted)

        async def click_remote(x, y):
            current = await image.bounding_box()
            assert current
            await page.mouse.click(
                current["x"] + x * current["width"] / size["w"],
                current["y"] + y * current["height"] / size["h"],
            )

        await click_remote(120, 380)
        await panel.get_by_role("button", name=labels["pasteClipboard"], exact=True).click()
        await wait_for(
            lambda: {"value": pasted, "trusted": True} in inputs,
            "The cloud page did not receive trusted multiline clipboard text",
        )
        evidence["realMultilineClipboardPaste"] = True
        await click_remote(120, 380)
        await image.press("Control+a")
        editor = panel.get_by_label(labels["text"], exact=True)
        await editor.fill("")
        cdp = await page.context.new_cdp_session(page)
        try:
            await cdp.send(
                "Input.imeSetComposition",
                {"text": "中文输入", "selectionStart": 4, "selectionEnd": 4},
            )
            for kind in ("keyDown", "keyUp"):
                await cdp.send(
                    "Input.dispatchKeyEvent",
                    {"type": kind, "key": "Enter", "code": "Enter", "windowsVirtualKeyCode": 229, "modifiers": 2},
                )
            await cdp.send("Input.insertText", {"text": "中文输入"})
            await cdp.send("Input.insertText", {"text": "\nWebUI composed line ✓ " + nonce})
        finally:
            await cdp.detach()
        assert await editor.input_value() == composed
        assert inputs[-1] == {"value": pasted, "trusted": True}, "IME confirmation inserted unfinished text remotely"
        await editor.press("Control+Enter")
        await wait_for(
            lambda: {"value": composed, "trusted": True} in inputs,
            "Completed composition did not reach the same cloud page",
        )
        await click_remote(160, 480)
        await wait_for(lambda: bool(submissions), "The actual multiline submission did not arrive")
        assert submissions == [{"value": composed, "trusted": True}], submissions
        await page.wait_for_function(
            """image=>{
                if(!image.complete||!image.naturalWidth)return false;
                const canvas=document.createElement('canvas');canvas.width=canvas.height=1;
                const context=canvas.getContext('2d');
                context.drawImage(image,610,360,1,1,0,0,1,1);
                const rgb=context.getImageData(0,0,1,1).data;
                return Math.abs(rgb[0]-12)<12&&Math.abs(rgb[1]-198)<12&&Math.abs(rgb[2]-71)<12;
            }""",
            arg=await image.element_handle(),
            timeout=15000,
        )
        evidence.update(
            chromiumImeComposition=True,
            imeConfirmationDidNotSubmit=True,
            trustedMultilineSubmissionOnce=True,
            finalSubmissionVisibleInActualFrame=True,
        )
    finally:
        current = await page.evaluate("navigator.clipboard.readText()")
        if current.replace("\r\n", "\n") in (phrase, pasted):
            await page.evaluate("text=>navigator.clipboard.writeText(text)", saved)
            evidence["ownedClipboardRestored"] = True
        elif current == saved:
            evidence["ownedClipboardUnchanged"] = True
        else:
            evidence["newerUserClipboardPreserved"] = True
        evidence["clipboardInputEvents"] = inputs
        evidence["clipboardSubmitEvents"] = submissions
