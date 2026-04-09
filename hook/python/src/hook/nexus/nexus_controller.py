"""
Nexus security controller module.

This module implements the high-level security control flow. When an intercepted
operation is not auto-allowed by local rules (blacklist or localhost exemptions),
the controller writes a security event to the Nexus service and waits for an
action decision (allow/deny) from the security control plane, which may involve
human review.

Production integration features (aligned with Node hook):
- FastPass mode: bypasses all interception when enabled
- Blacklist cache decoupling: uses HookState's polled blacklist instead of
  synchronous Nexus reads on each request
- Localhost whitelist: auto-allows all localhost/loopback network requests
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

# Localhost patterns that should always be allowed (system-level whitelist)
# Matches Node hook's LOCALHOST_PATTERNS in NexusController.ts
LOCALHOST_PATTERNS = frozenset({
    "127.0.0.1",
    "localhost",
    "[::1]",
    "::1",
})


class NexusController(Nexus):
    """
    Security controller that evaluates intercepted operations against policies.

    Extends the Nexus client with security-specific logic: FastPass bypass,
    local blacklist filtering, localhost exemptions, and an event-driven
    allow/deny workflow via the Nexus service.

    The blacklist is now sourced from HookState's polling cache (Phase 2.3),
    eliminating synchronous Nexus reads from the request path.
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

        # Fallback blacklist for when HookState is not available
        self.blacklist_update_interval = timedelta(seconds=5)
        self.blacklist: List[BlacklistRule] = []
        self.blacklist_lock = threading.Lock()
        self.blacklist_update_time = datetime.now()
        self._init_blacklist()

    def _init_blacklist(self):
        """Initialize blacklist on first load, with error tolerance."""
        try:
            self._update_blacklist()
        except Exception:
            pass

    def control(self, payload: NexusPayload) -> Optional[str]:
        """
        Main entry point: evaluate an intercepted operation and return allow/deny decision.

        Flow:
        1. Check FastPass mode — if enabled, allow immediately.
        2. Check if the payload is auto-allowed (localhost, blacklist not matched).
        3. If not auto-allowed, write a security event to Nexus and wait for a decision.
        4. Clean up the action file after reading the decision.

        Args:
            payload: The intercepted operation data (file, network, or process).

        Returns:
            None if the operation is allowed, or a denial reason string if blocked.
        """
        # FastPass: bypass all interception (aligned with Node hook NexusController.ts L96-98)
        from hook.state import HookState

        state = HookState.get_instance()
        if state and state.is_fast_pass():
            return None

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

        Blacklist source priority:
        1. HookState polled cache (zero Nexus I/O on request path)
        2. Local fallback blacklist (synchronous Nexus read, legacy behavior)

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
            # Always allow localhost/loopback traffic (system-level whitelist)
            if url.host and url.host.lower() in LOCALHOST_PATTERNS:
                return True

        # Get blacklist from HookState cache (Phase 2.3: decoupled from request path)
        from hook.state import HookState

        state = HookState.get_instance()
        if state:
            blacklist = state.get_blacklist()
        else:
            # Fallback: synchronous update (legacy behavior for backward compatibility)
            try:
                self._update_blacklist()
            except Exception as e:
                logger.error(f"update blacklist failed, error: {e}")
            blacklist = self.blacklist

        return allow_data(blacklist, payload)

    def _update_blacklist(self):
        """
        Refresh the blacklist from the Nexus service if the update interval has elapsed.

        This is the fallback path used only when HookState is not available.
        In normal operation, blacklist updates are handled by HookState's polling thread.

        Uses a threading lock to prevent concurrent updates. Errors during refresh
        are logged but do not interrupt the hook's operation (stale blacklist is kept).

        Reads from the unified hook config (/safe/config/hook) and extracts the
        blacklist section.
        """
        if datetime.now() < self.blacklist_update_time:
            return

        with self.blacklist_lock:
            from hook.state import HOOK_CONFIG_PATH

            config = json.loads(self.read(HOOK_CONFIG_PATH, return_metadata=False))
            blacklist_data = config.get("blacklist", {})
            rules = blacklist_data.get("rules", []) if isinstance(blacklist_data, dict) else []
            self.blacklist = [BlacklistRule.from_dict(rule) for rule in rules]
            self.blacklist_update_time = datetime.now() + self.blacklist_update_interval
