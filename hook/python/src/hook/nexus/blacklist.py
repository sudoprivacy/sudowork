import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import PurePosixPath
from typing import Optional, Dict, Any, List, Literal

from hook.nexus.common import NexusPayloadType, NexusPayload, NetworkData, FileData, ProcessData, url_origin


@dataclass
class BlacklistRule:
    id: str
    enabled: bool
    type: NexusPayloadType
    pattern: str
    match_type: Literal["exact", "wildcard"]
    risk_level: str
    description: Optional[str]
    created_at: datetime
    updated_at: datetime

    @staticmethod
    def from_dict(rule: Dict[str, Any]) -> BlacklistRule:
        return BlacklistRule(
            id=rule["id"],
            enabled=rule["enabled"],
            type=NexusPayloadType(rule["type"]),
            pattern=rule["pattern"],
            match_type=rule["matchType"],
            risk_level=rule["riskLevel"],
            description=rule["description"],
            created_at=datetime.fromtimestamp(rule["createdAt"] / 1000),
            updated_at=datetime.fromtimestamp(rule["updatedAt"] / 1000),
        )


def match_wildcard(pattern: str, value: str) -> bool:
    """
    Match a value against a pattern
    """
    # convert wildcard pattern to regex, "*.example.com" -> r".*\.example\.com"
    pattern = re.escape(pattern).replace(r"\*", ".*")
    try:
        return bool(re.fullmatch(rf"^{pattern}$", value, re.IGNORECASE))
    except re.error:
        return False


def filter_network_data(rule: BlacklistRule, data: NetworkData) -> bool:
    if rule.match_type == "wildcard":
        # normalize pattern
        pattern = re.sub(r"^https?://|/\*$|/$", "", rule.pattern)
        return match_wildcard(pattern, data.url.host)
    elif rule.match_type == "exact":
        return rule.pattern in (data.url.host, str(data.url), url_origin(data.url))
    else:
        return False


def filter_file_data(rule: BlacklistRule, data: FileData) -> bool:
    pattern, path = str(PurePosixPath(rule.pattern)), str(PurePosixPath(data.path))
    if rule.match_type == "wildcard":
        return match_wildcard(pattern, path)
    elif rule.match_type == "exact":
        return pattern == path
    else:
        return False


def filter_process_data(rule: BlacklistRule, data: ProcessData) -> bool:
    if rule.match_type == "wildcard":
        return match_wildcard(rule.pattern, data.command)
    elif rule.match_type == "exact":
        return rule.pattern == data.command
    else:
        return False


_filter_func_map = {
    NexusPayloadType.NETWORK: filter_network_data,
    NexusPayloadType.FILE: filter_file_data,
    NexusPayloadType.PROCESS: filter_process_data,
}


def allow_data(blacklist: List[BlacklistRule], payload: NexusPayload) -> bool:
    filter_func = _filter_func_map.get(payload.type)
    return not (
        any(rule.enabled and rule.type == payload.type and filter_func(rule, payload.data) for rule in blacklist)
        if filter_func
        else False
    )
