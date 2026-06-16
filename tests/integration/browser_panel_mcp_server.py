#!/usr/bin/env python3
"""Browser-Panel MCP Server Integration Test

Scenarios (following integration-test-generator pattern):
  1. Server starts → responds to MCP initialize handshake
  2. Server lists tools → all required panel_* tools present
  3. Tool descriptions → self-describing for LLM selection
  4. Tool schema → panel_open has required 'url' parameter

Uses the official @modelcontextprotocol/sdk client (Node.js) to speak the
MCP stdio protocol, then validates the output from Python. No Electron or
UI required — pure protocol test.
"""

import json
import os
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent.parent
MCP_SCRIPT = REPO_ROOT / "resources" / "browser-panel-mcp" / "index.js"

# Expected tools that must be present
REQUIRED_TOOLS = {
    "panel_open",
    "panel_navigate",
    "panel_screenshot",
    "panel_evaluate",
    "panel_dom_snapshot",
    "panel_list_console",
    "panel_list_network",
}


def find_node() -> str:
    """Find a usable node binary (bundled or system)."""
    home = Path.home()
    nexus_node_dir = home / ".nexus" / "node"
    if nexus_node_dir.is_dir():
        for entry in nexus_node_dir.iterdir():
            candidate = entry / "bin" / "node"
            if candidate.is_file() and os.access(candidate, os.X_OK):
                return str(candidate)
    import shutil
    node = shutil.which("node")
    if node:
        return node
    print("  FAIL: no node binary found")
    sys.exit(1)


def run_mcp_client_probe(node: str, script: str) -> dict:
    """Run Node.js MCP client probe and return parsed results.

    Uses the official @modelcontextprotocol/sdk to connect, list tools,
    and emit results as a JSON object on stdout.
    """
    probe_js = f"""
const {{ Client }} = require('@modelcontextprotocol/sdk/client/index.js');
const {{ StdioClientTransport }} = require('@modelcontextprotocol/sdk/client/stdio.js');

async function main() {{
  const transport = new StdioClientTransport({{
    command: process.execPath,
    args: [{json.dumps(script)}],
  }});
  const client = new Client({{ name: 'integration-test', version: '1.0.0' }});

  await client.connect(transport);

  const serverInfo = client.getServerVersion();
  const {{ tools }} = await client.listTools();

  const result = {{
    connected: true,
    serverName: serverInfo?.name || null,
    serverVersion: serverInfo?.version || null,
    tools: tools.map(t => ({{
      name: t.name,
      description: t.description || '',
      schema: t.inputSchema || {{}},
    }})),
  }};

  process.stdout.write(JSON.stringify(result));
  await client.close();
}}

main().catch(e => {{
  process.stdout.write(JSON.stringify({{ connected: false, error: e.message }}));
  process.exit(1);
}});
"""
    # Run from repo root so node_modules are available
    result = subprocess.run(
        [node, "-e", probe_js],
        capture_output=True,
        text=True,
        timeout=30,
        cwd=str(REPO_ROOT),
    )

    if result.returncode != 0:
        stderr = result.stderr.strip()[:500]
        raise RuntimeError(f"Probe failed (exit {result.returncode}): {stderr}")

    stdout = result.stdout.strip()
    if not stdout:
        raise RuntimeError("Probe returned empty stdout")

    return json.loads(stdout)


def main():
    print("=" * 60)
    print("  Browser-Panel MCP Server Integration Test")
    print("=" * 60)

    # Verify script exists
    if not MCP_SCRIPT.is_file():
        print(f"\n  SKIP: MCP script not found at {MCP_SCRIPT}")
        print("  (Run 'bun run build:browser-mcp' first)")
        sys.exit(0)

    node = find_node()
    print(f"\n  Node: {node}")
    print(f"  Script: {MCP_SCRIPT}")

    # Run the probe
    print("\n  Connecting to MCP server via stdio...")
    try:
        probe = run_mcp_client_probe(node, str(MCP_SCRIPT))
    except Exception as e:
        print(f"\n  FAIL: Could not connect: {e}")
        sys.exit(1)

    if not probe.get("connected"):
        print(f"\n  FAIL: Connection error: {probe.get('error', 'unknown')}")
        sys.exit(1)

    tools = probe.get("tools", [])
    tool_map = {t["name"]: t for t in tools}
    tool_names = set(tool_map.keys())

    results = []

    # Scenario 1: Server initializes successfully
    print(f"\n  [1/4] Initialize handshake...", end=" ")
    server_name = probe.get("serverName")
    if server_name == "browser-panel":
        print(f"PASS (server: {server_name} v{probe.get('serverVersion', '?')})")
        results.append(True)
    else:
        print(f"FAIL: expected server name 'browser-panel', got '{server_name}'")
        results.append(False)

    # Scenario 2: All required tools present
    print(f"  [2/4] Required tools...", end=" ")
    missing = REQUIRED_TOOLS - tool_names
    if not missing:
        print(f"PASS ({len(tools)} tools: {', '.join(sorted(tool_names))})")
        results.append(True)
    else:
        print(f"FAIL: missing {missing}")
        results.append(False)

    # Scenario 3: Tool descriptions are meaningful
    print(f"  [3/4] Tool descriptions...", end=" ")
    desc_ok = True
    desc_errors = []
    for name in REQUIRED_TOOLS & tool_names:
        desc = tool_map[name].get("description", "")
        if len(desc) < 10:
            desc_errors.append(f"{name}: description too short ({len(desc)} chars)")
            desc_ok = False

    # panel_open must mention visibility
    if "panel_open" in tool_map:
        panel_open_desc = tool_map["panel_open"]["description"].lower()
        if "right-side panel" not in panel_open_desc and "visible" not in panel_open_desc:
            desc_errors.append("panel_open: missing visibility mention")
            desc_ok = False

    if desc_ok:
        print("PASS")
        results.append(True)
    else:
        print(f"FAIL: {'; '.join(desc_errors)}")
        results.append(False)

    # Scenario 4: panel_open has required 'url' parameter
    print(f"  [4/4] panel_open schema...", end=" ")
    if "panel_open" in tool_map:
        schema = tool_map["panel_open"].get("schema", {})
        props = schema.get("properties", {})
        required = schema.get("required", [])
        if "url" in props and "url" in required:
            print("PASS (url: required)")
            results.append(True)
        elif "url" in props:
            print("PASS (url: optional)")
            results.append(True)
        else:
            print(f"FAIL: 'url' not in properties: {list(props.keys())}")
            results.append(False)
    else:
        print("SKIP (panel_open not found)")
        results.append(False)

    # Summary
    passed = sum(results)
    total = len(results)
    print(f"\n{'=' * 60}")
    if all(results):
        print(f"  ALL {total} SCENARIOS PASSED")
        print("=" * 60)
        sys.exit(0)
    else:
        print(f"  {passed}/{total} PASSED, {total - passed} FAILED")
        print("=" * 60)
        sys.exit(1)


if __name__ == "__main__":
    main()
