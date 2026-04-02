import json
from dataclasses import dataclass, asdict
from enum import Enum
from typing import Union

from urllib3.util import Url

from hook.file import FileData
from hook.network import NetworkData
from hook.process import ProcessData


class NexusPayloadType(str, Enum):
    FILE = "file"
    NETWORK = "network"
    PROCESS = "process"


@dataclass
class NexusPayload:
    type: NexusPayloadType
    data: Union[NetworkData, FileData, ProcessData]

    # noinspection PyTypeChecker
    def marshal(self) -> str:
        # marshal data
        if self.type == NexusPayloadType.NETWORK:
            self.data.url = str(self.data.url)
        elif self.type == NexusPayloadType.FILE:
            self.data.path = str(self.data.path)
        return json.dumps(asdict(self))


def url_origin(url: Url) -> str:
    rst = ""
    if url.scheme is not None:
        rst += url.scheme + "://"
    if url.host is not None:
        rst += url.host
    if url.port is not None:
        rst += ":" + str(url.port)
    return rst
