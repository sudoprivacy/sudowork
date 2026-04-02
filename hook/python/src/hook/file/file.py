import builtins
from pathlib import Path
from typing import TYPE_CHECKING

from hook.file.common import FileData, FileCallback, parse_flags

if TYPE_CHECKING:
    from _typeshed import FileDescriptorOrPath, OpenTextMode


class FileInterceptor:
    def __init__(self, callback: FileCallback):
        self.callback = callback

    def setup(self):
        original_open = builtins.open

        def open_(file: FileDescriptorOrPath, mode: OpenTextMode, *args, **kwargs):
            reason = self.callback(FileData(path=Path(file).absolute(), flags=parse_flags(mode)))
            if reason:
                raise PermissionError(reason)
            return original_open(file, mode, *args, **kwargs)

        builtins.open = open_
