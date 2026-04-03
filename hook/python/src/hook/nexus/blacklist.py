"""
Blacklist rule engine for local security policy evaluation.

This module implements client-side blacklist filtering that can quickly deny
operations matching known-bad patterns without needing a round-trip to the
Nexus service. It supports both exact-match and wildcard-match rules for
network hosts, file paths, and process commands.
"""

import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import PurePosixPath
from typing import Optional, Dict, Any, List, Literal

from hook.nexus.common import NexusPayloadType, NexusPayload, NetworkData, FileData, ProcessData, url_origin


@dataclass
class BlacklistRule:
    """
    A single blacklist rule defining a pattern to match against intercepted operations.

    Attributes:
        id: Unique identifier for this rule.
        enabled: Whether the rule is currently active.
        type: The operation type this rule applies to (file, network, or process).
        pattern: The pattern string to match against (e.g., "*.malicious.com").
        match_type: How to interpret the pattern - "exact" for literal match,
                    "wildcard" for glob-style matching with '*'.
        risk_level: Severity level of the rule (e.g., "high", "medium", "low").
        description: Optional human-readable description of why this rule exists.
        created_at: Timestamp when the rule was created.
        updated_at: Timestamp when the rule was last modified.
    """

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
    def from_dict(rule: Dict[str, Any]) -> "BlacklistRule":
        """
        Deserialize a BlacklistRule from a dictionary (as returned by the Nexus API).

        Timestamps are expected as millisecond-precision Unix epochs.
        """
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
    Match a value against a wildcard pattern (case-insensitive).

    Converts the wildcard pattern to a regex by escaping all special characters
    and replacing '*' with '.*'.

    Examples:
        match_wildcard("*.example.com", "sub.example.com") -> True
        match_wildcard("*.example.com", "other.org") -> False

    Args:
        pattern: A wildcard pattern where '*' matches any sequence of characters.
        value: The string to test against the pattern.

    Returns:
        True if the value matches the pattern, False otherwise.
    """
    # Convert wildcard pattern to regex: "*.example.com" -> r".*\.example\.com"
    pattern = re.escape(pattern).replace(r"\*", ".*")
    try:
        return bool(re.fullmatch(rf"^{pattern}$", value, re.IGNORECASE))
    except re.error:
        return False


def filter_network_data(rule: BlacklistRule, data: NetworkData) -> bool:
    """Check if a network request matches the given blacklist rule."""
    if rule.match_type == "wildcard":
        # Strip protocol prefix and trailing slashes/wildcards from pattern to isolate the host
        pattern = re.sub(r"^https?://|/\*$|/$", "", rule.pattern)
        return match_wildcard(pattern, data.url.host)
    elif rule.match_type == "exact":
        # Match against host, full URL, or origin (scheme://host:port)
        return rule.pattern in (data.url.host, str(data.url), url_origin(data.url))
    else:
        return False


def filter_file_data(rule: BlacklistRule, data: FileData) -> bool:
    """Check if a file operation matches the given blacklist rule."""
    # Normalize paths to POSIX format for consistent cross-platform comparison
    pattern, path = str(PurePosixPath(rule.pattern)), str(PurePosixPath(data.path))
    if rule.match_type == "wildcard":
        return match_wildcard(pattern, path)
    elif rule.match_type == "exact":
        return pattern == path
    else:
        return False


def filter_process_data(rule: BlacklistRule, data: ProcessData) -> bool:
    """Check if a process execution matches the given blacklist rule."""
    if rule.match_type == "wildcard":
        return match_wildcard(rule.pattern, data.command)
    elif rule.match_type == "exact":
        return rule.pattern == data.command
    else:
        return False


# Dispatch table mapping payload types to their corresponding filter functions.
_filter_func_map = {
    NexusPayloadType.NETWORK: filter_network_data,
    NexusPayloadType.FILE: filter_file_data,
    NexusPayloadType.PROCESS: filter_process_data,
}


def allow_data(blacklist: List[BlacklistRule], payload: NexusPayload) -> bool:
    """
    Evaluate a payload against all blacklist rules to determine if it should be allowed.

    Iterates through all enabled rules of the matching type. If any rule matches
    the payload data, the operation is denied (returns False).

    Args:
        blacklist: The list of all blacklist rules to evaluate against.
        payload: The intercepted operation payload to check.

    Returns:
        True if the operation is allowed (no matching rule), False if it should be blocked.
    """
    filter_func = _filter_func_map.get(payload.type)
    return not (
        any(rule.enabled and rule.type == payload.type and filter_func(rule, payload.data) for rule in blacklist)
        if filter_func
        else False
    )
