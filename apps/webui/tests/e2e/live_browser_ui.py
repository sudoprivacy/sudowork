"""Open the shared browser panel through its normal workspace controls."""


async def open_browser_panel(page, browser_tab_name):
    tab = page.get_by_role("tab", name=browser_tab_name, exact=True)
    await tab.wait_for(state="attached", timeout=30000)
    is_reachable = await tab.evaluate(
        """element => {
            const box = element.getBoundingClientRect();
            const top = document.elementFromPoint(
                box.x + box.width / 2, box.y + box.height / 2
            );
            return top === element || (top !== null && element.contains(top));
        }"""
    )
    if not is_reachable:
        for name in ("Expand workspace", "Toggle workspace"):
            controls = page.get_by_role("button", name=name, exact=True)
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
    await tab.click()
    panel = page.get_by_test_id("browser-session-panel")
    await panel.wait_for(state="visible")
    return panel
