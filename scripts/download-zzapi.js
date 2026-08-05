/**
 * Downloads @joezhoujinjing/zzapi and its dependencies into a tgz in resources/
 * so it can be bundled as an extraResource in the packaged Electron app.
 *
 * The package is pure JS (commander / yaml / zod / proper-lockfile — no native
 * modules), so a single platform-independent bundle is enough.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PACKAGE = '@joezhoujinjing/zzapi';
const RESOURCES_DIR = path.join(__dirname, '..', 'resources');
const OUTPUT = path.join(RESOURCES_DIR, 'zzapi.tgz');
const FORCE = process.argv.includes('--force');

if (fs.existsSync(OUTPUT) && !FORCE) {
  console.log(`[zzapi] Already exists: ${OUTPUT}  (use --force to re-download)`);
  process.exit(0);
}

fs.mkdirSync(RESOURCES_DIR, { recursive: true });

console.log('[zzapi] Fetching latest version info...');
const info = JSON.parse(execSync(`npm show ${PACKAGE} --json`).toString());
const version = info.version;
console.log(`[zzapi] Preparing self-contained bundle for ${PACKAGE}@${version}...`);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zzapi-build-'));
try {
  // 1. Initialize a dummy package.json
  fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'zzapi-bundle' }));

  // 2. Install the package with all its production dependencies
  console.log('[zzapi] Installing dependencies...');
  execSync(`npm install ${PACKAGE}@${version} --production --no-save`, {
    cwd: tmpDir,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'production' },
  });

  // 3. Create a tarball of the entire directory (including node_modules)
  console.log('[zzapi] Creating tarball...');

  // COPYFILE_DISABLE stops BSD tar (macOS) from storing extended attributes as
  // AppleDouble entries. `tar -tzf` hides those, but the `tar` npm package that
  // CliInstallService extracts with does not — they land on disk as `._*` files
  // next to every real file. zzapi enumerates registry/*.yaml and chokes on the
  // resulting `._price-track.yaml` with REGISTRY_INVALID, so the managed install
  // ships a CLI that fails on startup. No effect on Linux/Windows tar.
  const tarEnv = { ...process.env, COPYFILE_DISABLE: '1' };

  if (process.platform === 'win32') {
    // On Windows, tar has issues with cross-drive paths.
    // Create tarball in tmpDir first, then copy to destination.
    // Also, tar may report "file changed as we read it" and exit with code 1,
    // but the archive is still valid. We check if the file was created instead.
    const tmpOutput = path.join(tmpDir, 'zzapi.tgz');
    try {
      execSync('tar -czf zzapi.tgz .', { cwd: tmpDir, stdio: 'inherit', shell: true, env: tarEnv });
    } catch (e) {
      if (!fs.existsSync(tmpOutput)) {
        throw e;
      }
    }
    fs.copyFileSync(tmpOutput, OUTPUT);
  } else {
    execSync(`tar -czf "${OUTPUT}" -C "${tmpDir}" .`, { stdio: 'inherit', env: tarEnv });
  }
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log(`[zzapi] Saved self-contained bundle to ${OUTPUT}`);
