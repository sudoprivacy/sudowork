#!/usr/bin/env node
/**
 * Derive the expected set of nexus-vfs plugins for a given (platform, arch)
 * from src/shared/runtime-sha256.json. Used by the Cold Start Smoke CI job
 * (.github/workflows/pr-cold-start-smoke.yml) to assert the cluster loads
 * EXACTLY the set we publish for this platform — fewer = regression, more =
 * unexpected extra.
 *
 * Why data-driven (vs hardcoded in YAML): the windows-x64 case is a live
 * landmine — vault + local-connector publish there but fuse-plugin doesn't
 * (FUSE-T is mac-only; Win uses WinFsp via a separate adapter). The plan
 * doc claims "Windows: 3 plugins" but the actual table publishes 2. Keeping
 * the count derivation in one place (here) means a future "publish fuse-
 * plugin for win" only requires adding the SHA entry; the smoke assertion
 * tightens automatically.
 *
 * Usage:
 *   node scripts/expected-plugin-set.js                       # current host
 *   node scripts/expected-plugin-set.js --platform linux --arch x64
 *   node scripts/expected-plugin-set.js --format names        # one name per line
 *
 * Default output is JSON: {"platform":"linux","arch":"x64","plugins":[
 *   {"name":"nexus_vault","dylib":"libnexus_vault.so"},
 *   ...
 * ],"count":3}
 */

const path = require('path');
const sha = require(path.join(__dirname, '..', 'src', 'shared', 'runtime-sha256.json'));

// Mirrors download-nexus-vfs.js. Vault/local-connector/fuse-plugin all use
// arm64/x86_64 in their archive filenames (NOT aarch64 like nexusd-cluster).
const OS_NAME = { darwin: 'macos', linux: 'linux', win32: 'windows' };
const PLUGIN_ARCH_NAME = { arm64: 'arm64', x64: 'x86_64' };

const PLUGINS = [
  {
    name: 'nexus_vault',
    artifactPrefix: 'nexus-vault',
    dylib: { darwin: 'libnexus_vault.dylib', linux: 'libnexus_vault.so', win32: 'nexus_vault.dll' },
  },
  {
    name: 'nexus_local_connector',
    artifactPrefix: 'nexus-local-connector',
    dylib: {
      darwin: 'libnexus_local_connector.dylib',
      linux: 'libnexus_local_connector.so',
      win32: 'nexus_local_connector.dll',
    },
  },
  {
    name: 'nexus_fuse_plugin',
    artifactPrefix: 'nexus-fuse-plugin',
    dylib: {
      darwin: 'libnexus_fuse_plugin.dylib',
      linux: 'libnexus_fuse_plugin.so',
      // Intentionally absent: Windows uses WinFsp via separate adapter, not
      // this fuse-plugin release. Mirrors getFusePluginDylibName() in the
      // download script.
    },
  },
];

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
  const osName = OS_NAME[platform];
  const archName = PLUGIN_ARCH_NAME[arch];
  if (!osName || !archName) return [];
  const ext = platform === 'win32' ? '.zip' : '.tar.gz';

  const out = [];
  for (const plugin of PLUGINS) {
    const dylib = plugin.dylib[platform];
    if (!dylib) continue;
    const artifact = `${plugin.artifactPrefix}-${osName}-${archName}${ext}`;
    if (Object.prototype.hasOwnProperty.call(sha, artifact)) {
      out.push({ name: plugin.name, dylib, artifact });
    }
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
