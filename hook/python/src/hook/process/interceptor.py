"""
Process execution interceptor module.

This module monkey-patches subprocess.Popen and os.system to intercept all
process execution calls. Before any subprocess is spawned, the callback is
invoked to check security policies. If the operation is denied, a PermissionError
is raised, preventing the process from being created.
"""

import os
import subprocess

from hook.process.common import ProcessData, ProcessCallback


class ProcessInterceptor:
    """
    Interceptor that hooks into subprocess.Popen and os.system to enforce
    process execution policies.

    When setup() is called, both subprocess.Popen and os.system are replaced
    with wrappers that evaluate each execution request through the provided
    callback before delegating to the original implementations.
    """

    def __init__(self, callback: ProcessCallback):
        """
        Args:
            callback: A function that evaluates process execution requests. It receives
                      a ProcessData object and returns None to allow, or a denial
                      reason string to block the execution.
        """
        self.callback = callback

    def setup(self):
        """Set up interception for both subprocess.Popen and os.system."""
        self.setup_popen()
        self.setup_system()

    def setup_popen(self):
        """
        Replace subprocess.Popen with an intercepting wrapper.

        Handles the various command formats supported by Popen:
        - String commands (passed directly)
        - bytes or os.PathLike objects (converted via list2cmdline)
        - Sequences of strings (joined via list2cmdline)
        """
        original_popen = subprocess.Popen

        def popen(*args, **kwargs):
            # Normalize the command to a string for policy evaluation
            command = args[0]
            if isinstance(command, str):
                pass
            elif isinstance(args, bytes) or isinstance(args, os.PathLike):
                command = subprocess.list2cmdline([command])
            else:
                # Sequence of arguments: join into a single command string
                command = subprocess.list2cmdline(command)

            reason = self.callback(ProcessData(command=command, args=[]))
            if reason:
                raise PermissionError(reason)
            return original_popen(*args, **kwargs)

        subprocess.Popen = popen

    def setup_system(self):
        """
        Replace os.system with an intercepting wrapper.

        os.system receives commands as plain strings, so no normalization is needed.
        """
        original_system = os.system

        def system(command):
            reason = self.callback(ProcessData(command=command, args=[]))
            if reason:
                raise PermissionError(reason)
            return original_system(command)

        os.system = system
