"""
Hook state management with Nexus polling.

This module manages the hook's enabled/fastPass state and blacklist cache
via periodic polling of the Nexus service. It mirrors the state polling logic
from the Node hook (hook/node/src/index.ts) to ensure consistent behavior
across both hook implementations.

Key responsibilities:
- Poll Nexus for enabled/fastPass state changes at configurable intervals
- Cache blacklist rules in memory for zero-latency request-path evaluation
- Provide thread-safe access to state and blacklist from interceptor callbacks
"""

import json
import logging
import threading
import time
from typing import Optional, List

from hook.nexus.nexus import Nexus, NexusError

logger = logging.getLogger("hook")

# Nexus filesystem paths for configuration
ENABLED_CONFIG_PATH = "/safe/config/enabled"
BLACKLIST_CONFIG_PATH = "/safe/config/blacklist"

# Default state for first run (matches Node hook DEFAULT_STATE)
DEFAULT_STATE = {"enabled": True, "fastPass": False}


class HookState:
    """
    Singleton managing hook enabled/fastPass state and blacklist cache via Nexus polling.

    The state is polled from the Nexus service at a configurable interval (default 3s),
    matching the Node hook's behavior. Both the enabled/fastPass state and blacklist
    rules are refreshed in the same polling loop to minimize Nexus RPC calls.

    Thread Safety:
    - `enabled` and `fast_pass` are simple boolean reads/writes (atomic in CPython)
    - `blacklist` access is guarded by `_blacklist_lock` for safe list replacement
    - Polling runs in a daemon thread that auto-terminates with the main process
    """

    _instance: Optional["HookState"] = None
    _lock = threading.Lock()

    def __init__(self, nexus_url: str, polling_interval: float = 3.0):
        """
        Args:
            nexus_url: Base URL of the Nexus service (e.g., "http://127.0.0.1:12012").
            polling_interval: Interval in seconds between state/blacklist polls.
        """
        self.nexus_url = nexus_url
        self.polling_interval = polling_interval
        self.enabled: bool = True
        self.fast_pass: bool = False
        self._blacklist: list = []
        self._blacklist_lock = threading.Lock()
        self._polling_thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()

    @classmethod
    def get_instance(cls) -> Optional["HookState"]:
        """Get the singleton instance, or None if not yet created."""
        return cls._instance

    @classmethod
    def create(cls, nexus_url: str, polling_interval: float = 3.0) -> "HookState":
        """
        Create or return the singleton HookState instance.

        Args:
            nexus_url: Base URL of the Nexus service.
            polling_interval: Interval in seconds between polls.

        Returns:
            The singleton HookState instance.
        """
        with cls._lock:
            if cls._instance is None:
                cls._instance = cls(nexus_url, polling_interval)
            return cls._instance

    def is_fast_pass(self) -> bool:
        """Check if FastPass mode is enabled (all interceptions bypassed)."""
        return self.fast_pass

    def is_enabled(self) -> bool:
        """Check if the hook is enabled."""
        return self.enabled

    def get_blacklist(self) -> list:
        """
        Get a snapshot of the current blacklist rules.

        Returns a copy of the list to prevent concurrent modification issues
        between the polling thread and interceptor callbacks.
        """
        with self._blacklist_lock:
            return list(self._blacklist)

    def read_state(self) -> Optional[dict]:
        """
        Read the current enabled/fastPass state from Nexus.

        Returns:
            A dict with 'enabled' and 'fastPass' keys, or None if unavailable.
        """
        try:
            nexus = Nexus(self.nexus_url)
            data = nexus.read(ENABLED_CONFIG_PATH)
            if isinstance(data, bytes):
                return json.loads(data.decode("utf-8"))
            return None
        except (NexusError, Exception):
            return None

    def ensure_state(self) -> dict:
        """
        Read state from Nexus, creating a default state if none exists.

        Mirrors the Node hook's ensureState() function. If no state exists
        in Nexus, writes the DEFAULT_STATE and returns it.

        Returns:
            A dict with 'enabled' and 'fastPass' keys.
        """
        state = self.read_state()
        if state is not None:
            return state

        # No state exists, write default (matches Node hook behavior)
        try:
            nexus = Nexus(self.nexus_url)
            nexus.write(
                ENABLED_CONFIG_PATH,
                json.dumps({**DEFAULT_STATE, "timestamp": int(time.time() * 1000)}),
            )
            logger.info("Created default state in Nexus")
            return dict(DEFAULT_STATE)
        except (NexusError, Exception):
            logger.warning("Failed to create default state in Nexus")
            return dict(DEFAULT_STATE)

    def start_polling(self):
        """
        Start the background polling thread for state and blacklist updates.

        The thread is a daemon thread, so it will automatically terminate when
        the main process exits. Calling this multiple times is safe — subsequent
        calls are no-ops if the thread is already running.
        """
        if self._polling_thread and self._polling_thread.is_alive():
            return
        self._stop_event.clear()
        self._polling_thread = threading.Thread(
            target=self._poll_loop, daemon=True, name="hook-state-polling"
        )
        self._polling_thread.start()
        logger.info(f"State polling started (interval: {self.polling_interval}s)")

    def stop_polling(self):
        """Signal the polling thread to stop."""
        self._stop_event.set()

    def _poll_loop(self):
        """
        Main polling loop that refreshes state and blacklist from Nexus.

        Combines state and blacklist polling into a single loop to minimize
        the number of polling threads and coordinate update timing. Each
        iteration makes at most 2 Nexus RPC calls (state + blacklist).
        """
        while not self._stop_event.is_set():
            self._update_state()
            self._update_blacklist()
            self._stop_event.wait(self.polling_interval)

    def _update_state(self):
        """Refresh enabled/fastPass state from Nexus."""
        try:
            state = self.read_state()
            if state:
                self.fast_pass = state.get("fastPass", False)
                self.enabled = state.get("enabled", True)
        except Exception:
            pass

    def _update_blacklist(self):
        """
        Refresh blacklist rules from Nexus into the in-memory cache.

        The blacklist is stored as a list of dicts (raw Nexus format) and
        deserialized into BlacklistRule objects by the caller (NexusController).
        This avoids importing BlacklistRule here and keeps the dependency
        direction clean (state -> nexus only).
        """
        try:
            nexus = Nexus(self.nexus_url)
            data = nexus.read(BLACKLIST_CONFIG_PATH)
            if isinstance(data, bytes):
                parsed = json.loads(data.decode("utf-8"))
                rules = parsed.get("rules", [])
                # Import here to avoid circular dependency
                from hook.nexus.blacklist import BlacklistRule

                blacklist = [BlacklistRule.from_dict(r) for r in rules]
                with self._blacklist_lock:
                    self._blacklist = blacklist
        except Exception:
            pass
