"""
File I/O interceptor module.

This module monkey-patches Python's built-in open() function to intercept all
file open operations. Before any file is opened, the callback is invoked to
check security policies. If the operation is denied, a PermissionError is raised.
"""

import builtins
from pathlib import Path
from typing import TYPE_CHECKING

from hook.file.common import FileData, FileCallback, parse_flags

if TYPE_CHECKING:
    from _typeshed import FileDescriptorOrPath, OpenTextMode


class FileInterceptor:
    """
    Interceptor that hooks into Python's built-in open() to enforce file access policies.

    When setup() is called, the global builtins.open is replaced with a wrapper
    that evaluates each file open request through the provided callback before
    delegating to the original open() implementation.
    """

    def __init__(self, callback: FileCallback):
        """
        Args:
            callback: A function that evaluates file access requests. It receives
                      a FileData object and returns None to allow, or a denial
                      reason string to block the operation.
        """
        self.callback = callback

    def setup(self):
        """
        Replace builtins.open with the intercepting wrapper.

        The wrapper resolves the file path to an absolute path, parses the mode
        string into POSIX-style flags, and sends this information to the callback
        for policy evaluation before proceeding with the actual file open.
        """
        original_open = builtins.open

        def open_(file: FileDescriptorOrPath, mode: OpenTextMode, *args, **kwargs):
            # Build FileData with the absolute path and parsed flags for policy check
            reason = self.callback(FileData(path=Path(file).absolute(), flags=parse_flags(mode)))
            if reason:
                raise PermissionError(reason)
            return original_open(file, mode, *args, **kwargs)

        builtins.open = open_
