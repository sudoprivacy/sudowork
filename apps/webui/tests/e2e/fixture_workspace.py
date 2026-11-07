"""Bind one-time UI approvals to a workspace observed through the real session."""

import json
from pathlib import PurePosixPath
import shlex


def tool_arguments(value):
    for _ in range(2):
        if not isinstance(value, str):
            break
        value = json.loads(value)
    assert isinstance(value, dict), "Tool arguments must be a JSON object"
    return value


def workspace_from_result(result, session_id):
    assert result.get("is_error") is False, "The real workspace probe failed"
    output = tool_arguments(result.get("content"))
    assert output.get("exit_code") == 0 and not output.get("interrupted")
    stdout = output.get("stdout")
    assert isinstance(stdout, str), "The workspace probe did not return stdout"
    root = stdout.rstrip("\r\n")
    path = PurePosixPath(root)
    assert (path.is_absolute() and str(path) == root and path.name == session_id
            and ".." not in path.parts and not any(value in root for value in ("\n", "\r", "\0"))), (
        "The real workspace does not belong to this fixture session"
    )
    return root


def is_fixture_request(tool, arguments, phase, fixture, nonce, workspace_root=None):
    paths = {fixture, "./" + fixture}
    if workspace_root:
        paths.add(str(PurePosixPath(workspace_root) / fixture))
    if tool in ("write_file", "read_file"):
        if arguments.get("path") not in paths:
            return False
        if tool == "read_file":
            return phase == "read"
        content = arguments.get("content")
        return phase == "create" and isinstance(content, str) and content.strip() == nonce
    if tool != "bash" or arguments.get("dangerouslyDisableSandbox") or arguments.get("run_in_background"):
        return False
    try:
        command = shlex.split(arguments.get("command", ""))
    except (TypeError, ValueError):
        return False
    if phase == "workspace":
        return command in (["pwd", "-P"], ["/bin/pwd", "-P"], ["/usr/bin/pwd", "-P"])
    if phase != "delete" or not command or command[0] not in ("rm", "/bin/rm", "/usr/bin/rm"):
        return False
    return any(command[1:] in ([path], ["--", path], ["-f", path], ["-f", "--", path]) for path in paths)
