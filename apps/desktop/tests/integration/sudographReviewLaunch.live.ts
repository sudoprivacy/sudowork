/** Real compiler, HTTP review host and controlled Chrome; no fixture cookie install. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { SudographModelClient } from '../../src/process/services/ontology/SudographModelClient';
import { SudographReviewHost } from '../../src/process/services/ontology/SudographReviewHost';
import { LocalBrowserSessions } from '../../src/process/services/browserPanel/LocalBrowserSessions';
import { LocalAgentToolControl } from '../../src/process/services/browserPanel/LocalAgentToolControl';

const python = process.env.SUDOGRAPH_PYTHON;
const compilerRoot = process.env.SUDOGRAPH_COMPILER_ROOT;
if (!python || !compilerRoot) throw new Error('Set SUDOGRAPH_PYTHON and SUDOGRAPH_COMPILER_ROOT to the checked compiler runtime.');
const output = process.env.SUDOWORK_REVIEW_LIVE_EVIDENCE || os.tmpdir();
mkdirSync(output, { recursive: true });
const root = mkdtempSync(path.join(output, 'native-review-'));
const database = path.join(root, 'source.sqlite');
const created = spawnSync(python, ['-c', 'import sqlite3,sys; db=sqlite3.connect(sys.argv[1]); db.executescript("CREATE TABLE Tickets(id INTEGER PRIMARY KEY, note TEXT); INSERT INTO Tickets VALUES(1, \'source-only-row\');"); db.close()', database], { windowsHide: true });
assert.equal(created.status, 0, 'Synthetic source creation failed');
const before = createHash('sha256').update(readFileSync(database)).digest('hex');
const client = new SudographModelClient({ python, compilerRoot, modelDirectory: root });
const receipt = await client.registerSource('model', 'fixture-host', { source: `sqlite:///${database.split(path.sep).join('/')}`, namespace: 'support', operationId: randomUUID(), language: 'en' });
const conversationId = 'bound-review-chat';
const control = new LocalAgentToolControl(() => path.join(root, 'tool-control.json'));
let pauses = 0;
let resumes = 0;
control.register('fixture-engine', {
  ready: async () => {},
  connection: {
    hasActiveSession: true,
    isToolPauseSupported: true,
    pauseTools: async () => ({ sessionId: 'fixture-engine', pauseEpoch: ++pauses }),
    resumeTools: async () => {
      resumes++;
    },
  },
});
const browser = new LocalBrowserSessions({
  root: path.join(root, 'browser'),
  runtime: async () => process.env.SUDOWORK_BROWSER_LIVE_PYTHON || python,
  tools: () => [],
  control,
  onReturn: async () => {},
  env: { PYTHONPATH: process.env.SUDOWORK_BROWSER_LIVE_PYTHONPATH || '' },
  chromeArgs: process.platform === 'linux' ? ['--no-sandbox'] : [],
});
const reads: string[] = [];
let deliveredHtml = '';
const review = new SudographReviewHost({
  authorize: (binding) => {
    assert.equal(binding.workspaceId, 'source');
    assert.equal(binding.conversationId, conversationId);
  },
  read: async (_workspaceId, request) => {
    reads.push(String(request.operation));
    const value = await client.review('model', 'fixture-host', 'source', request);
    if (request.operation === 'html') {
      deliveredHtml = value as string;
    }
    return value;
  },
});
const isHeadless = !process.argv.includes('--headful');
let status: Record<string, unknown> = { status: 'incomplete', root, browser_mode: isHeadless ? 'headless' : 'headful' };
const evidence = path.join(root, 'receipt.json');
writeFileSync(evidence, JSON.stringify(status, null, 2) + '\n');
try {
  const launch = await review.createSession({ workspaceId: 'source', conversationId });
  assert(!JSON.stringify(launch).includes(launch.cookie.value));
  assert.equal((await fetch(launch.url)).status, 403);
  const opened = await browser.openAuthorizedPage(conversationId, launch, { isHeadless });
  assert.deepEqual(opened, { surface: isHeadless ? 'viewer' : 'native', conversationId });
  assert.equal(pauses, 1, 'The existing engine barrier must acknowledge the user review');
  const held = (await browser.invoke(conversationId, { kind: 'state' })).session;
  assert.equal(held.state, 'human');
  assert(held.isController);
  assert.equal(held.tabs.find((tab) => tab.id === held.activeTargetId)?.url, launch.url);
  assert.deepEqual(reads, ['html']);
  assert.equal(typeof deliveredHtml, 'string');
  assert(deliveredHtml.includes(receipt.contract.revision));
  assert(!deliveredHtml.includes('source-only-row'));
  // A request reaching the host is insufficient: inspect the actual document
  // through the same authorized worker, so an error page cannot pass.
  const renderDeadline = Date.now() + 30_000;
  let rendered = false;
  while (!rendered && Date.now() < renderDeadline) {
    const observed = (await browser.observePage(conversationId)) as { observation: { accessibility: { name?: { value?: string } }[] } };
    rendered = observed.observation.accessibility.some((node) => node.name?.value?.includes('Tickets'));
    if (!rendered) await delay(20);
  }
  assert(rendered, 'The actual browser must render the registered source object, not an error page');
  assert.equal((await fetch(launch.url)).status, 403, 'The URL alone never authorizes another browser');
  const viewerId = randomUUID();
  await browser.invoke(conversationId, { kind: 'attach', viewerId, surface: 'page' });
  // Capture through the same authenticated viewer. No side browser or direct
  // cookie installation is used by this acceptance journey.
  const frame = await browser.invoke(conversationId, { kind: 'frame', viewerId, surface: 'page', controlEpoch: held.controlEpoch, targetEpoch: held.targetEpoch });
  assert(frame.frame && frame.frame.data.length > 1000);
  writeFileSync(path.join(root, 'native-review.png'), Buffer.from(frame.frame.data, 'base64'));
  await browser.invoke(conversationId, { kind: 'reload', controlEpoch: frame.session.controlEpoch, targetEpoch: frame.session.targetEpoch });
  const deadline = Date.now() + 5000;
  while (reads.length < 2 && Date.now() < deadline) await delay(20);
  assert.deepEqual(reads, ['html', 'html']);
  const epoch = await browser.prepareUserMessage(conversationId);
  assert.equal(control.assertCanPrompt(epoch), epoch);
  assert.equal(resumes, 1, 'The ordinary message path returns control through a fresh observation');
  assert.equal(createHash('sha256').update(readFileSync(database)).digest('hex'), before);
  status = {
    ...status,
    status: 'passed',
    revision: receipt.contract.revision,
    actual_controlled_browser_handoff: true,
    actual_registered_object_rendered: true,
    fixture_cookie_install: false,
    host_session_preserved_on_reload: true,
    anonymous_denied: true,
    engine_pause_and_ordinary_message_resume: true,
    engine_adapter: 'synthetic acknowledgement fixture; no agent process',
    source_unchanged: true,
    cloud_login_verified: false,
    shareone_comments_verified: false,
  };
} finally {
  const cleanup = await Promise.allSettled([browser.close(), review.close()]);
  if (cleanup.some((result) => result.status === 'rejected')) status = { ...status, status: 'incomplete', cleanup_failed: true };
  writeFileSync(evidence, JSON.stringify(status, null, 2) + '\n');
}
assert.equal(status.status, 'passed', 'The complete journey and owned cleanup must pass');
console.log(JSON.stringify({ ...status, evidence }));
