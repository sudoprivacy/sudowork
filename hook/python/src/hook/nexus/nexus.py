import json
import logging
import time
from base64 import b64decode
from datetime import datetime, timedelta
from enum import Enum
from typing import Dict, Any, Optional, List
from uuid import uuid4

from urllib3 import request

logger = logging.getLogger("nexus")


class Nexus:
    def __init__(self, url: str):
        self.base_url = url

    def call_rpc(self, method: str, params: Dict[str, Any] = None) -> Any:
        logger.debug(f"API call: {method} with params: {params}")

        try:
            response = request(
                method="POST",
                url=f"{self.base_url}/api/nfs/{method}",
                json={"jsonrpc": "2.0", "id": str(uuid4()), "method": method, "params": params},
                headers={"Content-Type": "application/json", "Accept-Encoding": "gzip"},
            )
        except Exception as e:
            logger.error(f"API call connection failed")
            raise e

        text = response.data.decode("utf-8")
        if response.status != 200:
            logger.error(f"API call failed: {method} - HTTP {response.status}")
            raise NexusError(f"Request failed: {text}")

        rpc_response = json.loads(text)
        err = rpc_response.get("error")
        if err:
            logger.error(f"API call RPC error: {method} - {err.get('message')}")
            raise rpc_error(err)

        logger.debug(f"API call completed: {method}")
        return rpc_response.get("result")

    def write(
        self,
        path: str,
        content: bytes | str,
        if_match: str | None = None,
        if_none_match: bool = False,
        force: bool = False,
    ) -> dict[str, Any]:
        return self.call_rpc(
            "write",
            {"path": path, "content": content, "if_match": if_match, "if_none_match": if_none_match, "force": force},
        )

    def read(
        self,
        path: str,
        return_metadata: bool = False,
    ) -> bytes | dict[str, Any]:
        result = self.call_rpc("read", {"path": path, "return_metadata": return_metadata})
        if isinstance(result, dict):
            if result.get("__type__") == "bytes" and "data" in result:
                decoded_content = b64decode(result["data"])
                if return_metadata:
                    result["content"] = decoded_content
                    return result
                else:
                    return decoded_content
            if "content" in result:
                content = result["content"]
                encoding = result.get("encoding", "base64")
                if encoding == "base64" and isinstance(content, str):
                    decoded_content = b64decode(content)
                elif isinstance(content, bytes):
                    decoded_content = content
                else:
                    decoded_content = content.encode() if isinstance(content, str) else content
                if return_metadata:
                    result["content"] = decoded_content
                    return result
                else:
                    return decoded_content
        return result

    def exists(self, path: str) -> bool:
        result = self.call_rpc("exists", {"path": path})
        return result.get("exists", False)

    def read_until_exists(self, path: str, timeout: Optional[timedelta] = None) -> bytes:
        start_time = datetime.now()
        while not ((timeout and datetime.now() - start_time > timeout) or (self.exists(path))):
            time.sleep(1)
        return self.read(path)

    def delete_bulk(
        self,
        paths: List[str],
        recursive: bool = False,
    ) -> None:
        self.call_rpc("delete_bulk", {"paths": paths, "recursive": recursive})


class NexusError(Exception):
    def __init__(self, message: str, path: str = None):
        self.message = message
        self.path = path

    def __str__(self):
        if self.path:
            return f"{self.message}: {self.path}"
        return self.message


class RPCErrorCode(Enum):
    """Standard JSON-RPC error codes + custom Nexus error codes."""

    # Standard JSON-RPC errors
    PARSE_ERROR = -32700
    INVALID_REQUEST = -32600
    METHOD_NOT_FOUND = -32601
    INVALID_PARAMS = -32602
    INTERNAL_ERROR = -32603

    # Nexus-specific errors
    FILE_NOT_FOUND = -32000
    FILE_EXISTS = -32001
    INVALID_PATH = -32002
    ACCESS_DENIED = -32003
    PERMISSION_ERROR = -32004
    VALIDATION_ERROR = -32005
    CONFLICT = -32006  # Optimistic concurrency conflict


def rpc_error(error: Dict[str, Any]) -> NexusError:
    code = error.get("code", RPCErrorCode.INTERNAL_ERROR)
    message = error.get("message", "Unknown error")
    data = error.get("data")
    if code == RPCErrorCode.FILE_NOT_FOUND:
        path = data.get("path") if data else None
        return NexusError("File not found", path or message)
    elif code == RPCErrorCode.FILE_EXISTS:
        path = data.get("path") if data else None
        return NexusError("File exists", path or message)
    elif code == RPCErrorCode.INVALID_PATH:
        path = data.get("path") if data else None
        return NexusError("Invalid path", path or message)
    elif code == RPCErrorCode.ACCESS_DENIED or code == RPCErrorCode.PERMISSION_ERROR:
        return NexusError("Permission denied", message)
    elif code == RPCErrorCode.INVALID_PARAMS:
        return NexusError("Invalid value", message)
    elif code == RPCErrorCode.CONFLICT:
        expected_etag = data.get("expected_etag") if data else "(unknown)"
        current_etag = data.get("current_etag") if data else "(unknown)"
        path = data.get("path") if data else "unknown"
        return NexusError(
            f"Conflict detected - file was modified by another agent. Expected etag '{expected_etag}', but current etag is '{current_etag}'",
            path,
        )
    else:
        return NexusError(f"RPC error [{code}]: {message}")
