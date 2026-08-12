#!/usr/bin/env node

const { execFileSync } = require('child_process');
const path = require('path');
const brand = require('../brand.config.json');

const ROOT = path.join(__dirname, '..');
const run = (script, args = []) => execFileSync(process.execPath, [path.join(__dirname, script), ...args], { cwd: ROOT, stdio: 'inherit' });

function main() {
  const targets = process.argv.slice(2);
  if (brand.BUILD_OFFLINE === true) {
    const effectiveTargets = targets.length > 0 ? targets : [`${process.platform}-${process.arch}`];
    for (const target of effectiveTargets) {
      if (!/^(darwin|win32|linux)-(x64|arm64)$/.test(target)) throw new Error(`Unsupported target: ${target}`);
      run('download-node.js', [target]);
      run('download-scode.js', [target]);
      run('download-nexus-vfs.js', [target, '--stage-only']);
    }
    run('verify-offline-resources.js', effectiveTargets);
    return;
  }

  run('download-nexus-vfs.js');
  run('download-scode.js');
  run('download-node.js');
}

main();
