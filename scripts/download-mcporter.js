#!/usr/bin/env node
/**
 * Download and extract mcporter npm package for bundling with the app.
 * Run during build process: bun run mcporter:download
 *
 * Uses npm pack to download the package as a tgz, then extracts it
 * to resources/mcporter directory for inclusion as extraResources.
 *
 * Usage: node scripts/download-mcporter.js [--force] [--version <version>]
 *   --force           Re-download even if directory already exists
 *   --version         Specific version to download (default: latest)
 *
 * NOTE: Download failures are non-fatal (exit 0) to allow builds to proceed.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DEFAULT_VERSION = 'latest';
const RESOURCES_DIR = path.join(__dirname, '..', 'resources');
const MCPORTER_DIR = path.join(RESOURCES_DIR, 'mcporter');

/**
 * Download mcporter npm package using npm pack and extract to resources directory
 */
async function downloadMcporter(force = false, version = DEFAULT_VERSION) {
  // Check if already downloaded
  if (fs.existsSync(MCPORTER_DIR) && !force) {
    console.log(`Already exists: ${MCPORTER_DIR} (use --force to re-download)`);
    return true;
  }

  // Ensure resources directory exists
  fs.mkdirSync(RESOURCES_DIR, { recursive: true });

  // Clean up existing directory if forcing
  if (fs.existsSync(MCPORTER_DIR)) {
    console.log(`Removing existing: ${MCPORTER_DIR}`);
    fs.rmSync(MCPORTER_DIR, { recursive: true, force: true });
  }

  console.log(`Downloading mcporter@${version}...`);

  try {
    // Use npm pack to download the package as a tgz file
    // npm pack downloads from npm registry and creates a local tgz file
    const tgzName = execSync(`npm pack mcporter@${version}`, {
      cwd: RESOURCES_DIR,
      encoding: 'utf8',
      timeout: 60000,
    }).trim();

    const tgzPath = path.join(RESOURCES_DIR, tgzName);
    console.log(`Downloaded: ${tgzName}`);

    // Extract the tgz file
    console.log('Extracting...');
    execSync(`tar -xzf "${tgzName}"`, {
      cwd: RESOURCES_DIR,
      timeout: 30000,
    });

    // npm pack extracts to a 'package' directory
    // Rename it to 'mcporter'
    const packageDir = path.join(RESOURCES_DIR, 'package');
    if (fs.existsSync(packageDir)) {
      fs.renameSync(packageDir, MCPORTER_DIR);
      console.log(`Extracted to: ${MCPORTER_DIR}`);
    } else {
      // Some packages may have different structure
      // Check for alternative extraction patterns
      const extractedItems = fs.readdirSync(RESOURCES_DIR);
      const extractedDir = extractedItems.find(item =>
        item !== tgzName &&
        fs.statSync(path.join(RESOURCES_DIR, item)).isDirectory() &&
        item.startsWith('mcporter')
      );

      if (extractedDir) {
        console.log(`Found extracted directory: ${extractedDir}`);
        // Use the existing name if it's already named correctly
        if (extractedDir !== 'mcporter') {
          fs.renameSync(path.join(RESOURCES_DIR, extractedDir), MCPORTER_DIR);
          console.log(`Renamed to: ${MCPORTER_DIR}`);
        }
      } else {
        throw new Error('Could not find extracted package directory');
      }
    }

    // Clean up tgz file
    fs.unlinkSync(tgzPath);
    console.log('Cleaned up tgz file');

    // Verify CLI entry point exists
    // mcporter typically has bin/cli.js or similar entry point
    const possibleEntryPoints = [
      path.join(MCPORTER_DIR, 'bin', 'cli.js'),
      path.join(MCPORTER_DIR, 'cli.js'),
      path.join(MCPORTER_DIR, 'dist', 'cli.js'),
      path.join(MCPORTER_DIR, 'src', 'cli.js'),
      path.join(MCPORTER_DIR, 'index.js'),
    ];

    const entryPoint = possibleEntryPoints.find(p => fs.existsSync(p));
    if (!entryPoint) {
      // List the directory structure for debugging
      console.log('Package structure:');
      const listDir = (dir, indent = '') => {
        const items = fs.readdirSync(dir);
        for (const item of items) {
          const full = path.join(dir, item);
          const stat = fs.statSync(full);
          console.log(`${indent}${item}${stat.isDirectory() ? '/' : ''}`);
          if (stat.isDirectory() && indent.length < 4) {
            listDir(full, indent + '  ');
          }
        }
      };
      listDir(MCPORTER_DIR);

      console.warn('⚠️  Could not find CLI entry point. Package structure may be different.');
    } else {
      console.log(`CLI entry point: ${path.relative(MCPORTER_DIR, entryPoint)}`);
    }

    console.log('✅ mcporter download completed');
    return true;
  } catch (err) {
    console.error(`❌ Failed to download mcporter: ${err.message}`);

    // Clean up any partial downloads
    try {
      if (fs.existsSync(MCPORTER_DIR)) {
        fs.rmSync(MCPORTER_DIR, { recursive: true, force: true });
      }
    } catch {}

    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force') || args.includes('-f');

  // Parse version argument
  let version = DEFAULT_VERSION;
  const versionIndex = args.indexOf('--version');
  if (versionIndex !== -1 && args[versionIndex + 1]) {
    version = args[versionIndex + 1];
  }

  console.log(`mcporter version: ${version}`);
  console.log(`Output directory: ${MCPORTER_DIR}`);

  const success = await downloadMcporter(force, version);

  // Non-fatal: exit 0 to allow build to continue
  process.exit(success ? 0 : 0);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(0);
});