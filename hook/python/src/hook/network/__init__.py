"""Network request interception subpackage — intercepts outgoing HTTP requests via urllib3."""

from hook.network.common import NetworkData, NetworkCallback
from hook.network.urllib3_ import Urllib3Interceptor
