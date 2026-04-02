from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import List, Callable, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from _typeshed import OpenTextMode


# noinspection SpellCheckingInspection
class FileFlag(str, Enum):
    O_RDONLY = "O_RDONLY"
    O_WRONLY = "O_WRONLY"
    O_RDWR = "O_RDWR"
    O_CREAT = "O_CREAT"
    O_EXCL = "O_EXCL"
    O_NOCTTY = "O_NOCTTY"
    O_TRUNC = "O_TRUNC"
    O_APPEND = "O_APPEND"
    O_DIRECTORY = "O_DIRECTORY"
    O_NOATIME = "O_NOATIME"
    O_NOFOLLOW = "O_NOFOLLOW"
    O_SYNC = "O_SYNC"
    O_DSYNC = "O_DSYNC"
    O_SYMLINK = "O_SYMLINK"
    O_DIRECT = "O_DIRECT"
    O_NONBLOCK = "O_NONBLOCK"
    REMOVE = "REMOVE"
    RENAME = "RENAME"


@dataclass
class FileData:
    path: Path
    flags: List[FileFlag]


FileCallback = Callable[[FileData], Optional[str]]


def parse_flags(mode: OpenTextMode) -> List[FileFlag]:
    """
    see Lib/_pyio.py FileIO __init__
    """
    flags: List[FileFlag] = []

    readable, writable = False, False
    if "x" in mode:
        writable = True
        flags.append(FileFlag.O_CREAT)
        flags.append(FileFlag.O_EXCL)
    elif "r" in mode:
        readable = True
    elif "w" in mode:
        writable = True
        flags.append(FileFlag.O_CREAT)
        flags.append(FileFlag.O_TRUNC)
    elif "a" in mode:
        writable = True
        flags.append(FileFlag.O_CREAT)
        flags.append(FileFlag.O_APPEND)

    if "+" in mode:
        readable = True
        writable = True

    if readable and writable:
        flags.append(FileFlag.O_RDWR)
    elif readable:
        flags.append(FileFlag.O_RDONLY)
    else:
        flags.append(FileFlag.O_WRONLY)

    return flags
