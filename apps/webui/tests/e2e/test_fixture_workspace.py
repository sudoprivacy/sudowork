"""Protect the live harness's automatic approval boundary with hostile inputs."""

import json
import unittest
from fixture_workspace import is_fixture_request, tool_arguments, workspace_from_result


class FixtureWorkspaceTests(unittest.TestCase):
    session = "own-random-session"
    root = "/data/files/agents/owner/workspaces/" + session
    fixture = "qa-random-file.txt"
    nonce = "random-content"

    def test_accepts_only_a_successful_current_session_workspace_probe(self):
        def result(path, **changes):
            return {"is_error": False, "content": json.dumps({"stdout": path, "exit_code": 0, **changes})}
        self.assertEqual(workspace_from_result(result(self.root + "\n"), self.session), self.root)
        for path in ("/", self.root + "/../" + self.session, self.root + "-other", self.root + "\n/other"):
            with self.subTest(path=path), self.assertRaises(AssertionError):
                workspace_from_result(result(path), self.session)
        with self.assertRaises(AssertionError):
            workspace_from_result(result(self.root, exit_code=1), self.session)

    def test_absolute_file_approval_requires_the_observed_root_and_exact_content(self):
        def allowed(path, content=None, root=None):
            return is_fixture_request("write_file", {"path": path, "content": content or self.nonce},
                                      "create", self.fixture, self.nonce, root)
        absolute = self.root + "/" + self.fixture
        self.assertFalse(allowed(absolute))
        self.assertTrue(allowed(absolute, root=self.root))
        for path in (self.root + "-other/" + self.fixture, self.root + "/../" + self.fixture,
                     absolute + ".other", "/etc/" + self.fixture):
            with self.subTest(path=path):
                self.assertFalse(allowed(path, root=self.root))
        self.assertFalse(allowed(absolute, content=self.nonce + "changed", root=self.root))

    def test_shell_approval_refuses_other_files_extra_commands_and_scope_overrides(self):
        def allowed(command, phase="delete", **changes):
            return is_fixture_request("bash", {"command": command, **changes}, phase,
                                      self.fixture, self.nonce, self.root)
        self.assertTrue(allowed("pwd -P", phase="workspace"))
        self.assertTrue(allowed("rm -- " + self.root + "/" + self.fixture))
        for command in ("rm -rf .", "rm -- " + self.fixture + " other.txt", "rm -- " + self.fixture + "; pwd",
                        "rm -- /other/" + self.fixture, "pwd -P; touch other.txt"):
            self.assertFalse(allowed(command))
        self.assertFalse(allowed("pwd -P", phase="workspace", dangerouslyDisableSandbox=True))
        self.assertFalse(allowed("rm -- " + self.fixture, run_in_background=True))

    def test_permission_json_requires_an_object(self):
        value = {"path": self.fixture}
        self.assertEqual(tool_arguments(json.dumps(json.dumps(value))), value)
        with self.assertRaises(AssertionError):
            tool_arguments("[]")


if __name__ == "__main__":
    unittest.main()
