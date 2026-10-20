"""Keep one-time browser acceptance approvals scoped across runtime versions."""

import unittest
from unittest.mock import AsyncMock, MagicMock

from live_browser_permissions import approve_browser_permission


class BrowserPermissionTest(unittest.IsolatedAsyncioTestCase):
    def page(self):
        page = MagicMock()
        choice = (
            page.get_by_text.return_value.locator.return_value.get_by_text.return_value
        )
        choice.click = AsyncMock()
        return page, choice.click

    def event(self, tool, raw_input):
        return {
            "request_id": "owned-request",
            "request": {
                "tool_name": tool,
                "rawInput": raw_input,
                "options": [{"name": "Allow once", "optionId": "allow_once"}],
            },
        }

    async def test_resolves_explicit_browser_wrapper_before_visible_approval(self):
        page, click = self.page()
        target = "mcp__sudowork-browser__browser_observe"
        result = await approve_browser_permission(
            page,
            self.event("MCPTool", {"qualifiedName": target, "arguments": {}}),
            None,
        )
        self.assertEqual(result["tool"], target)
        self.assertEqual(result["source"], "qualified-mcp-wrapper")
        click.assert_awaited_once()

    async def test_rejects_an_unrelated_wrapper_even_if_arguments_mention_browser(self):
        for value in (
            {
                "qualifiedName": "mcp__other__execute",
                "arguments": {"text": "sudowork-browser"},
            },
            {"qualifiedName": "mcp__sudowork-browser-unsafe__execute"},
            {"arguments": {"qualifiedName": "mcp__sudowork-browser__browser_observe"}},
        ):
            with self.subTest(value=value):
                page, click = self.page()
                with self.assertRaisesRegex(AssertionError, "Unexpected permission"):
                    await approve_browser_permission(
                        page, self.event("MCPTool", value), None
                    )
                click.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
