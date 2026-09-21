#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const esbuild = require('esbuild');

const source = path.join(__dirname, '..', 'resources', 'ontology-builder-mcp', 'src', 'index.ts');
const output = path.join(__dirname, '..', 'resources', 'ontology-builder-mcp', 'index.js');

async function main() {
  if (!fs.existsSync(source)) throw new Error(`Ontology builder MCP source is missing: ${source}`);
  await esbuild.build({
    entryPoints: [source],
    bundle: true,
    platform: 'node',
    target: ['node22'],
    format: 'cjs',
    outfile: output,
    minify: true,
    sourcemap: false,
    legalComments: 'none',
    external: [],
    logLevel: 'info',
    banner: { js: '#!/usr/bin/env node\n// Sudowork ontology builder MCP server - generated file' },
  });
}

main().catch((error) => {
  console.error('build-ontology-builder-mcp failed:', error);
  process.exit(1);
});
