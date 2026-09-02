"""
Common types for process execution interception.

This module defines the data structures used to represent subprocess execution
operations for security policy evaluation.
"""

from dataclasses import dataclass
from typing import List, Optional, Callable


@dataclass
class ProcessData:
    """
    Data class representing a process execution to be evaluated by security policies.

    Attributes:
        command: The command string being executed (e.g., "echo foo" or "/usr/bin/python").
        args: Additional arguments passed to the command (currently unused, reserved for future use).
    """

    command: str
    args: List[str]


# Type alias for the process interceptor callback function.
# Takes ProcessData and returns an optional denial reason string (None means allowed).
ProcessCallback = Callable[[ProcessData], Optional[str]]
