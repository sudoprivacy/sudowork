"""Validate a JSON file produced by the agent.

Finds the most recent file matching `filename` in scode temp workspaces,
parses it, and checks structural invariants. No static content checks —
target data may change frequently.

Analogous to db_audit (which validates DB state), this validates file output.

Returns {"pass": bool, "reason": str, "details": dict}.
"""

import glob
import json
import os
import re

import state


async def json_audit(
    tab,
    filename: str = "output.json",
    min_items: int = 1,
    max_items: int = 0,
    required_fields: str = "",
    unique_field: str = "",
    field_patterns: str = "",
    max_empty_ratio: float = 0.1,
) -> dict:
    """Validate a JSON array file from the agent's workspace.

    Args:
        tab: CDP tab (unused, required by op signature)
        filename: Name of the JSON file to find in scode workspaces
        min_items: Minimum number of items expected (0 = no minimum)
        max_items: Maximum number of items expected (0 = no maximum)
        required_fields: Comma-separated field names each item must have
        unique_field: Field name that must be unique across all items
        field_patterns: Pipe-separated field=regex pairs for value validation
            e.g. "price=\\$[\\d,]+|url=net-a-porter\\.com"
        max_empty_ratio: Max fraction of items allowed to have empty required
            fields (0.1 = 10%)
    """
    failures = []
    details = {}

    # Find the most recent matching file, only considering files modified
    # after case start (avoids matching stale output from previous runs)
    candidates = glob.glob(os.path.expanduser(f"~/.nexus/scode-temp-*/{filename}"))
    if state.CASE_START_MS:
        cutoff = state.CASE_START_MS / 1000  # ms → seconds epoch
        candidates = [c for c in candidates if os.path.getmtime(c) > cutoff]
    if not candidates:
        return {"pass": False, "reason": f"{filename} not found (modified after case start) in any scode workspace", "details": {}}

    filepath = max(candidates, key=os.path.getmtime)
    details["filepath"] = filepath
    details["file_size"] = os.path.getsize(filepath)

    # Parse JSON
    try:
        with open(filepath) as f:
            data = json.load(f)
    except (json.JSONDecodeError, ValueError) as e:
        return {"pass": False, "reason": f"Invalid JSON: {e}", "details": details}

    if not isinstance(data, list):
        return {"pass": False, "reason": f"Expected JSON array, got {type(data).__name__}", "details": details}

    details["item_count"] = len(data)

    # Check count bounds
    if min_items and len(data) < min_items:
        failures.append(f"{len(data)} items < min {min_items}")
    if max_items and len(data) > max_items:
        failures.append(f"{len(data)} items > max {max_items}")

    # Check unique field
    if unique_field:
        values = [item.get(unique_field, "") for item in data if isinstance(item, dict)]
        unique_values = set(values)
        details["unique_count"] = len(unique_values)
        dupes = len(values) - len(unique_values)
        if dupes > 0:
            failures.append(f"{dupes} duplicate {unique_field} values")

    # Check required fields
    fields = [f.strip() for f in required_fields.split(",") if f.strip()]
    if fields:
        empty_counts = {f: 0 for f in fields}
        for item in data:
            if not isinstance(item, dict):
                continue
            for f in fields:
                if not item.get(f):
                    empty_counts[f] += 1
        for f, count in empty_counts.items():
            if count > len(data) * max_empty_ratio:
                failures.append(f"'{f}' empty in {count}/{len(data)} items ({count/len(data)*100:.0f}%)")
        details["empty_fields"] = {f: c for f, c in empty_counts.items() if c > 0}

    # Check field patterns
    if field_patterns:
        for pair in field_patterns.split("|"):
            if "=" not in pair:
                continue
            field, pattern = pair.split("=", 1)
            field = field.strip()
            pat = re.compile(pattern.strip())
            bad = sum(1 for item in data if isinstance(item, dict) and not pat.search(item.get(field, "")))
            if bad > len(data) * max_empty_ratio:
                failures.append(f"'{field}' pattern mismatch in {bad}/{len(data)} items")

    if failures:
        return {"pass": False, "reason": "; ".join(failures), "details": details}

    return {
        "pass": True,
        "reason": f"{len(data)} items, all checks passed",
        "details": details,
    }
