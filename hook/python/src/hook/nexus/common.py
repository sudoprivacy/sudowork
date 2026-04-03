"""
Common types for the Nexus security service communication.

This module defines the payload types and data structures used to serialize
intercepted operations (file, network, process) into JSON format for
transmission to the Nexus security service via JSON-RPC.
"""

import json
from dataclasses import dataclass, asdict
from enum import Enum
from typing import Union

from urllib3.util import Url

from hook.file import FileData
from hook.network import NetworkData
from hook.process import ProcessData


class NexusPayloadType(str, Enum):
    """Enum identifying the type of intercepted operation."""

    FILE = "file"
    NETWORK = "network"
    PROCESS = "process"


@dataclass
class NexusPayload:
    """
    Payload sent to the Nexus security service for policy evaluation.

    Attributes:
        type: The category of the intercepted operation.
        data: The operation-specific data (NetworkData, FileData, or ProcessData).
    """

    type: NexusPayloadType
    data: Union[NetworkData, FileData, ProcessData]

    # noinspection PyTypeChecker
    def marshal(self) -> str:
        """
        Serialize the payload to a JSON string for transmission to the Nexus service.

        Converts non-serializable fields (Url, Path) to their string representations
        before JSON encoding.

        Returns:
            A JSON string representation of the payload.
        """
        # Convert complex types to strings for JSON serialization
        if self.type == NexusPayloadType.NETWORK:
            self.data.url = str(self.data.url)
        elif self.type == NexusPayloadType.FILE:
            self.data.path = str(self.data.path)
        return json.dumps(asdict(self))


def url_origin(url: Url) -> str:
    """
    Extract the origin (scheme + host + port) from a parsed URL.

    Args:
        url: A parsed urllib3 Url object.

    Returns:
        The origin string, e.g., "https://example.com:8080".
        Components that are None are omitted.
    """
    rst = ""
    if url.scheme is not None:
        rst += url.scheme + "://"
    if url.host is not None:
        rst += url.host
    if url.port is not None:
        rst += ":" + str(url.port)
    return rst
