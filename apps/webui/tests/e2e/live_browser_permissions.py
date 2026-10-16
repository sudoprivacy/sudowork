"""Approve the actual, scoped browser tool permission in a live conversation."""

import json


async def approve_browser_permission(page, event, last_tool):
    request = event.get("request", {})
    tool = request.get("tool_name") or request.get("toolCall", {}).get("title", "")
    raw_input = request.get("rawInput") or request.get("input") or {}
    if isinstance(raw_input, str):
        raw_input = json.loads(raw_input)
    source = "permission"
    if not tool:
        # Older ACP omits titles. Match this turn's actual tool and arguments.
        assert last_tool and last_tool[1] == raw_input, (
            "An untitled permission must match the current tool"
        )
        tool = last_tool[0]
        source = "matching-tool-event"
    assert tool.startswith("mcp__sudowork-browser__") or (
        tool == "ToolSearch" and "sudowork-browser" in json.dumps(raw_input)
    ), f"Unexpected permission in browser-only acceptance: {tool}"
    options = request.get("options") or [{"name": "Allow", "optionId": "allow_once"}]
    once = next(
        (
            option
            for option in options
            if isinstance(option, dict)
            and option.get("optionId") in ("allow_once", "proceed_once")
        ),
        None,
    )
    assert once is not None, "A normal one-time approval is required"
    title = request.get("title") or request.get("tool_name") or "Permission Required"
    card = page.get_by_text(title, exact=True).locator(
        "xpath=ancestor::div[contains(@class,'max-w-800px')][1]"
    )
    await card.get_by_text(once["name"], exact=False).click(timeout=10000)
    print(f"Approved the visible one-time {tool} request", flush=True)
    return {"tool": tool, "requestId": event.get("request_id"), "source": source}
