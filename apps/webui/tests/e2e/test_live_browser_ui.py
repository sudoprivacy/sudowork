"""Protect live acceptance from hiding a completed model error behind a timeout."""

import json
import unittest

from live_browser_ui import read_conversation_event


class LiveConversationEventsTest(unittest.TestCase):
    def test_preserves_overload_before_rejecting_the_completed_turn(self):
        evidence = {}
        text = "400 Bad Request (upstream_error): Our servers are currently overloaded."
        read_conversation_event(
            json.dumps(
                {
                    "kind": "upstream",
                    "event": {
                        "type": "assistant",
                        "message": {"content": [{"type": "text", "text": text}]},
                    },
                }
            ),
            evidence,
            "cleanup",
        )
        with self.assertRaisesRegex(AssertionError, "Model completion failed"):
            read_conversation_event(
                json.dumps(
                    {
                        "kind": "upstream",
                        "event": {
                            "type": "result",
                            "status": "error",
                            "is_error": True,
                            "errors": ["Internal error"],
                        },
                    }
                ),
                evidence,
                "cleanup",
            )
        self.assertEqual(evidence["modelAssistantText"]["cleanup"], text)
        self.assertEqual(evidence["modelFailure"]["errors"], ["Internal error"])

    def test_rejects_error_status_without_an_is_error_flag(self):
        with self.assertRaisesRegex(AssertionError, "Model completion failed"):
            read_conversation_event(
                json.dumps(
                    {"kind": "upstream", "event": {"type": "result", "status": "error"}}
                ),
                {},
                "observation",
            )

    def test_preserves_public_chat_rejection_code(self):
        evidence = {}
        with self.assertRaisesRegex(AssertionError, "UPSTREAM_FAILED"):
            read_conversation_event(
                json.dumps({"kind": "error", "code": "UPSTREAM_FAILED"}),
                evidence,
                "cleanup",
            )
        self.assertEqual(
            evidence["conversationRejection"],
            {"phase": "cleanup", "code": "UPSTREAM_FAILED"},
        )

    def test_preserves_success_and_separates_turn_diagnostics(self):
        evidence = {}
        for phase, text in (("observation", "Signed in"), ("cleanup", "CLEANUP_OK")):
            read_conversation_event(
                json.dumps(
                    {
                        "kind": "upstream",
                        "event": {"type": "assistant", "message": {"content": text}},
                    }
                ),
                evidence,
                phase,
            )
        result = {"type": "result", "status": "success", "is_error": False}
        self.assertEqual(
            read_conversation_event(
                json.dumps({"kind": "upstream", "event": result}), evidence, "cleanup"
            ),
            result,
        )
        self.assertEqual(evidence["modelAssistantText"]["cleanup"], "CLEANUP_OK")
        self.assertNotIn("modelFailure", evidence)

    def test_ignores_non_model_control_frames(self):
        evidence = {}
        self.assertIsNone(
            read_conversation_event(json.dumps({"kind": "writer"}), evidence, "cleanup")
        )
        self.assertNotIn("modelCompletions", evidence)


if __name__ == "__main__":
    unittest.main()
