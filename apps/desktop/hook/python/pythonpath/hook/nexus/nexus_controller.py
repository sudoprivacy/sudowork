"""
Nexus security controller module.

This module implements the high-level security control flow. When an intercepted
operation is not auto-allowed by local rules (blacklist or localhost exemptions),
the controller writes a security event to the Nexus service and waits for an
action decision (allow/deny) from the security control plane, which may involve
human review.
"""

import json
import logging
import threading
from datetime import timedelta, datetime
from typing import Optional, List
from uuid import uuid4

from hook.nexus.blacklist import BlacklistRule, allow_data
from hook.nexus.common import NexusPayload, NexusPayloadType, url_origin
from hook.nexus.nexus import Nexus, NexusError

logger = logging.getLogger("nexus")


class NexusController(Nexus):
    """
    Security controller that evaluates intercepted operations against policies.

    Extends the Nexus client with security-specific logic: local blacklist filtering,
    localhost exemptions, and an event-driven allow/deny workflow via the Nexus service.

    The blacklist is periodically refreshed from the Nexus service to stay in sync
    with the latest security policies.
    """

    def __init__(self, url: str, timeout: Optional[timedelta] = None):
        """
        Args:
            url: Base URL of the Nexus service.
            timeout: Maximum time to wait for an action decision from the control plane.
                     If None, waits indefinitely.
        """
        super().__init__(url)
        self.timeout = timeout

        # Blacklist is refreshed from the Nexus service at this interval
        self.blacklist_update_interval = timedelta(seconds=5)
        self.blacklist: List[BlacklistRule] = []
        self.blacklist_lock = threading.Lock()  # Guards concurrent blacklist updates
        self.blacklist_update_time = datetime.now()
        self._update_blacklist()

    def control(self, payload: NexusPayload) -> Optional[str]:
        """
        Main entry point: evaluate an intercepted operation and return allow/deny decision.

        Flow:
        1. Check if the payload is auto-allowed (localhost, blacklist not matched).
        2. If not auto-allowed, write a security event to Nexus and wait for a decision.
        3. Clean up the action file after reading the decision.

        Args:
            payload: The intercepted operation data (file, network, or process).

        Returns:
            None if the operation is allowed, or a denial reason string if blocked.
        """
        if self.allow_payload(payload):
            return None

        # Generate a unique event ID and create corresponding file paths on Nexus
        event_id = str(uuid4())
        event_file, action_file = f"/safe/event/{event_id}", f"/safe/action/{event_id}"

        try:
            # Write the security event for the control plane to review
            self.write(event_file, payload.marshal())
            # Block until the control plane writes an action decision
            result = self.read_until_exists(action_file, timeout=self.timeout)
            action_result = json.loads(result)
            if not action_result.get("allow", False):
                return action_result.get("reason", "Security Violation: request was DENIED")
            return None
        except NexusError as e:
            return str(e)
        finally:
            # Clean up the action file regardless of outcome
            # noinspection PyBroadException
            try:
                self.delete_bulk([action_file])
            except:
                pass

    def allow_payload(self, payload: NexusPayload) -> bool:
        """
        Check if a payload should be automatically allowed without consulting the control plane.

        Auto-allow rules:
        - Network requests to the Nexus service itself (to avoid infinite recursion).
        - Network requests to localhost/loopback addresses.
        - Operations not matching any enabled blacklist rule.

        Args:
            payload: The intercepted operation payload.

        Returns:
            True if auto-allowed, False if it needs control plane evaluation.
        """
        if payload.type == NexusPayloadType.NETWORK:
            url = payload.data.url
            # Always allow requests to the Nexus service itself to prevent recursion
            if url_origin(url) == self.base_url:
                return True
            # Always allow localhost/loopback traffic
            if url.host.lower() in ("127.0.0.1", "localhost", "[::1]", "::1"):
                return True

        # Check against the locally-cached blacklist rules
        try:
            self._update_blacklist()
        except Exception as e:
            logger.error(f"update blacklist failed, error: {e}")
        return allow_data(self.blacklist, payload)

    def _update_blacklist(self):
        """
        Refresh the blacklist from the Nexus service if the update interval has elapsed.

        Uses a threading lock to prevent concurrent updates. Errors during refresh
        are logged but do not interrupt the hook's operation (stale blacklist is kept).
        """
        if datetime.now() < self.blacklist_update_time:
            return

        with self.blacklist_lock:
            data = json.loads(self.read("/safe/config/blacklist", return_metadata=False))
            self.blacklist = [BlacklistRule.from_dict(rule) for rule in data.get("rules", [])]
            self.blacklist_update_time = datetime.now() + self.blacklist_update_interval
