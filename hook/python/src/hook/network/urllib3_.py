import logging
from typing import Optional, Mapping, Union

from hook.network.common import NetworkCallback, _TYPE_BODY, read_body, NetworkData

logger = logging.getLogger("hook")


class Urllib3Interceptor:
    def __init__(self, callback: NetworkCallback):
        self.callback = callback

    def setup(self):
        try:
            import urllib3
            from urllib3.util import parse_url, Url
        except ImportError:
            logger.warn("urllib3 not installed, skip interception")
            return

        original_urlopen = urllib3.HTTPConnectionPool.urlopen

        def urlopen(
            manager: urllib3.HTTPConnectionPool,
            method: str,
            url: str,
            body: Union[_TYPE_BODY, None] = None,
            headers: Optional[Mapping[str, str]] = None,
            *args,
            **kwargs,
        ):
            parsed_url = parse_url(url)
            rst_url = Url(
                scheme=parsed_url.scheme or manager.scheme,
                host=parsed_url.host or manager.host,
                port=parsed_url.port or manager.port,
                path=parsed_url.path,
                query=parsed_url.query,
                fragment=parsed_url.fragment,
            )
            body = read_body(body)

            reason = self.callback(NetworkData(url=rst_url, method=method, headers=dict(headers), body=body))
            if reason:
                raise PermissionError(reason)

            return original_urlopen(manager, method, url, body, headers, *args, **kwargs)

        urllib3.HTTPConnectionPool.urlopen = urlopen
