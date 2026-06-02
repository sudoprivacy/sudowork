"""Validate a crawl output JSON file produced by the agent.

Finds the most recent file matching `filename` in scode temp workspaces,
parses it, and checks structural invariants (field presence, count
thresholds, format patterns). No static content checks — the target
site's data changes frequently.

Returns {"pass": bool, "reason": str, "details": dict}.
"""

import glob
import json
import os
import re


async def validate_crawl_json(
    tab,
    filename: str = "products.json",
    min_items: int = 100,
    required_fields: str = "brand,name,price,url",
    price_pattern: str = r"\$[\d,]+",
    url_contains: str = "net-a-porter.com",
) -> dict:
    """Validate a crawl output JSON file.

    Args:
        tab: CDP tab (unused, required by op signature)
        filename: Name of the JSON file to find
        min_items: Minimum number of items expected
        required_fields: Comma-separated field names each item must have
        price_pattern: Regex that price field must match
        url_contains: Substring that url field must contain
    """
    fields = [f.strip() for f in required_fields.split(",")]
    failures = []
    details = {}

    # Find the most recent matching file in scode temp dirs
    candidates = glob.glob(os.path.expanduser(f"~/.nexus/scode-temp-*/{filename}"))
    if not candidates:
        return {"pass": False, "reason": f"{filename} not found in any scode workspace", "details": {}}

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

    # Check minimum count
    if len(data) < min_items:
        failures.append(f"Only {len(data)} items, expected >= {min_items}")

    # Check unique URLs
    urls = [item.get("url", "") for item in data if isinstance(item, dict)]
    unique_urls = set(urls)
    details["unique_urls"] = len(unique_urls)
    duplicates = len(urls) - len(unique_urls)
    if duplicates > 0:
        failures.append(f"{duplicates} duplicate URLs")

    # Validate fields on a sample
    empty_fields = {f: 0 for f in fields}
    bad_price = 0
    bad_url = 0
    price_re = re.compile(price_pattern) if price_pattern else None

    for item in data:
        if not isinstance(item, dict):
            continue
        for f in fields:
            if not item.get(f):
                empty_fields[f] += 1
        if price_re and not price_re.search(item.get("price", "")):
            bad_price += 1
        if url_contains and url_contains not in item.get("url", ""):
            bad_url += 1

    for f, count in empty_fields.items():
        if count > len(data) * 0.1:  # > 10% missing is a failure
            failures.append(f"Field '{f}' empty in {count}/{len(data)} items")
    details["empty_fields"] = {f: c for f, c in empty_fields.items() if c > 0}

    if bad_price > len(data) * 0.1:
        failures.append(f"Price format invalid in {bad_price}/{len(data)} items")
    if bad_url > len(data) * 0.1:
        failures.append(f"URL missing '{url_contains}' in {bad_url}/{len(data)} items")

    if failures:
        return {"pass": False, "reason": "; ".join(failures), "details": details}

    return {
        "pass": True,
        "reason": f"{len(data)} products, {len(unique_urls)} unique, all fields valid",
        "details": details,
    }
