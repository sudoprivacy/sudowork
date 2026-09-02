"""
urllib3 network interceptor module.

This module monkey-patches urllib3's HTTPConnectionPool.urlopen method to intercept
all outgoing HTTP requests made through urllib3 (which is also the transport layer
for popular libraries like requests and httpx). Each request is evaluated against
security policies before being allowed to proceed.

Production integration features (aligned with Node hook):
- Interceptor-level Nexus URL early exit: Nexus RPC requests are detected by
  matching pool host/port/scheme and bypass the entire interception chain with
  zero overhead (Phase 2.2, mirrors Node hook index.ts L71)
- Localhost whitelist: all requests to localhost/loopback addresses are allowed
  without URL parsing, body reading, or callback invocation (mirrors Node hook
  NexusController.ts LOCALHOST_PATTERNS)
- Body preservation: original body object is passed to the real urlopen, preventing
  file-like body consumption issues (Phase 3.3)
"""

import logging
from typing import Optional, Mapping, Union

from hook.network.common import NetworkCallback, _TYPE_BODY, read_body, NetworkData

logger = logging.getLogger("hook")

# Localhost patterns that should always be allowed (system-level whitelist)
# Matches Node hook's LOCALHOST_PATTERNS in NexusController.ts L12-17
LOCALHOST_PATTERNS = frozenset({
    "127.0.0.1",
    "localhost",
    "[::1]",
    "::1",
})


class Urllib3Interceptor:
    """
    Interceptor that hooks into urllib3's connection pool to enforce network access policies.

    When setup() is called, urllib3.HTTPConnectionPool.urlopen is replaced with a
    wrapper that evaluates each outgoing request through the provided callback before
    delegating to the original implementation.

    The interceptor implements a two-layer filtering architecture (matching Node hook):
    - Layer 1 (interceptor-level): Nexus URL and localhost early exit — zero overhead
    - Layer 2 (controller-level): Full security evaluation for external requests
    """

    def __init__(self, callback: NetworkCallback, nexus_url: str = "http://127.0.0.1:12012"):
        """
        Args:
            callback: A function that evaluates network requests. It receives a
                      NetworkData object and returns None to allow, or a denial
                      reason string to block the request.
            nexus_url: Base URL of the Nexus service (used for interceptor-level
                       early exit to avoid self-interception).
        """
        self.callback = callback
        self.nexus_url = nexus_url

    def setup(self):
        """
        Replace urllib3's HTTPConnectionPool.urlopen with the intercepting wrapper.

        The wrapper implements a fast-path for Nexus and localhost requests that
        bypasses URL parsing, body reading, and callback invocation entirely.

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

        # Pre-parse Nexus URL for fast comparison in the hot path
        nexus_parsed = parse_url(self.nexus_url)
        nexus_host = nexus_parsed.host       # e.g., "127.0.0.1"
        nexus_port = nexus_parsed.port       # e.g., 12012
        nexus_scheme = nexus_parsed.scheme   # e.g., "http"

        callback = self.callback

        def urlopen(
            manager: urllib3.HTTPConnectionPool,
            method: str,
            url: str,
            body: Union[_TYPE_BODY, None] = None,
            headers: Optional[Mapping[str, str]] = None,
            *args,
            **kwargs,
        ):
            # ================================================================
            # Layer 1: Interceptor-level early exit (zero overhead fast path)
            # ================================================================
            #
            # Uses HTTPConnectionPool's already-resolved host/port/scheme
            # attributes to avoid any URL parsing or body reading.
            #
            # Order:
            # 1. Nexus URL exact match → direct passthrough (prevent self-interception)
            # 2. Localhost whitelist → direct passthrough (local services are safe)
            #
            # This mirrors Node hook's request handler in index.ts L71:
            #   if (request.url.startsWith(nexusUrl)) { return; }
            # and NexusController.ts L101:
            #   if (payload.type === 'network' && isLocalhostRequest(payload.data.url))

            pool_host = getattr(manager, "host", None)
            pool_port = getattr(manager, "port", None)
            pool_scheme = getattr(manager, "scheme", None)

            # 1. Nexus URL exact match (equivalent to Node hook's url.startsWith(nexusUrl))
            if (
                pool_host == nexus_host
                and pool_port == nexus_port
                and pool_scheme == nexus_scheme
            ):
                return original_urlopen(manager, method, url, body, headers, *args, **kwargs)

            # 2. Localhost whitelist (matches Node hook's LOCALHOST_PATTERNS)
            if pool_host and pool_host.lower() in LOCALHOST_PATTERNS:
                return original_urlopen(manager, method, url, body, headers, *args, **kwargs)

            # ================================================================
            # Layer 2: Full security evaluation for external requests
            # ================================================================

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

            # Save original body and read a copy for policy evaluation (Phase 3.3)
            # This prevents file-like body objects from being consumed before
            # the real urlopen can use them.
            original_body = body
            body_str = read_body(body) if body is not None else ""

            # Evaluate the request against security policies
            reason = callback(
                NetworkData(url=rst_url, method=method, headers=dict(headers or {}), body=body_str)
            )
            if reason:
                raise PermissionError(reason)

            # Pass original body to preserve file-like objects and streaming bodies
            return original_urlopen(manager, method, url, original_body, headers, *args, **kwargs)

        urllib3.HTTPConnectionPool.urlopen = urlopen
