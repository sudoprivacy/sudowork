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
  `import { SudographModelClient, SudographReviewHost, SudographReviewComments, ShareoneReviewAssets, type ISudographReviewGrantStore, type ISudographReviewStore, type ISudographReviewLaunch, type ISudographRuntime, type ISudographContext, type ISudographSourceConnector } from '@sudowork/sudograph-runtime';
const source: ISudographSourceConnector = { sourceType: 'postgresql', host: 'localhost', database: 'fixture' };
const runtime: ISudographRuntime = { python: 'python', compilerRoot: '/worker', modelDirectory: '/models', source: { dsn: 'registered://fixture', connector: source } };
const result: Promise<ISudographContext> = new SudographModelClient(runtime).invoke('fixture', 'host', { operation: 'read', product: 'context' });
void result;
const assets = new ShareoneReviewAssets();
const file: { body: Uint8Array; contentType: string } | undefined = assets.get('entry.js');
const host = new SudographReviewHost({ authorize: async () => {}, read: async () => ({}) });
const launch: Promise<ISudographReviewLaunch> = host.createSession({ workspaceId: 'fixture', conversationId: 'conversation' });
void file; void launch;
declare const grants: ISudographReviewGrantStore;
const embedded = new SudographReviewHost({ authorize: async () => 'ownership-generation',
  read: async (_workspace, _request, binding) => ({ conversation: binding.conversationId }),
  embedded: { origin: 'https://review.example', grants } });
const revoked: Promise<void> = embedded.createSession({ workspaceId: 'fixture', conversationId: 'conversation', authorizationRef: 'ownership-generation' }).then(async launch => { await launch.revoke(); });
void revoked;
declare const database: ISudographReviewStore;
const comments = new SudographReviewComments({ database, baseUrl: 'https://review.example', currentAccount: () => 'fixture', getKey: async () => null,
  setKey: async () => {}, authorize: async () => {}, head: async () => ({ revision: 'revision', context_digest: 'digest' }),
  deliver: async () => ({ success: true }), messageExists: async () => false });
const status = comments.status('fixture', 'conversation');
void status;
`
);
writeFileSync(path.join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ES2022', strict: true, skipLibCheck: false, types: [], noEmit: true }, files: ['probe.ts'] }));
run(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', path.join(consumer, 'tsconfig.json')], consumer);
writeFileSync(
  path.join(consumer, 'review.mjs'),
  `import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { SudographReviewHost, SudographReviewComments, ShareoneReviewAssets } from '@sudowork/sudograph-runtime';
assert.equal(typeof new ShareoneReviewAssets().load, 'function');
const host = new SudographReviewHost({ authorize: async () => {}, read: async () => '<html>installed-review-transport</html>' });
try {
  const launch = await host.createSession({ workspaceId: 'fixture', conversationId: 'conversation' });
  assert.deepEqual(JSON.parse(JSON.stringify(launch)), { url: launch.url });
  assert(!launch.url.includes(launch.cookie.value));
  assert.equal((await fetch(launch.url)).status, 403);
  const headers = { Cookie: launch.cookie.name + '=' + launch.cookie.value };
  const response = await fetch(launch.url, { headers });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '<html>installed-review-transport</html>');
  await launch.revoke();
  assert.equal((await fetch(launch.url, { headers })).status, 403);
} finally { await host.close(); }
const comments = new SudographReviewComments({
  database: { reviewDeliverySummary: async () => ({ delivered: 3 }) },
  baseUrl: 'https://review.example', currentAccount: () => 'fixture', getKey: async () => null, setKey: async () => {},
  authorize: async () => {}, head: async () => ({ revision: 'revision', context_digest: 'digest' }),
  deliver: async () => ({ success: true }), messageExists: async () => false,
  fetcher: async () => { throw new Error('No anonymous provider requests permitted'); },
});
try {
  assert.deepEqual(await comments.status('fixture', 'conversation'), { delivered: 3 });
  assert.equal(await comments.prepare('fixture', 'conversation'), null);
} finally { comments.close(); }
const shared = new Map();
const grants = {
  create: async (id, value) => { assert(!shared.has(id)); shared.set(id, structuredClone(value)); },
  get: async id => { const value = shared.get(id); return value ? structuredClone(value) : undefined; },
  update: async (id, expected, changes) => {
    const current = shared.get(id);
    if (!current || current.credentialHash !== expected.credentialHash || current.authorizationRef !== expected.authorizationRef) return false;
    Object.assign(current, changes); return true;
  },
  delete: async id => { shared.delete(id); },
};
let current;
const server = createServer((request, response) => {
  void current.handleRequest(request, response).then(handled => { if (!handled) response.writeHead(404).end(); });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
let authorizationRef = 'epoch-1';
const make = () => new SudographReviewHost({ embedded: { origin, grants },
  authorize: async binding => { assert.equal(binding.authorizationRef, authorizationRef); return authorizationRef; },
  read: async (_workspace, _request, binding) => '<html>' + binding.conversationId + '</html>',
});
const first = make(); current = first;
let second;
try {
  await assert.rejects(first.createSession({ workspaceId: 'fixture', conversationId: 'conversation' }), /durable authorization reference/);
  const launch = await first.createSession({ workspaceId: 'fixture', conversationId: 'conversation', authorizationRef });
  assert.equal(new URL(launch.url).origin, origin);
  assert(!JSON.stringify([...shared.values()]).includes(launch.cookie.value));
  const headers = { Cookie: launch.cookie.name + '=' + launch.cookie.value };
  assert.equal((await fetch(launch.url)).status, 403);
  assert.equal(await (await fetch(launch.url, { headers })).text(), '<html>conversation</html>');
  second = make(); current = second;
  await first.close();
  assert.equal(await (await fetch(launch.url, { headers })).text(), '<html>conversation</html>');
  authorizationRef = 'epoch-2';
  assert.equal((await fetch(launch.url, { headers })).status, 403);
  const fresh = await second.createSession({ workspaceId: 'fixture', conversationId: 'conversation', authorizationRef });
  assert.equal((await fetch(fresh.url, { headers: { Cookie: fresh.cookie.name + '=' + fresh.cookie.value } })).status, 200);
  await fresh.revoke();
  assert.equal((await fetch(fresh.url, { headers: { Cookie: fresh.cookie.name + '=' + fresh.cookie.value } })).status, 403);
} finally {
  await first.close(); await second?.close();
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
`
);
run(process.execPath, [path.join(consumer, 'review.mjs')], consumer);
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
  installed_review_transport: true,
  installed_comment_provider: true,
  installed_embedded_review_transport: true,
  source_write_back: false,
  scope: 'Installable host transport and actual canonical compiler fixture; not tenant permissions, production source registration, WebUI or engine publication.',
};
writeFileSync(path.join(destination, 'installed-host-runtime.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
writeFileSync(path.join(destination, 'model-runtime.json'), JSON.stringify(modelReceipt, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(receipt));
