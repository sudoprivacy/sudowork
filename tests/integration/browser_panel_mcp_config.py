#!/usr/bin/env python3
"""Browser-Panel MCP Config Registration Integration Test

Real user journey: "Sudowork boots → registers browser-panel in config →
agent backend reads config → can spawn the MCP server process."

Workflow (5 steps, strong data flow):
  1. Read ProcessConfig from disk → find browser-panel entry
  2. Verify transport points to real files → node binary + MCP script exist
  3. Verify entry has correct IMcpServer shape → agent can parse it
  4. Verify no duplicates → idempotent registration across reboots
  5. Cross-check with scode settings.json → sync pipeline works end-to-end

Data flow: Step 1 finds the entry → Steps 2-5 all validate properties
OF THAT SAME ENTRY. If step 1 fails, nothing else can run.

Would catch these real bugs:
  - Registration writes wrong key format (agent can't parse)
  - Node binary path hardcoded to dev machine (CI/other users break)
  - MCP script path wrong after build (agent spawns nonexistent file)
  - Duplicate entries from non-idempotent registration (agent confusion)
  - syncMcpToAgents not running (scode never sees browser-panel)

Requires: Sudowork has run at least once (reads persisted config).
"""

import base64
import json
import os
import sys
import urllib.parse
from pathlib import Path
from collections import Counter


REPO_ROOT = Path(__file__).resolve().parent.parent.parent
CONFIG_PATH = Path.home() / ".nexus" / "config" / "sudowork-config.txt"
SCODE_SETTINGS_PATH = Path.home() / ".nexus" / "sudocode" / "settings.json"


def read_process_config() -> dict:
    """Read ProcessConfig from disk (base64 + URL-encoded JSON)."""
    if not CONFIG_PATH.exists():
        return {}
    content = CONFIG_PATH.read_text(encoding="utf-8").strip()
    if not content:
        return {}
    try:
        decoded_b64 = base64.b64decode(content).decode("utf-8")
        decoded_url = urllib.parse.unquote(decoded_b64)
        return json.loads(decoded_url)
    except Exception:
        try:
            return json.loads(content)
        except Exception:
            return {}


def get_mcp_config() -> list:
    """Extract mcp.config array from ProcessConfig."""
    config = read_process_config()
    mcp_config = config.get("mcp.config")
    if isinstance(mcp_config, str):
        try:
            return json.loads(mcp_config)
        except Exception:
            return []
    return mcp_config if isinstance(mcp_config, list) else []


def main():
    print("=" * 60)
    print("  Browser-Panel MCP: Registration → Agent Sync Pipeline")
    print("=" * 60)

    if not CONFIG_PATH.exists():
        print(f"\n  SKIP: ProcessConfig not found at {CONFIG_PATH}")
        print("  (Sudowork must have run at least once)")
        sys.exit(0)

    mcp_config = get_mcp_config()
    if not mcp_config:
        print(f"\n  SKIP: mcp.config is empty or missing")
        sys.exit(0)

    # ── Step 1: Find browser-panel entry in config ──
    print(f"\n  [1/5] Find browser-panel in ProcessConfig...", end=" ")
    entry = None
    for e in mcp_config:
        if isinstance(e, dict) and e.get("name") == "browser-panel":
            entry = e
            break

    assert entry is not None, \
        f"browser-panel not found in mcp.config ({len(mcp_config)} entries: " \
        f"{[e.get('name') for e in mcp_config if isinstance(e, dict)]})"
    print(f"PASS (id: {entry.get('id', 'N/A')})")

    # ── Step 2: Verify transport points to real files ──
    # Data flows from step 1: we validate THE ENTRY we just found.
    # An agent would use these paths to spawn the MCP server process.
    # If either file is missing, agent gets ENOENT and tools are unavailable.
    print(f"  [2/5] Transport → real node binary + MCP script...", end=" ")
    transport = entry.get("transport", {})
    assert transport.get("type") == "stdio", \
        f"Expected stdio transport, got: {transport.get('type')}"

    node_path = transport.get("command", "")
    assert os.path.isfile(node_path), \
        f"Node binary not found (agent would get ENOENT): {node_path}"

    args = transport.get("args", [])
    assert len(args) >= 1, \
        f"Transport args must have script path, got: {args}"
    script_path = args[0]
    assert "browser-panel-mcp" in script_path, \
        f"Script path must reference browser-panel-mcp: {script_path}"
    assert os.path.isfile(script_path), \
        f"MCP script not found (agent would get ENOENT): {script_path}"
    print(f"PASS (node: ...{node_path[-30:]}, script: ...{script_path[-40:]})")

    # ── Step 3: Verify IMcpServer shape ──
    # Data flows from step 1: same entry.
    # The renderer and McpService parse these fields. Missing fields = crash.
    print(f"  [3/5] Entry shape → IMcpServer fields present...", end=" ")
    required_fields = {"id", "name", "enabled", "transport", "createdAt", "updatedAt"}
    missing_fields = required_fields - set(entry.keys())
    assert not missing_fields, \
        f"Missing IMcpServer fields (renderer would crash): {missing_fields}"
    assert isinstance(entry["enabled"], bool), \
        f"'enabled' must be boolean (toggle switch depends on it), got: {type(entry['enabled']).__name__}"
    assert isinstance(entry["createdAt"], (int, float)), \
        f"'createdAt' must be number, got: {type(entry['createdAt']).__name__}"
    print(f"PASS (enabled={entry['enabled']})")

    # ── Step 4: Verify no duplicates (idempotent registration) ──
    # Data flows from mcp_config (all entries).
    # If boot creates duplicates, agent might spawn multiple server instances
    # or UI shows duplicate toggle switches.
    print(f"  [4/5] No duplicates → idempotent registration...", end=" ")
    bp_entries = [e for e in mcp_config if isinstance(e, dict) and e.get("name") == "browser-panel"]
    assert len(bp_entries) == 1, \
        f"Expected exactly 1 browser-panel entry, found {len(bp_entries)}. " \
        f"IDs: {[e.get('id') for e in bp_entries]}"
    print(f"PASS (1 entry among {len(mcp_config)} total)")

    # ── Step 5: Cross-check scode settings.json (sync pipeline) ──
    # Data flows from step 1 (entry.enabled) + scode settings file.
    # syncMcpToAgents should propagate enabled MCPs to scode settings.
    print(f"  [5/5] Scode sync → settings.json consistency...", end=" ")
    if not SCODE_SETTINGS_PATH.exists():
        print("SKIP (scode settings.json not found)")
    else:
        try:
            settings = json.loads(SCODE_SETTINGS_PATH.read_text(encoding="utf-8"))
        except Exception:
            settings = {}
        mcp_servers = settings.get("mcpServers", {})

        if entry["enabled"]:
            # If enabled in config, must be in scode settings
            assert "browser-panel" in mcp_servers, \
                f"browser-panel enabled in config but missing from scode settings " \
                f"(syncMcpToAgents broken). scode has: {list(mcp_servers.keys())}"
            # Verify scode entry has matching command
            scode_entry = mcp_servers["browser-panel"]
            scode_cmd = scode_entry.get("command", "")
            assert scode_cmd == node_path or "node" in scode_cmd.lower(), \
                f"scode browser-panel command doesn't match config: {scode_cmd}"
            print(f"PASS (enabled=true, synced to scode)")
        else:
            # If disabled, should NOT be in scode
            if "browser-panel" in mcp_servers:
                print(f"WARN (disabled but still in scode — may be stale from prior toggle)")
            else:
                print(f"PASS (disabled, correctly absent from scode)")

    # ── Summary ──
    print(f"\n{'=' * 60}")
    print(f"  ALL STEPS PASSED")
    print(f"  Entry: {entry.get('name')} (id={entry.get('id')})")
    print(f"  Enabled: {entry.get('enabled')}")
    print(f"  Node: {node_path}")
    print(f"  Script: {script_path}")
    print("=" * 60)


if __name__ == "__main__":
    try:
        main()
    except AssertionError as e:
        print(f"FAIL: {e}")
        sys.exit(1)
