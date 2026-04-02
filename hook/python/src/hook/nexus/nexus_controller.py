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
    def __init__(self, url: str, timeout: Optional[timedelta] = None):
        super().__init__(url)
        self.timeout = timeout

        self.blacklist_update_interval = timedelta(seconds=5)
        self.blacklist: List[BlacklistRule] = []
        self.blacklist_lock = threading.Lock()
        self.blacklist_update_time = datetime.now()
        self._update_blacklist()

    def control(self, payload: NexusPayload) -> Optional[str]:
        if self.allow_payload(payload):
            return None

        event_id = str(uuid4())
        event_file, action_file = f"/safe/event/{event_id}", f"/safe/action/{event_id}"

        try:
            self.write(event_file, payload.marshal())
            result = self.read_until_exists(action_file, timeout=self.timeout)
            action_result = json.loads(result)
            if not action_result.get("allow", False):
                return action_result.get("reason", "Security Violation: request was DENIED")
            return None
        except NexusError as e:
            return str(e)
        finally:
            # noinspection PyBroadException
            try:
                self.delete_bulk([action_file])
            except:
                pass

    def allow_payload(self, payload: NexusPayload) -> bool:
        if payload.type == NexusPayloadType.NETWORK:
            url = payload.data.url
            if url_origin(url) == self.base_url:
                return True
            if url.host.lower() in ("127.0.0.1", "localhost", "[::1]", "::1"):
                return True

        self._update_blacklist()
        return allow_data(self.blacklist, payload)

    def _update_blacklist(self):
        if datetime.now() < self.blacklist_update_time:
            return

        with self.blacklist_lock:
            try:
                data = json.loads(self.read("/safe/config/blacklist", return_metadata=False))
                self.blacklist = [BlacklistRule.from_dict(rule) for rule in data.get("rules", [])]
                self.blacklist_update_time = datetime.now() + self.blacklist_update_interval
            except Exception as e:
                logger.error(f"update blacklist failed, error: {e}")
