#!/usr/bin/env node

/**
 * Build safety hook (hook.js) for development
 * Used by start script to ensure hook is always up-to-date
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function buildSafetyHook() {
  const hookDir = path.resolve(__dirname, '../hook/node');
  const hookDist = path.join(hookDir, 'dist/hook.js');
  const hookNodeModules = path.join(hookDir, 'node_modules');

  // Check if hook source exists
  if (!fs.existsSync(hookDir)) {
    console.log('⚠️  hook/node directory not found, skipping hook build');
    return true;
  }

  console.log('🔨 Building safety hook...');

  try {
    // Install dependencies if node_modules not found
    if (!fs.existsSync(hookNodeModules)) {
      console.log('📦 Installing hook dependencies...');
      execSync('npm install', {
        cwd: hookDir,
        stdio: 'inherit',
        shell: process.platform === 'win32',
      });
    }

    // Run esbuild to bundle hook.js
    execSync('npx esbuild src/index.ts --bundle --platform=node --outfile=./dist/hook.js --format=esm', {
      cwd: hookDir,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });

    if (fs.existsSync(hookDist)) {
      console.log('✅ Safety hook built successfully');
      return true;
    } else {
      console.log('❌ Safety hook build failed: hook.js not generated');
      return false;
    }
  } catch (error) {
    console.log(`❌ Safety hook build failed: ${error.message}`);
    return false;
  }
}

buildSafetyHook();