"""
Common types and utilities for network request interception.

This module defines the data structures used to represent outgoing HTTP requests
and provides a utility to normalize request bodies into string form for
security policy evaluation and logging.
"""

from base64 import b64encode
from dataclasses import dataclass
from typing import Mapping, Union, IO, Any, Iterable, Callable, Optional

from urllib3.util import Url


@dataclass
class NetworkData:
    """
    Data class representing an outgoing HTTP request to be evaluated by security policies.

    Attributes:
        url: The parsed URL of the request (scheme, host, port, path, query, fragment).
        method: The HTTP method (GET, POST, PUT, etc.).
        headers: The request headers as a string-to-string mapping.
        body: The request body serialized as a string (UTF-8 or base64-encoded).
    """

    url: Url
    method: str
    headers: Mapping[str, str]
    body: str


# Union type representing the various forms an HTTP request body can take.
_TYPE_BODY = Union[bytes, IO[Any], Iterable[bytes], str]


def read_body(body: _TYPE_BODY) -> str:
    """
    Normalize an HTTP request body into a string representation.

    Handles multiple body types: plain strings, byte sequences, file-like objects,
    and iterables of bytes. Binary content that cannot be decoded as UTF-8 is
    returned as a base64-encoded string.

    Args:
        body: The raw request body in any supported format.

    Returns:
        A string representation of the body content. Returns an empty string
        if the body type is unrecognized.
    """
    if isinstance(body, (str, bytes)):
        content = body
    elif hasattr(body, "read"):
        # File-like object: read all content
        content = body.read()
    elif isinstance(body, Iterable):
        # Iterable of byte chunks: concatenate into a single bytes object
        content = b"".join(body)
    else:
        content = body

    if isinstance(content, str):
        return content
    if isinstance(content, bytes):
        try:
            return content.decode("utf-8")
        except UnicodeDecodeError:
            # Fall back to base64 encoding for non-UTF-8 binary data
            return b64encode(content).decode("utf-8")
    return ""


# Type alias for the network interceptor callback function.
# Takes NetworkData and returns an optional denial reason string (None means allowed).
NetworkCallback = Callable[[NetworkData], Optional[str]]
