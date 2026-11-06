"""Protect the live directory concurrency evidence and its fixture scope."""

import unittest

from workspace_requests import trace_workspace_requests, workspace_request_summary


class WorkspaceRequestSummaryTests(unittest.TestCase):
    def test_two_ui_reads_are_visible_even_when_the_control_page_is_idle(self):
        result = workspace_request_summary([
            {"source": "browser", "startedAt": 1, "finishedAt": 4},
            {"source": "browser", "startedAt": 2, "finishedAt": 3},
            {"source": "control", "startedAt": 5, "finishedAt": 6},
        ])
        self.assertEqual(result["maxPending"], 2)
        self.assertEqual(result["maxPendingByPage"], {"browser": 2, "control": 1})

    def test_cross_page_delivery_order_does_not_change_actual_overlap(self):
        records = [
            {"source": "control", "startedAt": 2, "finishedAt": 5},
            {"source": "browser", "startedAt": 3, "finishedAt": 4},
            {"source": "browser", "startedAt": 1, "finishedAt": 3},
        ]
        result = workspace_request_summary(records)
        self.assertEqual(result, workspace_request_summary(list(reversed(records))))
        self.assertEqual(result["maxPending"], 2)
        self.assertEqual(result["maxPendingByPage"], {"browser": 1, "control": 1})
        self.assertEqual(result["unfinished"], 0)

    def test_unfinished_reads_keep_counting_and_zero_duration_does_not_overlap(self):
        result = workspace_request_summary([
            {"source": "browser", "startedAt": 1},
            {"source": "browser", "startedAt": 2, "finishedAt": 2},
            {"source": "control", "startedAt": 3, "finishedAt": 4},
        ])
        self.assertEqual(result["requestsByPage"], {"browser": 2, "control": 1})
        self.assertEqual(result["maxPending"], 2)
        self.assertEqual(result["maxPendingByPage"], {"browser": 1, "control": 1})
        self.assertEqual(result["unfinished"], 1)

    def test_invalid_intervals_refuse_a_successful_measurement(self):
        with self.assertRaisesRegex(AssertionError, "reversed request interval"):
            workspace_request_summary([{"source": "browser", "startedAt": 2, "finishedAt": 1}])


class WorkspaceRequestTraceTests(unittest.IsolatedAsyncioTestCase):
    async def test_only_own_https_root_gets_are_recorded_without_private_headers(self):
        class Client:
            def __init__(self):
                self.handlers = {}
                self.commands = []

            def on(self, name, callback):
                self.handlers[name] = callback

            async def send(self, name):
                self.commands.append(name)

        class Context:
            async def new_cdp_session(self, page):
                self.page = page
                return client

        client = Client()
        context = Context()
        page = object()
        evidence = {}
        origin = "https://webui.example.test"
        root = origin + "/api/conversations/own/workspace/tree"
        self.assertIs(await trace_workspace_requests(context, page, "browser", evidence, origin), client)
        self.assertIs(context.page, page)
        self.assertEqual(client.commands, ["Network.enable"])

        def start(identifier, url, method="GET"):
            client.handlers["Network.requestWillBeSent"]({
                "requestId": identifier, "timestamp": 1,
                "request": {"url": url, "method": method, "headers": {"Cookie": "private-value"}},
            })

        start("before-session", root)
        evidence["sessionId"] = "own"
        for identifier, url, method in [
            ("other-session", root.replace("/own/", "/other/"), "GET"),
            ("other-origin", root.replace("webui.example.test", "other.example.test"), "GET"),
            ("http", root.replace("https:", "http:"), "GET"),
            ("file", root.replace("/tree", "/file"), "GET"),
            ("search", root + "?search=private", "GET"),
            ("subtree", root + "?path=dir", "GET"),
            ("post", root, "POST"),
        ]:
            start(identifier, url, method)
        start("own", root + "?path=&search=")
        start("own", root)
        client.handlers["Network.responseReceived"]({
            "requestId": "own", "response": {"status": 200, "protocol": "http/1.1",
            "timing": {"sendStart": 17}, "headers": {"Set-Cookie": "private-value"}},
        })
        client.handlers["Network.loadingFailed"]({"requestId": "unrelated", "timestamp": 4, "errorText": "ignored"})
        client.handlers["Network.loadingFailed"]({"requestId": "own", "timestamp": 3, "errorText": "net::ERR_ABORTED"})
        self.assertEqual(evidence["workspaceRequests"], [{
            "source": "browser", "requestId": "own", "startedAt": 1, "finishedAt": 3,
            "status": 200, "protocol": "http/1.1", "sendStartMs": 17, "failure": "net::ERR_ABORTED",
        }])


if __name__ == "__main__":
    unittest.main()
