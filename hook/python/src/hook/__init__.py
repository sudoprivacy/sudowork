"""
Hook package initialization module.

This module serves as the entry point for the security hook system. It mirrors
the bootstrap flow from the Node hook (hook/node/src/index.ts) to ensure
consistent behavior across both implementations.

Bootstrap sequence:
1. Check environment variables for early exit (SUDOWORK_SAFETY_HOOK, SUDOWORK_ACP_CHILD)
2. Wait for Nexus service to be ready (up to 30 retries with 1s interval)
3. Read or create default enabled/fastPass state
4. If FastPass enabled: skip interceptor initialization, start polling only
5. If disabled: start polling only
6. If enabled: initialize all interceptors, then start polling

Production features:
- FastPass mode: bypasses all interception when enabled
- State polling: monitors enabled/fastPass changes every 3 seconds
- Blacklist polling: caches blacklist in memory (decoupled from request path)
- Nexus Ready wait: retries connection up to 30 times before fallback
- Graceful shutdown: stops polling thread on process exit
"""

import atexit
import logging
import os
import time

logger = logging.getLogger("hook")

# Default Nexus service URL
DEFAULT_NEXUS_URL = "http://127.0.0.1:12012"

# Default polling interval in seconds (matches Node hook's 3000ms)
DEFAULT_POLL_INTERVAL = 3.0

# Maximum retries waiting for Nexus to be ready (matches Node hook's 30)
DEFAULT_MAX_RETRIES = 30


def wait_for_nexus(nexus_url: str, max_retries: int = DEFAULT_MAX_RETRIES) -> bool:
    """
    Wait for the Nexus service to become ready.

    Mirrors the Node hook's waitForNexusReady() function. Attempts to read
    the enabled state config to verify Nexus is responding.

    Args:
        nexus_url: Base URL of the Nexus service.
        max_retries: Maximum number of retry attempts (1 second between retries).

    Returns:
        True if Nexus is ready, False if all retries exhausted.
    """
    from hook.nexus.nexus import Nexus, NexusError

    for i in range(max_retries):
        try:
            Nexus(nexus_url).read("/safe/config/enabled")
            return True
        except (NexusError, Exception):
            if i < max_retries - 1:
                time.sleep(1)
    return False


def bootstrap():
    """
    Bootstrap the safety hook system.

    Mirrors the Node hook's bootstrap() function in index.ts:
    1. Wait for Nexus to be ready
    2. Read state from Nexus (create default if missing)
    3. Initialize or skip based on state (enabled/fastPass)

    Environment variables:
    - SUDOWORK_SAFETY_HOOK=false: Completely disable the Python hook
    - SUDOWORK_ACP_CHILD=1: Skip initialization for ACP bridge child processes
    - NEXUS_URL: Override the default Nexus service URL
    - HOOK_POLL_INTERVAL: Override the default polling interval (seconds)
    """
    from hook.state import HookState
    from hook.nexus import NexusController, NexusPayload, NexusPayloadType
    from hook.file import FileInterceptor
    from hook.network import Urllib3Interceptor
    from hook.process import ProcessInterceptor

    # Environment variable: disable hook entirely (matches Node hook's SUDOWORK_SAFETY_HOOK)
    if os.environ.get("SUDOWORK_SAFETY_HOOK") == "false":
        return

    # Environment variable: skip ACP bridge child processes (matches Node hook's SUDOWORK_ACP_CHILD)
    if os.environ.get("SUDOWORK_ACP_CHILD") == "1":
        return

    # Configuration from environment
    nexus_url = os.environ.get("NEXUS_URL", DEFAULT_NEXUS_URL)
    poll_interval = float(os.environ.get("HOOK_POLL_INTERVAL", str(DEFAULT_POLL_INTERVAL)))

    # Create the singleton state manager
    state = HookState.create(nexus_url, poll_interval)

    # Wait for Nexus to be ready (up to 30 seconds, matching Node hook)
    nexus_ready = wait_for_nexus(nexus_url, max_retries=DEFAULT_MAX_RETRIES)
    if not nexus_ready:
        logger.warning("Nexus not ready after retries, starting polling anyway")
        state.start_polling()
        return

    # Read or create state in Nexus (matches Node hook's ensureState())
    current = state.ensure_state()
    state.fast_pass = current.get("fastPass", False)
    state.enabled = current.get("enabled", True)

    logger.info(f"State from Nexus: enabled={state.enabled}, fastPass={state.fast_pass}")

    if state.is_fast_pass():
        # FastPass enabled: skip interceptor initialization, just poll
        # (matches Node hook behavior: dispose interceptors on fastPass)
        logger.info("FastPass enabled, skipping interceptor initialization")
        state.start_polling()
        return

    if not state.is_enabled():
        # Hook disabled: just poll for state changes
        logger.info("Hook disabled, starting polling only")
        state.start_polling()
        return

    # Initialize the Nexus controller and interceptors
    nexus_controller = NexusController(nexus_url)

    def build_callback(payload_type):
        """
        Factory function that creates a callback for a given payload type.

        The returned callback wraps the intercepted operation data into a NexusPayload
        and sends it to the Nexus controller for security policy evaluation.
        """

        def callback(data):
            return nexus_controller.control(NexusPayload(type=payload_type, data=data))

        return callback

    # Set up interceptors with nexus_url passed to Urllib3Interceptor for
    # interceptor-level localhost whitelist (Phase 2.2)
    Urllib3Interceptor(build_callback(NexusPayloadType.NETWORK), nexus_url=nexus_url).setup()
    FileInterceptor(build_callback(NexusPayloadType.FILE)).setup()
    ProcessInterceptor(build_callback(NexusPayloadType.PROCESS)).setup()

    # Start state + blacklist polling
    state.start_polling()

    logger.info("Hook initialized successfully")


def _cleanup():
    """
    Graceful shutdown: stop the polling thread on process exit.

    Registered via atexit to ensure clean thread termination.
    """
    from hook.state import HookState

    state = HookState.get_instance()
    if state:
        state.stop_polling()


# Register cleanup handler
atexit.register(_cleanup)

# Auto-bootstrap when imported (matches Node hook's auto-apply behavior)
# noinspection PyBroadException
try:
    bootstrap()
except Exception:
    pass
