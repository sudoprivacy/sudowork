"""
urllib3 network interceptor module.

This module monkey-patches urllib3's HTTPConnectionPool.urlopen method to intercept
all outgoing HTTP requests made through urllib3 (which is also the transport layer
for popular libraries like requests and httpx). Each request is evaluated against
security policies before being allowed to proceed.
"""

import logging
from typing import Optional, Mapping, Union

from hook.network.common import NetworkCallback, _TYPE_BODY, read_body, NetworkData

logger = logging.getLogger("hook")


class Urllib3Interceptor:
    """
    Interceptor that hooks into urllib3's connection pool to enforce network access policies.

    When setup() is called, urllib3.HTTPConnectionPool.urlopen is replaced with a
    wrapper that evaluates each outgoing request through the provided callback before
    delegating to the original implementation.
    """

    def __init__(self, callback: NetworkCallback):
        """
        Args:
            callback: A function that evaluates network requests. It receives a
                      NetworkData object and returns None to allow, or a denial
                      reason string to block the request.
        """
        self.callback = callback

    def setup(self):
        """
        Replace urllib3's HTTPConnectionPool.urlopen with the intercepting wrapper.

        Gracefully skips setup if urllib3 is not installed, logging a warning instead
        of raising an error.
        """
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
            # Reconstruct the full URL by merging the request URL with the connection
            # pool's scheme/host/port, since the url parameter may be a relative path.
            parsed_url = parse_url(url)
            rst_url = Url(
                scheme=parsed_url.scheme or manager.scheme,
                host=parsed_url.host or manager.host,
                port=parsed_url.port or manager.port,
                path=parsed_url.path,
                query=parsed_url.query,
                fragment=parsed_url.fragment,
            )
            # Normalize the body to a string for policy evaluation
            body = read_body(body)

            # Evaluate the request against security policies
            reason = self.callback(NetworkData(url=rst_url, method=method, headers=dict(headers), body=body))
            if reason:
                raise PermissionError(reason)

            return original_urlopen(manager, method, url, body, headers, *args, **kwargs)

        urllib3.HTTPConnectionPool.urlopen = urlopen
