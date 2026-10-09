#!/usr/bin/env node
/**
 * Derive the expected set of nexus-vfs plugins for a given (platform, arch)
 * for the Cold Start Smoke CI job (.github/workflows/pr-cold-start-smoke.yml).
 *
 * Two layers of truth combined:
 *   - `scripts/plugin-naming.js` — SSOT for archive/dylib naming + per-plugin
 *     publishedPlatforms. Single hand-edited table; consumed by both the
 *     download script and this helper.
 *   - `src/shared/runtime-sha256.json` — SSOT for "the bytes we know how to
 *     verify". A SHA entry is the cryptographic proof we actually publish
 *     this artifact today.
 *
 * The intersection — published-by-naming AND present-in-SHA-table — is the
 * smoke's expected set. The two layers normally agree, but the AND is
 * belt-and-suspenders: it catches the case where someone updates the
 * naming map but forgets the SHA entry (the inverse of the PR #919 bug
 * the SHA SSOT was designed to prevent).
 *
 * Usage:
 *   node scripts/expected-plugin-set.js                       # current host
 *   node scripts/expected-plugin-set.js --platform linux --arch x64
 *   node scripts/expected-plugin-set.js --format names        # one name per line
 *   node scripts/expected-plugin-set.js --format dylibs
 *   node scripts/expected-plugin-set.js --format count
 *
 * Default output is JSON: {"platform":"linux","arch":"x64","plugins":[
 *   {"name":"nexus_vault","dylib":"libnexus_vault.so","artifact":"..."},
 *   ...
 * ],"count":3}
 */

const path = require('path');
const sha = require(path.join(__dirname, '..', 'src', 'shared', 'runtime-sha256.json'));
const { PLUGINS, getPluginDylib, getPluginArtifact } = require(path.join(__dirname, 'plugin-naming.js'));

function parseArgs(argv) {
  const out = { platform: process.platform, arch: process.arch, format: 'json' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--platform') out.platform = argv[++i];
    else if (a === '--arch') out.arch = argv[++i];
    else if (a === '--format') out.format = argv[++i];
  }
  return out;
}

function expectedPluginsFor(platform, arch) {
  const out = [];
  for (const plugin of PLUGINS) {
    const dylib = getPluginDylib(platform, plugin.name);
    if (!dylib) continue;
    const artifact = getPluginArtifact(platform, arch, plugin.name);
    if (!artifact) continue;
    if (!Object.prototype.hasOwnProperty.call(sha, artifact)) continue;
    out.push({ name: plugin.name, dylib, artifact });
  }
  return out;
}

function main() {
  const { platform, arch, format } = parseArgs(process.argv.slice(2));
  const plugins = expectedPluginsFor(platform, arch);
  if (format === 'names') {
    for (const p of plugins) process.stdout.write(`${p.name}\n`);
    return;
  }
  if (format === 'dylibs') {
    for (const p of plugins) process.stdout.write(`${p.dylib}\n`);
    return;
  }
  if (format === 'count') {
    process.stdout.write(`${plugins.length}\n`);
    return;
  }
  process.stdout.write(JSON.stringify({ platform, arch, plugins, count: plugins.length }) + '\n');
}

if (require.main === module) main();

module.exports = { expectedPluginsFor };
