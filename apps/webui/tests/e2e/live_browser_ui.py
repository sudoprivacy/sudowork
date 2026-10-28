"""Open the shared browser panel through its normal workspace controls."""


async def open_browser_panel(page, browser_tab_name):
    tab = page.get_by_role("tab", name=browser_tab_name, exact=True)
    is_reachable = await tab.count() > 0 and await tab.evaluate(
        """element => {
            const box = element.getBoundingClientRect();
            const top = document.elementFromPoint(
                box.x + box.width / 2, box.y + box.height / 2
            );
            return top === element || (top !== null && element.contains(top));
        }"""
    )
    if not is_reachable:
        openers = [
            page.locator('button.workspace-header__toggle[aria-expanded="false"]'),
            *[
                page.get_by_role("button", name=name, exact=True)
                for name in ("Expand workspace", "Toggle workspace")
            ],
        ]
        for controls in openers:
            visible = [
                control
                for control in await controls.all()
                if await control.is_visible()
            ]
            if visible:
                await visible[0].click()
                break
        else:
            raise AssertionError(
                "The browser tab is blocked and no workspace opener is visible"
            )
    await tab.wait_for(state="visible", timeout=30000)
    await tab.click()
    panel = page.get_by_test_id("browser-session-panel")
    await panel.wait_for(state="visible")
    return panel


async def open_browser_source(panel, labels):
    """Expand the normal browser connection settings before using them."""
    from playwright.async_api import expect

    launch_mode = panel.get_by_role("combobox", name=labels["launchMode"], exact=True)
    if not await launch_mode.is_visible():
        await panel.get_by_role(
            "button", name=labels["browserSource"], exact=True
        ).click()
    await expect(launch_mode).to_be_visible(timeout=30000)


async def interrupt_shared_browser(page, panel, labels):
    """A real page gesture invokes the conversation interrupt; it is not replayed."""
    from playwright.async_api import expect

    await page.bring_to_front()
    image = panel.get_by_role("img", name=labels["page"], exact=True)
    surface = panel.locator("canvas:visible").or_(image)
    viewport = panel.get_by_label(labels["imageViewport"], exact=True)
    await viewport.scroll_into_view_if_needed()
    await expect(surface).to_be_visible()
    box = await surface.bounding_box()
    visible = await viewport.bounding_box()
    assert box and box["width"] > 0 and box["height"] > 0
    assert visible and page.viewport_size
    left = max(0, box["x"], visible["x"])
    top = max(0, box["y"], visible["y"])
    right = min(
        page.viewport_size["width"],
        box["x"] + box["width"],
        visible["x"] + visible["width"],
    )
    bottom = min(
        page.viewport_size["height"],
        box["y"] + box["height"],
        visible["y"] + visible["height"],
    )
    assert left < right and top < bottom, (
        "The browser image has no visible interaction area"
    )
    # AI-owned pixels are view-only, so click the actual hit-tested viewport
    # rather than asking Playwright to force a click through pointer-events.
    # A locally enlarged image can begin hundreds of pixels outside the viewport.
    # Intersect the image, clipping container and device screen before the gesture.
    x, y = left + min(50, (right - left) / 2), top + min(50, (bottom - top) / 2)
    if await page.evaluate("navigator.maxTouchPoints > 0"):
        await page.touchscreen.tap(x, y)
    else:
        await page.mouse.click(x, y)
    await expect(panel.get_by_text(labels["state"]["human"], exact=True)).to_be_visible(
        timeout=30_000
    )
    await expect(panel.get_by_label(labels["text"], exact=True)).to_be_visible()


async def continue_from_conversation(page, text):
    """Use the ordinary authenticated chat send, with no browser business buttons."""
    await page.bring_to_front()
    editor = page.locator("textarea").first
    await editor.fill(text)
    await editor.press("Enter")


def read_conversation_event(payload, evidence, phase):
    """Preserve public error codes and fail immediately on a rejected chat send."""
    import json

    if not isinstance(payload, str):
        return None
    message = json.loads(payload)
    event = message.get("event", {})
    evidence.setdefault("conversationFrames", []).append(
        {"phase": phase, "kind": message.get("kind"), "type": event.get("type")}
    )
    if message.get("kind") == "error":
        rejection = {"phase": phase, "code": message.get("code")}
        evidence["conversationRejection"] = rejection
        raise AssertionError("Conversation rejected: " + json.dumps(rejection))
    if message.get("kind") == "upstream" and event.get("type") == "assistant":
        content = event.get("message", {}).get("content", [])
        text = (
            content
            if isinstance(content, str)
            else "".join(
                block.get("text", "") for block in content if isinstance(block, dict)
            )
        )
        diagnostic = evidence.setdefault("modelAssistantText", {})
        diagnostic[phase] = (diagnostic.get(phase, "") + text)[-4000:]
    if message.get("kind") == "upstream" and event.get("type") == "result":
        completion = {
            "phase": phase,
            "status": event.get("status"),
            "is_error": event.get("is_error"),
            "errors": event.get("errors"),
        }
        evidence.setdefault("modelCompletions", []).append(completion)
        if event.get("is_error") or event.get("status") == "error":
            evidence["modelFailure"] = completion
            raise AssertionError("Model completion failed: " + json.dumps(completion))
    return event if message.get("kind") == "upstream" else None


async def configure_deployment_cookie(context, origin, cookie):
    """Select an operator-owned deployment within this temporary viewer context."""
    import re
    from urllib.parse import urlparse

    if cookie is None:
        return
    assert set(cookie) == {"name", "value"}
    assert re.fullmatch(r"[A-Za-z0-9_]+", cookie["name"])
    assert re.fullmatch(r"[A-Za-z0-9_-]{32,128}", cookie["value"])
    await context.add_cookies(
        [
            {
                **cookie,
                "url": origin,
                "httpOnly": True,
                "secure": urlparse(origin).scheme == "https",
                "sameSite": "Strict",
            }
        ]
    )
