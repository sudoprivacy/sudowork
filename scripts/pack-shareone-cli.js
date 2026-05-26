/**
 * Packs the ShareOne CLI into resources/shareone.tgz using the same layout as
 * other CLI bundles (e.g. claude-code) so that CliInstallService.resolveEntryFile()
 * can find the package under node_modules/@shareone/cli/.
 *
 * Installs @shareone/cli from the npm registry, bundles it into a single JS
 * file via esbuild, and creates a self-contained tgz.
 *
 * Usage:
 *   node scripts/pack-shareone-cli.js               # install latest from npm
 *   node scripts/pack-shareone-cli.js 0.1.0         # install specific version
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');

const RESOURCES_DIR = path.resolve(__dirname, '..', 'resources');
const OUTPUT = path.join(RESOURCES_DIR, 'shareone.tgz');
const VERSION = process.argv[2] || '';

fs.mkdirSync(RESOURCES_DIR, { recursive: true });

const installSpec = VERSION ? `@shareone/cli@${VERSION}` : '@shareone/cli';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shareone-cli-build-'));

try {
  // 1. Install from npm registry
  console.log(`[shareone-cli] Installing ${installSpec} from npm registry...`);
  fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'shareone-cli-bundle' }));
  execSync(`npm install ${installSpec} --production --no-save`, {
    cwd: tmpDir,
    stdio: 'inherit',
  });

  // 2. Bundle with esbuild into a single JS file
  const pkgDir = path.join(tmpDir, 'node_modules', '@shareone', 'cli');
  const pkgJson = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf-8'));
  const entryRel = typeof pkgJson.bin === 'string' ? pkgJson.bin : Object.values(pkgJson.bin)[0];
  const entryAbs = path.join(pkgDir, entryRel);
  const bundleOut = path.join(pkgDir, 'shareone.bundle.js');

  console.log('[shareone-cli] Bundling with esbuild...');
  execSync(
    `npx esbuild "${entryAbs}" --bundle --platform=node --target=node22 --format=cjs --outfile="${bundleOut}"`,
    { cwd: tmpDir, stdio: 'inherit' },
  );

  // Update package.json bin to point at the bundle
  pkgJson.bin = { shareone: 'shareone.bundle.js' };
  fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify(pkgJson, null, 2));

  // Remove original source files to keep tgz minimal
  const binDir = path.join(pkgDir, 'bin');
  const libDir = path.join(pkgDir, 'lib');
  if (fs.existsSync(binDir)) fs.rmSync(binDir, { recursive: true, force: true });
  if (fs.existsSync(libDir)) fs.rmSync(libDir, { recursive: true, force: true });

  // 3. Create tarball
  console.log('[shareone-cli] Creating tarball...');

  if (process.platform === 'win32') {
    const tmpOutput = path.join(tmpDir, 'shareone-cli.tgz');
    try {
      execSync('tar -czf shareone-cli.tgz .', { cwd: tmpDir, stdio: 'inherit', shell: true });
    } catch (e) {
      if (!fs.existsSync(tmpOutput)) throw e;
    }
    fs.copyFileSync(tmpOutput, OUTPUT);
  } else {
    execSync(`tar -czf "${OUTPUT}" -C "${tmpDir}" .`, { stdio: 'inherit' });
  }
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log(`[shareone-cli] Saved self-contained bundle to ${OUTPUT}`);