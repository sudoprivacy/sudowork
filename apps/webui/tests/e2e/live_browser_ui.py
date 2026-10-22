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


async def interrupt_shared_browser(page, panel, labels):
    """A real page gesture invokes the conversation interrupt; it is not replayed."""
    from playwright.async_api import expect

    await page.bring_to_front()
    image = panel.get_by_role('img', name=labels['page'], exact=True)
    viewport = panel.get_by_label(labels['imageViewport'], exact=True)
    await viewport.scroll_into_view_if_needed()
    await expect(image).to_be_visible()
    box = await image.bounding_box()
    visible = await viewport.bounding_box()
    assert box and box['width'] > 0 and box['height'] > 0
    assert visible and page.viewport_size
    left = max(0, box['x'], visible['x'])
    top = max(0, box['y'], visible['y'])
    right = min(page.viewport_size['width'], box['x'] + box['width'], visible['x'] + visible['width'])
    bottom = min(page.viewport_size['height'], box['y'] + box['height'], visible['y'] + visible['height'])
    assert left < right and top < bottom, 'The browser image has no visible interaction area'
    # AI-owned pixels are view-only, so click the actual hit-tested viewport
    # rather than asking Playwright to force a click through pointer-events.
    # A locally enlarged image can begin hundreds of pixels outside the viewport.
    # Intersect the image, clipping container and device screen before the gesture.
    x, y = left + min(50, (right-left)/2), top + min(50, (bottom-top)/2)
    if await page.evaluate('navigator.maxTouchPoints > 0'):
        await page.touchscreen.tap(x, y)
    else:
        await page.mouse.click(x, y)
    await expect(panel.get_by_text(labels['state']['human'], exact=True)).to_be_visible(timeout=30_000)
    await expect(panel.get_by_label(labels['text'], exact=True)).to_be_visible()


async def continue_from_conversation(page, text):
    """Use the ordinary authenticated chat send, with no browser business buttons."""
    await page.bring_to_front()
    editor = page.locator('textarea').first
    await editor.fill(text)
    await editor.press('Enter')
