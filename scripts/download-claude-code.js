/**
 * Downloads @anthropic-ai/claude-code and its dependencies into a tgz in resources/
 * so it can be bundled as an extraResource in the packaged Electron app.
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
console.log(`[claude-code] Preparing self-contained bundle for @anthropic-ai/claude-code@${version}...`);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-code-build-'));
try {
  // 1. Initialize a dummy package.json
  fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'claude-code-bundle' }));
  
  // 2. Install the package with all its production dependencies
  console.log('[claude-code] Installing dependencies (this may take a minute)...');
  execSync(`npm install @anthropic-ai/claude-code@${version} --production --no-save`, { 
    cwd: tmpDir, 
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'production' }
  });

  // 3. Create a tarball of the entire directory (including node_modules)
  console.log('[claude-code] Creating tarball...');

  if (process.platform === 'win32') {
    // On Windows, tar has issues with cross-drive paths.
    // Create tarball in tmpDir first, then copy to destination.
    const tmpOutput = path.join(tmpDir, 'claude-code.tgz');
    execSync(`tar -czf claude-code.tgz .`, {
      cwd: tmpDir,
      stdio: 'inherit',
      shell: true
    });
    fs.copyFileSync(tmpOutput, OUTPUT);
  } else {
    execSync(`tar -czf "${OUTPUT}" -C "${tmpDir}" .`, { stdio: 'inherit' });
  }

} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log(`[claude-code] Saved self-contained bundle to ${OUTPUT}`);
