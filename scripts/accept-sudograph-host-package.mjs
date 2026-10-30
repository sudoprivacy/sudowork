/** Pack and accept the public host runtime outside the monorepo. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ options: { directory: { type: 'string' }, probe: { type: 'string' } } });
assert(values.directory && values.probe, 'Supply --directory and a Node-bundled sudographModelRuntime.live probe.');
assert(process.env.SUDOGRAPH_PYTHON && process.env.SUDOGRAPH_COMPILER_ROOT, 'Bind the checked Python compiler and worker directory.');
const destination = path.resolve(values.directory);
mkdirSync(destination, { recursive: true });
const caseRoot = mkdtempSync(path.join(os.tmpdir(), 'sudograph-host-package-'));
assert(!caseRoot.startsWith(root + path.sep), 'Installation must be outside the repository.');
const consumer = path.join(caseRoot, 'consumer');
mkdirSync(consumer);
assert.equal(readdirSync(process.env.SUDOGRAPH_COMPILER_ROOT).length, 0, 'Installed acceptance needs an empty, private worker directory.');
const bun = process.env.BUN_EXECUTABLE || 'bun';
function run(binary, args, cwd, env = process.env) {
  const result = spawnSync(binary, args, { cwd, env, windowsHide: true, encoding: 'utf8', timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
  assert(!result.error, String(result.error));
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}
const packageRoot = path.join(root, 'packages/sudograph-runtime');
assert(existsSync(path.join(packageRoot, 'dist/index.js')), 'Build the host runtime before packing.');
const metadata = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
assert.equal(metadata.name, '@sudowork/sudograph-runtime');
assert(!Object.values(metadata.dependencies).some((value) => value.startsWith('workspace:')));
const archive = path.join(caseRoot, 'sudograph-host-runtime.tgz');
run(bun, ['pm', 'pack', '--filename', archive, '--ignore-scripts', '--quiet'], packageRoot);
const repeatedArchive = path.join(caseRoot, 'sudograph-host-runtime-repeat.tgz');
run(bun, ['pm', 'pack', '--filename', repeatedArchive, '--ignore-scripts', '--quiet'], packageRoot);
assert(readFileSync(archive).equals(readFileSync(repeatedArchive)), 'Repeated package builds must retain identical bytes.');
writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ name: 'host-runtime-acceptance', type: 'module', private: true }));
run(bun, ['add', '--ignore-scripts', '--exact', archive], consumer);
const installedRoot = path.join(consumer, 'node_modules/@sudowork/sudograph-runtime');
assert.equal(JSON.parse(readFileSync(path.join(installedRoot, 'package.json'), 'utf8')).version, metadata.version);
// Check public declarations without monorepo paths or workspace type packages.
writeFileSync(
  path.join(consumer, 'probe.ts'),
  `import { SudographModelClient, type ISudographRuntime, type ISudographContext, type ISudographSourceConnector } from '@sudowork/sudograph-runtime';
const source: ISudographSourceConnector = { sourceType: 'postgresql', host: 'localhost', database: 'fixture' };
const runtime: ISudographRuntime = { python: 'python', compilerRoot: '/worker', modelDirectory: '/models', source: { dsn: 'registered://fixture', connector: source } };
const result: Promise<ISudographContext> = new SudographModelClient(runtime).invoke('fixture', 'host', { operation: 'read', product: 'context' });
void result;
`
);
writeFileSync(path.join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ES2022', strict: true, skipLibCheck: false, types: [], noEmit: true }, files: ['probe.ts'] }));
run(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', path.join(consumer, 'tsconfig.json')], consumer);
const probeEnv = { ...process.env, PYTHONNOUSERSITE: '1' };
for (const key of ['PYTHONPATH', 'PYTHONHOME', 'PYTHONUSERBASE']) delete probeEnv[key];
const compiler = JSON.parse(
  run(
    process.env.SUDOGRAPH_PYTHON,
    [
      '-I',
      '-X',
      'utf8',
      '-c',
      `import compiler,json
from pathlib import Path
from importlib.metadata import distribution
from compiler.managed import code_digest
package=distribution('sudograph-compiler')
assert Path(compiler.__file__).resolve()==package.locate_file('compiler/__init__.py').resolve()
print(json.dumps({'version':package.version,'digest':code_digest()}))`,
    ],
    consumer,
    probeEnv
  )
);
const probeOutput = run(process.execPath, [path.resolve(values.probe)], consumer, { ...probeEnv, SUDOGRAPH_HOST_PACKAGE_ROOT: installedRoot, SUDOWORK_REVIEW_LIVE_EVIDENCE: caseRoot });
const modelReceipt = JSON.parse(probeOutput.trim().split('\n').at(-1));
assert.equal(modelReceipt.status, 'passed');
assert.equal(modelReceipt.installed_host_package, true);
const filename = `sudowork-sudograph-runtime-${metadata.version}.tgz`;
const bytes = readFileSync(archive);
// Exclusive creation keeps prior accepted assets intact.
writeFileSync(path.join(destination, filename), bytes, { flag: 'wx' });
const receipt = {
  format: 'sudograph-host-package-acceptance/v1',
  passed: true,
  name: metadata.name,
  version: metadata.version,
  archive: filename,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  evidence: caseRoot,
  node: process.version,
  compiler,
  reproducible_in_environment: true,
  outside_checkout: true,
  declarations_without_workspace_types: true,
  real_compiler_probe: true,
  source_write_back: false,
  scope: 'Installable host transport and actual canonical compiler fixture; not tenant permissions, production source registration, WebUI or engine publication.',
};
writeFileSync(path.join(destination, 'installed-host-runtime.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
writeFileSync(path.join(destination, 'model-runtime.json'), JSON.stringify(modelReceipt, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(receipt));
