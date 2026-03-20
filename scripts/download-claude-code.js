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

  // Support cross-platform builds via npm_config_platform/npm_config_arch env vars
  const installEnv = {
    ...process.env,
    NODE_ENV: 'production',
  };

  // Log platform being installed for
  const platform = process.env.npm_config_platform || process.platform;
  const arch = process.env.npm_config_arch || process.arch;
  console.log(`[claude-code] Target platform: ${platform}-${arch}`);

  execSync(`npm install @anthropic-ai/claude-code@${version} --production --no-save`, {
    cwd: tmpDir,
    stdio: 'inherit',
    env: installEnv
  });

  // 3. Create a tarball of the entire directory (including node_modules)
  console.log('[claude-code] Creating tarball...');

  if (process.platform === 'win32') {
    // On Windows, tar has issues with cross-drive paths.
    // Create tarball in tmpDir first, then copy to destination.
    // Also, tar may report "file changed as we read it" and exit with code 1,
    // but the archive is still valid. We check if the file was created instead.
    const tmpOutput = path.join(tmpDir, 'claude-code.tgz');
    try {
      execSync(`tar -czf claude-code.tgz .`, {
        cwd: tmpDir,
        stdio: 'inherit',
        shell: true
      });
    } catch (e) {
      // tar may exit with code 1 if files changed during read, but archive is still valid
      if (!fs.existsSync(tmpOutput)) {
        throw e;
      }
    }
    fs.copyFileSync(tmpOutput, OUTPUT);
  } else {
    execSync(`tar -czf "${OUTPUT}" -C "${tmpDir}" .`, { stdio: 'inherit' });
  }

} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log(`[claude-code] Saved self-contained bundle to ${OUTPUT}`);
