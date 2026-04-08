"""
Common types and utilities for file operation interception.

This module defines the data structures used to represent file operations
(path + flags) and provides a parser that converts Python open() mode strings
into POSIX-style file flag enums for security policy evaluation.
"""

from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import List, Callable, Optional


# noinspection SpellCheckingInspection
class FileFlag(str, Enum):
    """
    Enumeration of POSIX file access flags and custom operations.

    These mirror the standard POSIX open() flags (e.g., O_RDONLY, O_WRONLY)
    and include custom flags for file removal and renaming operations.
    """

    O_RDONLY = "O_RDONLY"  # Read-only access
    O_WRONLY = "O_WRONLY"  # Write-only access
    O_RDWR = "O_RDWR"  # Read-write access
    O_CREAT = "O_CREAT"  # Create file if it does not exist
    O_EXCL = "O_EXCL"  # Fail if file already exists (used with O_CREAT)
    O_NOCTTY = "O_NOCTTY"  # Do not assign controlling terminal
    O_TRUNC = "O_TRUNC"  # Truncate file to zero length
    O_APPEND = "O_APPEND"  # Append to end of file
    O_DIRECTORY = "O_DIRECTORY"  # Fail if not a directory
    O_NOATIME = "O_NOATIME"  # Do not update access time
    O_NOFOLLOW = "O_NOFOLLOW"  # Do not follow symbolic links
    O_SYNC = "O_SYNC"  # Synchronous I/O
    O_DSYNC = "O_DSYNC"  # Synchronize data integrity
    O_SYMLINK = "O_SYMLINK"  # Allow opening symbolic links
    O_DIRECT = "O_DIRECT"  # Direct I/O (bypass page cache)
    O_NONBLOCK = "O_NONBLOCK"  # Non-blocking I/O
    REMOVE = "REMOVE"  # Custom flag: file deletion operation
    RENAME = "RENAME"  # Custom flag: file rename operation


@dataclass
class FileData:
    """
    Data class representing a file operation to be evaluated by security policies.

    Attributes:
        path: The absolute path of the file being accessed.
        flags: List of file flags describing the type of access (read, write, create, etc.).
    """

    path: Path
    flags: List[FileFlag]


# Type alias for the file interceptor callback function.
# Takes FileData and returns an optional denial reason string (None means allowed).
FileCallback = Callable[[FileData], Optional[str]]


def parse_flags(mode) -> List[FileFlag]:
    """
    Parse a Python open() mode string into a list of FileFlag values.

    Mirrors the logic in CPython's Lib/_pyio.py FileIO.__init__ to translate
    high-level mode characters ('r', 'w', 'a', 'x', '+') into the corresponding
    low-level POSIX file operation flags.

    Args:
        mode: A Python file mode string (e.g., 'r', 'w', 'a', 'x', 'r+', 'wb').

    Returns:
        A list of FileFlag enums representing the equivalent POSIX flags.
    """
    flags: List[FileFlag] = []

    readable, writable = False, False
    if "x" in mode:
        # Exclusive creation: fail if the file already exists
        writable = True
        flags.append(FileFlag.O_CREAT)
        flags.append(FileFlag.O_EXCL)
    elif "r" in mode:
        # Read mode: open existing file for reading
        readable = True
    elif "w" in mode:
        # Write mode: create or truncate the file
        writable = True
        flags.append(FileFlag.O_CREAT)
        flags.append(FileFlag.O_TRUNC)
    elif "a" in mode:
        # Append mode: create or append to the file
        writable = True
        flags.append(FileFlag.O_CREAT)
        flags.append(FileFlag.O_APPEND)

    if "+" in mode:
        # '+' modifier enables both reading and writing
        readable = True
        writable = True

    # Determine the final access mode flag based on read/write combination
    if readable and writable:
        flags.append(FileFlag.O_RDWR)
    elif readable:
        flags.append(FileFlag.O_RDONLY)
    else:
        flags.append(FileFlag.O_WRONLY)

    return flags
