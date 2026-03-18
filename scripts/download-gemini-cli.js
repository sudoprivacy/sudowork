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
  execSync(`npm install @google/gemini-cli@${version} --production --no-save`, { 
    cwd: tmpDir, 
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'production' }
  });

  // 3. Create a tarball of the entire directory (including node_modules)
  // We name the root folder 'package' inside the tgz to keep compatibility with existing extraction logic
  console.log('[gemini-cli] Creating tarball...');

  if (process.platform === 'win32') {
    // On Windows, tar has issues with -C flag and drive letters.
    // Work around by changing to tmpDir and using a relative output path.
    const outputForward = OUTPUT.replace(/\\/g, '/');
    execSync(`tar -czf "${outputForward}" .`, {
      cwd: tmpDir,
      stdio: 'inherit',
      shell: true
    });
  } else {
    execSync(`tar -czf "${OUTPUT}" -C "${tmpDir}" .`, { stdio: 'inherit' });
  }

} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log(`[gemini-cli] Saved self-contained bundle to ${OUTPUT}`);
