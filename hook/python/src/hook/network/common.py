from base64 import b64encode
from dataclasses import dataclass
from typing import Mapping, Union, IO, Any, Iterable, Callable, Optional

from urllib3.util import Url


@dataclass
class NetworkData:
    url: Url
    method: str
    headers: Mapping[str, str]
    body: str


_TYPE_BODY = Union[bytes, IO[Any], Iterable[bytes], str]


def read_body(body: _TYPE_BODY) -> str:
    if isinstance(body, (str, bytes)):
        content = body
    elif hasattr(body, "read"):
        content = body.read()
    elif isinstance(body, Iterable):
        content = b"".join(body)
    else:
        content = body

    if isinstance(content, str):
        return content
    if isinstance(content, bytes):
        try:
            return content.decode("utf-8")
        except UnicodeDecodeError:
            return b64encode(content).decode("utf-8")
    return ""


NetworkCallback = Callable[[NetworkData], Optional[str]]
