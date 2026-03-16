/**
 * Downloads @anthropic-ai/claude-code as a tgz into resources/
 * so it can be bundled as an extraResource in the packaged Electron app.
 *
 * Usage: node scripts/download-claude-code.js [--force]
 */

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RESOURCES_DIR = path.join(__dirname, '..', 'resources');
const OUTPUT = path.join(RESOURCES_DIR, 'claude-code.tgz');
const FORCE = process.argv.includes('--force');

if (fs.existsSync(OUTPUT) && !FORCE) {
  console.log(`[claude-code] Already exists: ${OUTPUT}  (use --force to re-download)`);
  process.exit(0);
}

fs.mkdirSync(RESOURCES_DIR, { recursive: true });

console.log('[claude-code] Fetching latest version info...');
const info = JSON.parse(execSync('npm show @anthropic-ai/claude-code --json').toString());
const version = info.version;
console.log(`[claude-code] Downloading @anthropic-ai/claude-code@${version}...`);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-code-'));
try {
  execSync(`npm pack @anthropic-ai/claude-code@${version}`, { cwd: tmpDir, stdio: 'inherit' });
  const files = fs.readdirSync(tmpDir);
  const tgz = files.find((f) => f.endsWith('.tgz'));
  if (!tgz) throw new Error('npm pack did not produce a .tgz file');
  fs.renameSync(path.join(tmpDir, tgz), OUTPUT);
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log(`[claude-code] Saved to ${OUTPUT}`);
