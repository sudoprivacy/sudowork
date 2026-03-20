/**
 * Downloads @google/gemini-cli and its dependencies into a tgz in resources/
 * so it can be bundled as an extraResource in the packaged Electron app.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RESOURCES_DIR = path.join(__dirname, '..', 'resources');
const OUTPUT = path.join(RESOURCES_DIR, 'gemini-cli.tgz');
const FORCE = process.argv.includes('--force');

if (fs.existsSync(OUTPUT) && !FORCE) {
  console.log(`[gemini-cli] Already exists: ${OUTPUT}  (use --force to re-download)`);
  process.exit(0);
}

fs.mkdirSync(RESOURCES_DIR, { recursive: true });

console.log('[gemini-cli] Fetching latest version info...');
const info = JSON.parse(execSync('npm show @google/gemini-cli --json').toString());
const version = info.version;
console.log(`[gemini-cli] Preparing self-contained bundle for @google/gemini-cli@${version}...`);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-cli-build-'));
try {
  // 1. Initialize a dummy package.json
  fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'gemini-cli-bundle' }));

  // 2. Install the package with all its production dependencies
  console.log('[gemini-cli] Installing dependencies (this may take a minute)...');

  const installEnv = {
    ...process.env,
    NODE_ENV: 'production',
  };

  const platform = process.env.npm_config_platform || process.platform;
  const arch = process.env.npm_config_arch || process.arch;
  console.log(`[gemini-cli] Target platform: ${platform}-${arch}`);

  execSync(`npm install @google/gemini-cli@${version} --production --no-save`, {
    cwd: tmpDir,
    stdio: 'inherit',
    env: installEnv
  });

  // 3. Create a tarball of the entire directory (including node_modules)
  console.log('[gemini-cli] Creating tarball...');

  if (process.platform === 'win32') {
    const tmpOutput = path.join(tmpDir, 'gemini-cli.tgz');
    try {
      execSync(`tar -czf gemini-cli.tgz .`, {
        cwd: tmpDir,
        stdio: 'inherit',
        shell: true
      });
    } catch (e) {
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

console.log(`[gemini-cli] Saved self-contained bundle to ${OUTPUT}`);