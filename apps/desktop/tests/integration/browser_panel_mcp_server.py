#!/usr/bin/env python3
"""Browser-Panel MCP Server Integration Test

Real user journey: "Agent connects to browser-panel MCP and discovers tools
that let it control the right-side panel for user-visible browsing."

Workflow (5 steps, strong data flow):
  1. Connect via MCP stdio protocol → get server identity
  2. List tools → get tool catalog (from the connection in step 1)
  3. Validate tool naming convention → all tools use panel_* prefix
     (agent relies on prefix to distinguish from browser skill)
  4. Validate panel_open schema → url is required param
     (agent would fail to call panel_open without knowing this)
  5. Validate descriptions differentiate from browser skill →
     panel_open mentions "visible" / "right-side panel"
     (LLM uses description to choose panel vs browser skill)

Would catch these real bugs:
  - Tool renamed without updating all references
  - Required param removed from schema (agent sends bad request)
  - Description loses "visible" mention (LLM picks wrong tool)
  - Server name changed (agent can't identify server)
  - Tool accidentally removed (agent loses capability)
"""

import json
import os
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent.parent
MCP_SCRIPT = REPO_ROOT / "resources" / "browser-panel-mcp" / "index.js"

# Canonical tool set — removing any of these breaks agent workflows
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
    """Connect to MCP server via official SDK and return server info + tools."""
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
    result = subprocess.run(
        [node, "-e", probe_js],
        capture_output=True,
        text=True,
        timeout=30,
        cwd=str(REPO_ROOT),
    )

    if result.returncode != 0:
        raise RuntimeError(f"Probe failed (exit {result.returncode}): {result.stderr.strip()[:500]}")

    stdout = result.stdout.strip()
    if not stdout:
        raise RuntimeError("Probe returned empty stdout")

    return json.loads(stdout)


def main():
    print("=" * 60)
    print("  Browser-Panel MCP: Agent Tool Discovery Journey")
    print("=" * 60)

    if not MCP_SCRIPT.is_file():
        print(f"\n  SKIP: MCP script not found at {MCP_SCRIPT}")
        print("  (Run 'bun run build:browser-mcp' first)")
        sys.exit(0)

    node = find_node()
    print(f"\n  Node: {node}")
    print(f"  Script: {MCP_SCRIPT}")

    # ── Step 1: Connect and get server identity ──
    print("\n  [1/5] Connect → server identity...", end=" ")
    try:
        probe = run_mcp_client_probe(node, str(MCP_SCRIPT))
    except Exception as e:
        print(f"FAIL: {e}")
        sys.exit(1)

    if not probe.get("connected"):
        print(f"FAIL: {probe.get('error', 'unknown')}")
        sys.exit(1)

    server_name = probe.get("serverName")
    server_version = probe.get("serverVersion")
    assert server_name == "browser-panel", \
        f"Server name must be 'browser-panel' (agent uses this to identify), got '{server_name}'"
    assert server_version is not None, "Server must declare a version"
    print(f"PASS ({server_name} v{server_version})")

    # Data flows to step 2: we use the same connection's tool list
    tools = probe.get("tools", [])
    tool_map = {t["name"]: t for t in tools}
    tool_names = set(tool_map.keys())

    # ── Step 2: List tools → verify complete catalog ──
    print(f"  [2/5] List tools → verify catalog...", end=" ")
    missing = REQUIRED_TOOLS - tool_names
    extra = tool_names - REQUIRED_TOOLS
    assert not missing, f"Missing tools would break agent: {missing}"
    # Extra tools are OK (new features), but flag them
    suffix = f" (+{len(extra)} extra: {extra})" if extra else ""
    print(f"PASS ({len(tools)} tools, all {len(REQUIRED_TOOLS)} required present{suffix})")

    # ── Step 3: Validate naming convention → all panel_* ──
    # Agent relies on panel_* prefix to distinguish from browser skill's
    # page_goto, screenshot, etc. Breaking the prefix = agent picks wrong tool.
    print(f"  [3/5] Naming convention → panel_* prefix...", end=" ")
    non_panel = [name for name in tool_names if not name.startswith("panel_")]
    assert not non_panel, \
        f"Tools without panel_* prefix would confuse agent (browser skill uses different prefix): {non_panel}"
    print("PASS (all tools use panel_* prefix)")

    # ── Step 4: Validate panel_open schema → url is required ──
    # Data flows from step 2: we use tool_map["panel_open"]
    # Agent would send {"url": "..."} — if url is missing from schema,
    # the server would reject or behave unexpectedly.
    print(f"  [4/5] panel_open schema → url required...", end=" ")
    panel_open = tool_map["panel_open"]
    schema = panel_open.get("schema", {})
    props = schema.get("properties", {})
    required = schema.get("required", [])
    assert "url" in props, \
        f"panel_open must have 'url' property (agent sends URL to open), got: {list(props.keys())}"
    assert "url" in required, \
        f"url must be required (agent always provides URL), got required={required}"
    # Verify url is string type
    assert props["url"].get("type") == "string", \
        f"url must be type 'string', got: {props['url']}"
    print("PASS (url: string, required)")

    # ── Step 5: Validate descriptions guide LLM correctly ──
    # Data flows from step 2: we use tool_map descriptions
    # The LLM reads descriptions to choose panel_open vs browser page_goto.
    # If panel_open doesn't mention "visible" or "right-side panel",
    # LLM may choose browser skill for user-visible scenarios.
    print(f"  [5/5] Descriptions → LLM selection guidance...", end=" ")
    errors = []

    # panel_open MUST mention visibility (key differentiator)
    open_desc = panel_open["description"].lower()
    if "visible" not in open_desc and "right-side panel" not in open_desc:
        errors.append("panel_open must mention 'visible' or 'right-side panel' (key LLM differentiator)")

    # panel_open MUST mention browser skill as alternative
    if "browser skill" not in open_desc and "headless" not in open_desc and "crawl" not in open_desc:
        errors.append("panel_open should reference browser skill as alternative for background tasks")

    # All tools must have substantive descriptions (not just name echo)
    for name in REQUIRED_TOOLS:
        if name not in tool_map:
            continue
        desc = tool_map[name]["description"]
        # Description must be meaningful — at least 20 chars and not just the tool name
        assert len(desc) >= 20, f"{name}: description too short ({len(desc)} chars): '{desc}'"
        assert name not in desc.lower().replace("_", " ").replace("-", " "), \
            f"{name}: description is just the tool name restated"

    assert not errors, "; ".join(errors)
    print("PASS")

    # ── Summary ──
    print(f"\n{'=' * 60}")
    print(f"  ALL 5 STEPS PASSED")
    print(f"  Server: {server_name} v{server_version}")
    print(f"  Tools: {', '.join(sorted(tool_names))}")
    print("=" * 60)


if __name__ == "__main__":
    try:
        main()
    except AssertionError as e:
        print(f"FAIL: {e}")
        sys.exit(1)
