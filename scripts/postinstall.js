/**
 * Postinstall script for Sudowork
 * Handles native module installation for different environments.
 */

const { rebuildWithElectronRebuild } = require('./rebuildNativeModules');

// Note: web-tree-sitter is now a direct dependency in package.json.
// No need for symlinks or copying - npm will install it directly to node_modules.

function runPostInstall() {
  try {
    const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
    // e2e / dev-mode workflows use `bun run package` (electron-vite) rather
    // than electron-forge, so nothing else rebuilds the ABI-sensitive native
    // modules for them. Setting SUDOWORK_FORCE_REBUILD=1 opts those flows in
    // to the same rebuild path a local dev gets, without teaching every
    // caller how to invoke electron-rebuild directly.
    const forceRebuild = process.env.SUDOWORK_FORCE_REBUILD === '1';
    const electronVersion = require('../package.json').devDependencies.electron.replace(/^[~^]/, '');

    console.log(`Environment: CI=${isCI}, forceRebuild=${forceRebuild}, Electron=${electronVersion}`);

    if (isCI && !forceRebuild) {
      console.log('CI environment detected, skipping rebuild to use prebuilt binaries');
      console.log('Native modules will be handled by electron-forge during packaging');
    } else {
      // Rebuild only the modules supported by the local platform.
      console.log('Rebuilding supported native modules');
      rebuildWithElectronRebuild({
        platform: process.platform,
        arch: process.arch,
        electronVersion,
      });
    }
  } catch (e) {
    console.error('Postinstall failed:', e.message);
    // Do not fail the entire install when optional native rebuilds cannot complete.
  }
}

if (require.main === module) {
  runPostInstall();
}

module.exports = runPostInstall;
