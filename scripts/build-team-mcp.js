#!/usr/bin/env node
/**
 * Bundle the team-mcp MCP server into a single self-contained JS file.
 *
 * Build inputs:  resources/team-mcp/src/index.ts
 * Build output:  resources/team-mcp/index.js
 *
 * The bundle is shipped as an extraResource (see electron-builder.yml). At
 * runtime TeamService injects team-mcp per-member via ACP session/new.mcp_servers
 * (K2 wire format), pointing at this file via the bundled Node, so the agent
 * CLI launches it as a per-member stdio MCP server. Normal
 * sessions never inject it, and the server self-exits without TEAM_MCP_* env.
 *
 * @modelcontextprotocol/sdk is bundled in (no external dependency at runtime
 * inside the packaged app). Node built-ins (http/...) are kept external since
 * they're available everywhere.
 */

const path = require('path');
const fs = require('fs');
const esbuild = require('esbuild');

const SRC = path.join(__dirname, '..', 'resources', 'team-mcp', 'src', 'index.ts');
const OUT = path.join(__dirname, '..', 'resources', 'team-mcp', 'index.js');

async function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`❌ Source missing: ${SRC}`);
    process.exit(1);
  }
  await esbuild.build({
    entryPoints: [SRC],
    bundle: true,
    platform: 'node',
    target: ['node22'],
    format: 'cjs',
    outfile: OUT,
    minify: true,
    sourcemap: false,
    legalComments: 'none',
    external: [],
    logLevel: 'info',
    banner: { js: '#!/usr/bin/env node\n// team MCP server — bundled, do not edit by hand' },
  });
  const stat = fs.statSync(OUT);
  console.log(`✅ team-mcp bundled: ${OUT} (${(stat.size / 1024).toFixed(1)} KB)`);
}

main().catch((err) => {
  console.error('❌ build-team-mcp failed:', err);
  process.exit(1);
});
