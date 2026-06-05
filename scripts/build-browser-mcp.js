#!/usr/bin/env node
/**
 * Bundle the sudowork-browser MCP server into a single self-contained JS file.
 *
 * Build inputs:  resources/sudowork-browser-mcp/src/index.ts
 * Build output:  resources/sudowork-browser-mcp/index.js
 *
 * The bundle is shipped as an extraResource (see electron-builder.yml). At
 * runtime the sudowork main process registers an entry in ~/.claude.json
 * pointing at this file via the bundled Node, so Claude Code launches it as
 * an MCP stdio server when a Claude session starts.
 *
 * @modelcontextprotocol/sdk is bundled in (no external dependency at runtime
 * inside the packaged app). Node built-ins (fs/path/url/http/...) are kept
 * external since they're available everywhere.
 */

const path = require('path');
const fs = require('fs');
const esbuild = require('esbuild');

const SRC = path.join(__dirname, '..', 'resources', 'sudowork-browser-mcp', 'src', 'index.ts');
const OUT = path.join(__dirname, '..', 'resources', 'sudowork-browser-mcp', 'index.js');

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
    banner: { js: '#!/usr/bin/env node\n// sudowork-browser MCP server — bundled, do not edit by hand' },
  });
  const stat = fs.statSync(OUT);
  console.log(`✅ sudowork-browser-mcp bundled: ${OUT} (${(stat.size / 1024).toFixed(1)} KB)`);
}

main().catch((err) => {
  console.error('❌ build-browser-mcp failed:', err);
  process.exit(1);
});
