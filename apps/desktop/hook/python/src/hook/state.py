"""
Hook state management with Nexus polling.

This module manages the hook's enabled/fastPass state and blacklist cache
via periodic polling of the Nexus service. It mirrors the state polling logic
from the Node hook (hook/node/src/index.ts) to ensure consistent behavior
across both hook implementations.

Key responsibilities:
- Poll Nexus unified config (/safe/config/hook) for state + blacklist in a single RPC call
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

# Unified hook config path: combines enabled state + blacklist in one file
HOOK_CONFIG_PATH = "/safe/config/hook"

# Default unified config for first run (matches Node hook DEFAULT_STATE + empty blacklist)
DEFAULT_STATE = {"enabled": True, "fastPass": False}
DEFAULT_HOOK_CONFIG = {"enabled": True, "fastPass": False, "blacklist": {"rules": []}}


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

    def read_hook_config(self) -> Optional[dict]:
        """
        Read the unified hook config from Nexus.

        Returns:
            The full config dict (enabled, fastPass, blacklist, etc.), or None if unavailable.
        """
        try:
            nexus = Nexus(self.nexus_url)
            data = nexus.read(HOOK_CONFIG_PATH)
            if isinstance(data, bytes):
                return json.loads(data.decode("utf-8"))
            return None
        except (NexusError, Exception):
            return None

    def read_state(self) -> Optional[dict]:
        """
        Read the current enabled/fastPass state from Nexus (unified config).

        Returns:
            A dict with 'enabled' and 'fastPass' keys, or None if unavailable.
        """
        config = self.read_hook_config()
        if config is not None:
            return {"enabled": config.get("enabled", True), "fastPass": config.get("fastPass", False)}
        return None

    def ensure_state(self) -> dict:
        """
        Read state from Nexus, creating a default unified config if none exists.

        Mirrors the Node hook's ensureState() function. If no config exists
        in Nexus, writes the DEFAULT_HOOK_CONFIG and returns the state portion.

        Returns:
            A dict with 'enabled' and 'fastPass' keys.
        """
        config = self.read_hook_config()
        if config is not None:
            return {"enabled": config.get("enabled", True), "fastPass": config.get("fastPass", False)}

        # No config exists, write default unified config (matches Node hook behavior)
        try:
            nexus = Nexus(self.nexus_url)
            nexus.write(
                HOOK_CONFIG_PATH,
                json.dumps({**DEFAULT_HOOK_CONFIG, "timestamp": int(time.time() * 1000)}),
            )
            logger.info("Created default unified config in Nexus")
            return dict(DEFAULT_STATE)
        except (NexusError, Exception):
            logger.warning("Failed to create default config in Nexus")
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

        Reads the unified hook config in a single RPC call per iteration,
        then updates both enabled/fastPass state and blacklist cache from
        the same response. This minimizes Nexus request volume.
        """
        while not self._stop_event.is_set():
            self._update_config()
            self._stop_event.wait(self.polling_interval)

    def _update_config(self):
        """
        Refresh both enabled/fastPass state and blacklist from Nexus in a single RPC call.

        Reads the unified hook config (/safe/config/hook) once and extracts:
        - enabled/fastPass state for FastPass bypass and hook enable/disable
        - blacklist rules for in-memory cache used by NexusController
        """
        try:
            config = self.read_hook_config()
            if not config:
                return

            # Update state
            self.fast_pass = config.get("fastPass", False)
            self.enabled = config.get("enabled", True)

            # Update blacklist
            blacklist_data = config.get("blacklist", {})
            if isinstance(blacklist_data, dict):
                rules = blacklist_data.get("rules", [])
                # Import here to avoid circular dependency
                from hook.nexus.blacklist import BlacklistRule

                blacklist = [BlacklistRule.from_dict(r) for r in rules]
                with self._blacklist_lock:
                    self._blacklist = blacklist
        except Exception:
            pass
