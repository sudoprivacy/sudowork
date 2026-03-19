/**
 * Downloads openclaw as a tgz into resources/
 * so it can be bundled as an extraResource in the packaged Electron app.
 *
 * Usage: node scripts/download-openclaw.js [--force]
 */

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RESOURCES_DIR = path.join(__dirname, '..', 'resources');
const OUTPUT = path.join(RESOURCES_DIR, 'openclaw.tgz');
const FORCE = process.argv.includes('--force');

if (fs.existsSync(OUTPUT) && !FORCE) {
  console.log(`[openclaw] Already exists: ${OUTPUT}  (use --force to re-download)`);
  process.exit(0);
}

fs.mkdirSync(RESOURCES_DIR, { recursive: true });

console.log('[openclaw] Fetching latest version info...');
const info = JSON.parse(execSync('npm show openclaw --json').toString());
const version = info.version;
console.log(`[openclaw] Downloading openclaw@${version}...`);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-'));
try {
  execSync(`npm pack openclaw@${version}`, { cwd: tmpDir, stdio: 'inherit' });
  const files = fs.readdirSync(tmpDir);
  const tgz = files.find((f) => f.endsWith('.tgz'));
  if (!tgz) throw new Error('npm pack did not produce a .tgz file');
  // Use copy + unlink instead of rename for cross-device compatibility
  fs.copyFileSync(path.join(tmpDir, tgz), OUTPUT);
  fs.unlinkSync(path.join(tmpDir, tgz));
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log(`[openclaw] Saved to ${OUTPUT}`);
