/**
 * Postinstall script for Sudowork
 * Handles native module installation for different environments.
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { rebuildWithElectronRebuild } = require('./rebuildNativeModules');

// Note: web-tree-sitter is now a direct dependency in package.json.
// No need for symlinks or copying - npm will install it directly to node_modules.

function ensureElectronInstalled() {
  const electronPath = path.join(__dirname, '..', 'node_modules', 'electron', 'dist');
  if (!fs.existsSync(electronPath)) {
    console.log('Electron binary not found, downloading...');
    execSync('node node_modules/electron/install.js', {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..'),
    });
  }
}

function runPostInstall() {
  try {
    const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
    const electronVersion = require('../package.json').devDependencies.electron.replace(/^[~^]/, '');

    console.log(`Environment: CI=${isCI}, Electron=${electronVersion}`);

    // Ensure Electron binary is downloaded
    ensureElectronInstalled();

    if (isCI) {
      console.log('CI environment detected, skipping rebuild to use prebuilt binaries');
      console.log('Native modules will be handled by electron-forge during packaging');
    } else {
      // Rebuild only the modules supported by the local platform.
      console.log('Local environment, rebuilding supported native modules');
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
