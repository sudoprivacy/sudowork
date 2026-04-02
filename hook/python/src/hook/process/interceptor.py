import os
import subprocess

from hook.process.common import ProcessData, ProcessCallback


class ProcessInterceptor:
    def __init__(self, callback: ProcessCallback):
        self.callback = callback

    def setup(self):
        self.setup_popen()
        self.setup_system()

    def setup_popen(self):
        original_popen = subprocess.Popen

        def popen(*args, **kwargs):
            command = args[0]
            if isinstance(command, str):
                pass
            elif isinstance(args, bytes) or isinstance(args, os.PathLike):
                command = subprocess.list2cmdline([command])
            else:
                command = subprocess.list2cmdline(command)

            reason = self.callback(ProcessData(command=command, args=[]))
            if reason:
                raise PermissionError(reason)
            return original_popen(*args, **kwargs)

        subprocess.Popen = popen

    def setup_system(self):
        original_system = os.system

        def system(command):
            reason = self.callback(ProcessData(command=command, args=[]))
            if reason:
                raise PermissionError(reason)
            return original_system(command)

        os.system = system
