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

    image = panel.get_by_role('img', name=labels['page'], exact=True)
    await expect(image).to_be_visible()
    box = await image.bounding_box()
    assert box and box['width'] > 0 and box['height'] > 0
    # AI-owned pixels are view-only, so click the actual hit-tested viewport
    # rather than asking Playwright to force a click through pointer-events.
    await page.mouse.click(box['x'] + min(50, box['width']/2), box['y'] + min(50, box['height']/2))
    await expect(panel.get_by_text(labels['state']['human'], exact=True)).to_be_visible(timeout=30_000)
    await expect(panel.get_by_label(labels['text'], exact=True)).to_be_visible()


async def continue_from_conversation(page, text):
    """Use the ordinary authenticated chat send, with no browser business buttons."""
    await page.bring_to_front()
    editor = page.locator('textarea').first
    await editor.fill(text)
    await editor.press('Enter')
