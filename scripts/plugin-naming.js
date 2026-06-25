#!/usr/bin/env node
/**
 * SSOT for nexus-vfs runtime artifact NAMING (NOT integrity — SHA values stay
 * in src/shared/runtime-sha256.json per the contract pinned by PR #919).
 *
 * Before this module: `scripts/download-nexus-vfs.js` carried 6 per-plugin
 * helpers (`getVaultArtifactName`, `getVaultDylibName`, `getVaultSigName`,
 * `getLocalConnectorArtifactName`, …) each with its own inline platform
 * matrix, and `scripts/expected-plugin-set.js` had its own parallel PLUGINS
 * array + OS/arch maps. Same data, two surfaces — exactly the shape that
 * caused PR #918's SHA drift before the SSOT cleanup.
 *
 * After: one PLUGINS array + a single set of OS/arch maps live here.
 *
 *   - download-nexus-vfs.js consumes `getClusterArtifact`, `getPluginArtifact`,
 *     `getPluginDylib`, `getPluginSig` to drive its download loop.
 *   - expected-plugin-set.js iterates `PLUGINS` and the same helpers to derive
 *     the per-platform expected set for the CI Cold Start Smoke job.
 *   - tests/integration/nexusVfsSha256Ssot.integration.test.ts enumerates every
 *     artifact this module knows how to name and asserts each has a SHA entry
 *     in runtime-sha256.json — so a future "publish vault for linux-arm64"
 *     that updates this file but forgets the SHA table fails fast at test time.
 *
 * Two important semantic distinctions preserved from the prior code:
 *
 *   - **Cluster uses `aarch64`**, plugins use **`arm64`** in archive filenames.
 *     This is a real upstream naming inconsistency (`nexusd-cluster-macos-aarch64.tar.gz`
 *     vs `nexus-vault-macos-arm64.tar.gz`). Encoded here as two distinct arch
 *     maps so consumers can't accidentally cross-wire them.
 *
 *   - `publishedPlatforms` per plugin records which (platform, arch) combos
 *     have a published artifact. fuse-plugin specifically does NOT publish
 *     for Windows — Win is on WinFsp via a separate adapter, not this release.
 *     `getPluginArtifact()` returns `null` for unpublished combos, mirroring
 *     the prior `getXxxArtifactName` return contract.
 */

const OS_NAME = { darwin: 'macos', linux: 'linux', win32: 'windows' };

// Cluster archives — nexusd-cluster uses LLVM/Rust target-triple style.
const CLUSTER_ARCH = { arm64: 'aarch64', x64: 'x86_64' };

// Plugin archives — use the human/brand name; not a typo, see header note.
const PLUGIN_ARCH = { arm64: 'arm64', x64: 'x86_64' };

const PLUGINS = [
  {
    name: 'nexus_vault',
    artifactPrefix: 'nexus-vault',
    publishedPlatforms: ['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64'],
    dylib: {
      darwin: 'libnexus_vault.dylib',
      linux: 'libnexus_vault.so',
      win32: 'nexus_vault.dll',
    },
  },
  {
    name: 'nexus_local_connector',
    artifactPrefix: 'nexus-local-connector',
    publishedPlatforms: ['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64'],
    dylib: {
      darwin: 'libnexus_local_connector.dylib',
      linux: 'libnexus_local_connector.so',
      win32: 'nexus_local_connector.dll',
    },
  },
  {
    name: 'nexus_fuse_plugin',
    artifactPrefix: 'nexus-fuse-plugin',
    // Intentionally no win32 — Windows uses WinFsp via a separate adapter,
    // not this release. Matches the legacy getFusePluginArtifactName behavior.
    publishedPlatforms: ['darwin-arm64', 'darwin-x64', 'linux-x64'],
    dylib: {
      darwin: 'libnexus_fuse_plugin.dylib',
      linux: 'libnexus_fuse_plugin.so',
    },
  },
];

// Every (platform, arch) combination the cluster publishes for. Same shape
// as PLUGINS.publishedPlatforms — enumerated so the integration test can
// derive the full set of artifact names this module can name without
// having to enumerate it itself.
const CLUSTER_PUBLISHED_PLATFORMS = [
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64',
  'linux-x64',
  'win32-arm64',
  'win32-x64',
];

function getArchiveExt(platform) {
  return platform === 'win32' ? '.zip' : '.tar.gz';
}

function getClusterArtifact(platform, arch) {
  const osName = OS_NAME[platform];
  const archName = CLUSTER_ARCH[arch];
  if (!osName || !archName) return null;
  return `nexusd-cluster-${osName}-${archName}${getArchiveExt(platform)}`;
}

function getClusterBinary(platform) {
  return platform === 'win32' ? 'nexusd-cluster.exe' : 'nexusd-cluster';
}

function getPluginByName(name) {
  return PLUGINS.find((p) => p.name === name) || null;
}

function getPluginArtifact(platform, arch, pluginName) {
  const plugin = getPluginByName(pluginName);
  if (!plugin) return null;
  if (!plugin.publishedPlatforms.includes(`${platform}-${arch}`)) return null;
  const osName = OS_NAME[platform];
  const archName = PLUGIN_ARCH[arch];
  if (!osName || !archName) return null;
  return `${plugin.artifactPrefix}-${osName}-${archName}${getArchiveExt(platform)}`;
}

function getPluginDylib(platform, pluginName) {
  const plugin = getPluginByName(pluginName);
  return plugin?.dylib?.[platform] || null;
}

function getPluginSig(platform, pluginName) {
  const dylib = getPluginDylib(platform, pluginName);
  return dylib ? `${dylib}.sig` : null;
}

/**
 * Enumerate every archive filename this module can name for any (platform,
 * arch) combination it knows about. Used by the integration test to assert
 * every name has a matching SHA entry.
 */
function allKnownArchives() {
  const out = [];
  for (const combo of CLUSTER_PUBLISHED_PLATFORMS) {
    const [platform, arch] = combo.split('-');
    const name = getClusterArtifact(platform, arch);
    if (name) out.push(name);
  }
  for (const plugin of PLUGINS) {
    for (const combo of plugin.publishedPlatforms) {
      const [platform, arch] = combo.split('-');
      const name = getPluginArtifact(platform, arch, plugin.name);
      if (name) out.push(name);
    }
  }
  return out;
}

module.exports = {
  OS_NAME,
  CLUSTER_ARCH,
  PLUGIN_ARCH,
  PLUGINS,
  CLUSTER_PUBLISHED_PLATFORMS,
  getArchiveExt,
  getClusterArtifact,
  getClusterBinary,
  getPluginByName,
  getPluginArtifact,
  getPluginDylib,
  getPluginSig,
  allKnownArchives,
};
