"""
Hook package initialization module.

This module serves as the entry point for the security hook system. It automatically
sets up interceptors for file I/O, network requests, and process execution when imported.
Each interceptor is wired to the Nexus controller, which decides whether to allow or
deny the intercepted operation based on security policies and blacklist rules.
"""

from hook.file import FileData, FileInterceptor
from hook.network import NetworkData, Urllib3Interceptor
from hook.nexus import NexusPayload, NexusPayloadType, NexusController
from hook.process import ProcessData, ProcessInterceptor


def build_callback(payload_type: NexusPayloadType):
    """
    Factory function that creates a callback for a given payload type.

    The returned callback wraps the intercepted operation data into a NexusPayload
    and sends it to the Nexus controller for security policy evaluation.

    Args:
        payload_type: The type of payload (FILE, NETWORK, or PROCESS).

    Returns:
        A callback function that accepts operation data and returns an optional
        denial reason string. Returns None if the operation is allowed.
    """

    def callback(data):
        return nexus_controller.control(NexusPayload(type=payload_type, data=data))

    return callback


# noinspection PyBroadException
try:
    # Initialize the Nexus controller that communicates with the local Nexus security service.
    nexus_controller = NexusController("http://127.0.0.1:12012")

    # Set up all interceptors. Once set up, every file open, HTTP request, and subprocess
    # execution will be checked against the Nexus security policies before proceeding.
    Urllib3Interceptor(build_callback(NexusPayloadType.NETWORK)).setup()

    FileInterceptor(build_callback(NexusPayloadType.FILE)).setup()

    ProcessInterceptor(build_callback(NexusPayloadType.PROCESS)).setup()
except Exception:
    pass
