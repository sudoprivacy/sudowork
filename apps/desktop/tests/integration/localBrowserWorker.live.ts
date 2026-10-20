/** Actual Python/Chrome acceptance for the Desktop transport adapter. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { once } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { LocalBrowserWorker } from '../../src/process/services/browserPanel/LocalBrowserWorker';
import { LocalBrowserSessions } from '../../src/process/services/browserPanel/LocalBrowserSessions';
import { LocalAgentToolControl } from '../../src/process/services/browserPanel/LocalAgentToolControl';

const python = process.env.SUDOWORK_BROWSER_LIVE_PYTHON;
if (!python) throw new Error('SUDOWORK_BROWSER_LIVE_PYTHON must point to an actual adb Python runtime');
const root = mkdtempSync(path.join(process.env.SUDOWORK_BROWSER_LIVE_EVIDENCE || os.tmpdir(), 'desktop-browser-worker-'));
const isHeadless = !process.argv.includes('--headful');
const receipts: string[] = [];
const downloads: string[] = [];
const downloadPayload = Buffer.from('Native browser download receipt 中文');
const server = createServer((request, response) => {
  if (request.url === '/download') {
    downloads.push(request.headers.cookie || '');
    response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="receipt.txt"' });
    response.end(downloadPayload);
  } else if (request.url === '/receipt') {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      receipts.push(body);
      response.setHeader('content-type', 'application/json');
      response.end('{}');
    });
  } else {
    response.setHeader('content-type', 'text/html');
    response.end(
      `<!doctype html><meta charset="utf-8"><style>body{margin:0}input,button,a{display:block;margin:24px;width:240px;height:40px}</style><input id="name"><button id="submit">Submit once</button><a href="/download">Download receipt</a><script>document.cookie='desktop_login=present; Path=/';submit.onclick=event=>fetch('/receipt',{method:'POST',body:JSON.stringify({name:document.querySelector('#name').value,trusted:event.isTrusted,cookie:document.cookie})});</script>`
    );
  }
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert(address && typeof address !== 'string');
const binding = { orgId: 'local', userId: 'fixture-owner', sessionId: randomUUID() };
const isStdio = process.argv.includes('--stdio');
const isPersonal = process.argv.includes('--personal');
const packagedResourcesArg = process.argv.indexOf('--packaged-resources');
const packagedResources = packagedResourcesArg === -1 ? undefined : process.argv[packagedResourcesArg + 1];
if (packagedResourcesArg !== -1) assert(isStdio && packagedResources && !packagedResources.startsWith('--'), '--packaged-resources requires --stdio and an actual resources directory');
const electronArg = process.argv.indexOf('--electron-executable');
const electronExecutable = electronArg === -1 ? undefined : process.argv[electronArg + 1];
if (electronArg !== -1) assert(packagedResources && electronExecutable && !electronExecutable.startsWith('--'), '--electron-executable requires --packaged-resources and an actual executable');
const isHost = process.argv.includes('--host') || isStdio || isPersonal;
let runtimePreparations = 0;
const returns: string[] = [];
const control = new LocalAgentToolControl(() => path.join(root, 'tool-control.json'));
const host = isHost
  ? new LocalBrowserSessions({
      root,
      runtime: async () => {
        runtimePreparations++;
        return python;
      },
      tools: () => JSON.parse(readFileSync(process.env.SUDOWORK_BROWSER_LIVE_PYTHONPATH ? path.join(process.env.SUDOWORK_BROWSER_LIVE_PYTHONPATH, 'ai_dev_browser/remote/mcp-tools.json') : path.resolve('vendor/ai-dev-browser/ai_dev_browser/remote/mcp-tools.json'), 'utf8')),
      control,
      onReturn: async (_conversationId, note, epoch) => {
        control.assertCanPrompt(epoch);
        returns.push(note || '');
      },
      env: { PYTHONPATH: process.env.SUDOWORK_BROWSER_LIVE_PYTHONPATH || '' },
      chromeArgs: process.platform === 'linux' ? ['--no-sandbox'] : [],
    })
  : undefined;
const config = await host?.mcpConfig(binding.sessionId);
const headers = config ? { ...Object.fromEntries(config.headers.map(({ name, value }) => [name, value])), 'Content-Type': 'application/json' } : {};
async function requestMcp(message: unknown) {
  assert(config);
  const response = await fetch(config.url, { method: 'POST', headers, body: JSON.stringify(message) });
  assert.equal(response.status, 200);
  return response.json();
}
if (config) {
  const anonymous = await fetch(config.url, { method: 'POST', body: '{}' });
  assert.equal(anonymous.status, 403);
  await requestMcp({ jsonrpc: '2.0', id: 'initialize', method: 'initialize', params: {} });
  const listed = (await requestMcp({ jsonrpc: '2.0', id: 'list', method: 'tools/list' })) as { result: { tools: unknown[] } };
  assert.equal(listed.result.tools.length, 5);
  const launchTool = listed.result.tools.find((value) => (value as { name: string }).name === 'browser_launch') as { inputSchema: { properties: { transport: { enum: string[]; default: string } } } };
  assert.deepEqual(launchTool.inputSchema.properties.transport.enum, ['cdp']);
  const requiresSelection = (await requestMcp({ jsonrpc: '2.0', id: 'personal-requires-selection', method: 'tools/call', params: { name: 'browser_launch', arguments: { transport: 'extension', isHeadless: true } } })) as { result: { isError: boolean; content: Array<{ text: string }> } };
  assert.equal(requiresSelection.result.isError, true);
  assert(requiresSelection.result.content[0].text.includes('Connect my Chrome'));
  const idle = await host!.invoke(binding.sessionId, { kind: 'state' });
  assert.equal(idle.session.state, 'stopped');
  assert.equal(runtimePreparations, 0, 'Tool discovery must not allocate Python or Chrome');
}
let stdio: Client | undefined;
if (isStdio) {
  assert(config);
  stdio = new Client({ name: 'native-browser-live', version: '1.0.0' }, { capabilities: {} });
  const script = packagedResources ? path.join(packagedResources, 'browser-panel-mcp', 'shared.js') : path.resolve('apps/desktop/resources/browser-panel-mcp/shared.js');
  await stdio.connect(
    new StdioClientTransport({
      command: electronExecutable || process.execPath,
      args: [script],
      env: { SUDOWORK_BROWSER_MCP_URL: config.url, SUDOWORK_BROWSER_MCP_TOKEN: config.headers[0].value.slice('Bearer '.length), ...(electronExecutable ? { ELECTRON_RUN_AS_NODE: '1' } : {}) },
      stderr: 'inherit',
    })
  );
  assert.equal((await stdio.listTools()).tools.length, 5);
  assert.equal(runtimePreparations, 0);
}
const worker: Pick<LocalBrowserWorker, 'start' | 'mcp' | 'invoke' | 'upload' | 'download' | 'close'> = host
  ? {
      start: async () => {},
      mcp: async (message) => {
        if (!stdio) return requestMcp(message);
        const request = message as { id: number; params: { name: string; arguments: Record<string, unknown> } };
        return { jsonrpc: '2.0', id: request.id, result: await stdio.callTool(request.params) };
      },
      invoke: (action) => host.invoke(binding.sessionId, action as Parameters<LocalBrowserSessions['invoke']>[1]),
      upload: async (input) => ({ file: await host.upload(binding.sessionId, input) }),
      download: (fileId) => host.download(binding.sessionId, fileId),
      close: () => host.close(),
    }
  : new LocalBrowserWorker({ root, python, binding, env: { PYTHONPATH: process.env.SUDOWORK_BROWSER_LIVE_PYTHONPATH || '' }, chromeArgs: process.platform === 'linux' ? ['--no-sandbox'] : [] });
let sequence = 0;
async function tool(name: string, args: Record<string, unknown>, isError = false) {
  const response = (await worker.mcp({ jsonrpc: '2.0', id: ++sequence, method: 'tools/call', params: { name, arguments: args } })) as { result: { isError?: boolean; content: Array<{ type: string; text?: string }> } };
  assert.equal(response.result.isError === true, isError, JSON.stringify(response));
  const text = response.result.content[0].text;
  assert.equal(typeof text, 'string');
  return isError ? text : JSON.parse(text!);
}
try {
  await worker.start();
  let launch;
  if (isPersonal) {
    const discovered = await host!.invoke(binding.sessionId, { kind: 'inspect-existing-extension' });
    assert(discovered.existingExtension);
    const attached = await host!.invoke(binding.sessionId, { kind: 'connect-existing-extension', ...discovered.existingExtension });
    assert.equal(attached.session.isHeadless, null);
    assert.equal(attached.session.capabilities.lifecycle, false);
    assert.equal(attached.session.capabilities.fileTransfer, false);
    assert.equal(control.status().state, 'human');
    const prepared = await host!.invoke(binding.sessionId, { kind: 'navigate', url: `http://127.0.0.1:${address.port}`, controlEpoch: attached.session.controlEpoch, targetEpoch: attached.session.targetEpoch });
    launch = await host!.invoke(binding.sessionId, { kind: 'return', note: 'Use the connected personal Chrome', controlEpoch: prepared.session.controlEpoch, targetEpoch: prepared.session.targetEpoch });
  } else launch = await tool('browser_launch', { ...(!isHost ? { transport: 'cdp' } : {}), isHeadless });
  const initial = launch.session;
  const epochs = (session: { controlEpoch: number; targetEpoch: number }) => ({ controlEpoch: session.controlEpoch, targetEpoch: session.targetEpoch });
  await tool('browser_action', { kind: 'navigate', url: `http://127.0.0.1:${address.port}`, ...epochs(initial) });
  const observed = (await tool('browser_observe', {})).session;
  for (const viewerId of [randomUUID(), randomUUID()]) await worker.invoke({ kind: 'attach', viewerId, surface: 'page' });
  const held = ((await worker.invoke({ kind: 'take', ...epochs(observed) })) as { session: typeof observed }).session;
  assert(held.isController && held.isHumanControlHeld);
  const blocked = await tool('browser_action', { kind: 'command', method: 'Runtime.evaluate', paramsJson: JSON.stringify({ expression: "document.querySelector('#name').value='bypass'" }), ...epochs(held) }, true);
  assert.equal(blocked, 'browser_control_held_by_user');
  const payload = Buffer.from('Native Desktop upload 中文');
  const staged = !isPersonal ? ((await worker.upload({ name: '报告.txt', data: payload, ...epochs(held) })) as { file: { bytes: number; sha256: string } }) : null;
  if (staged) {
    assert.equal(staged.file.bytes, payload.length);
    assert.equal(staged.file.sha256, createHash('sha256').update(payload).digest('hex'));
  }
  await worker.invoke({ kind: 'input', input: { kind: 'click', x: 80, y: 40 }, ...epochs(held) });
  await worker.invoke({ kind: 'input', input: { kind: 'text', text: 'Desktop human 中文' }, ...epochs(held) });
  const returned = ((await worker.invoke({ kind: 'return', note: 'Read the edited field before continuing', ...epochs(held) })) as { session: typeof held }).session;
  assert.equal(returned.browserSessionId, initial.browserSessionId);
  assert.equal(returned.profileId, initial.profileId);
  if (host) {
    assert.equal(runtimePreparations, 1);
    assert.deepEqual(returns, [...(isPersonal ? ['Use the connected personal Chrome'] : []), 'Read the edited field before continuing']);
    assert.equal(control.status().state, 'ai');
  }
  await tool('browser_observe', {});
  const value = await tool('browser_action', { kind: 'command', method: 'Runtime.evaluate', paramsJson: JSON.stringify({ expression: "document.querySelector('#name').value", returnByValue: true }), ...epochs(returned) });
  assert.equal(value.result.result.value, 'Desktop human 中文');
  await tool('browser_action', { kind: 'input', input: { kind: 'click', x: 80, y: 105 }, ...epochs(returned) });
  await tool('browser_observe', {});
  assert.equal(receipts.length, 1);
  const receipt = JSON.parse(receipts[0]);
  assert.equal(receipt.name, 'Desktop human 中文');
  assert.equal(receipt.trusted, true);
  assert(receipt.cookie.includes('desktop_login=present'));
  if (isPersonal) {
    assert(process.env.SUDOWORK_PERSONAL_COOKIE);
    assert(receipt.cookie.includes(process.env.SUDOWORK_PERSONAL_COOKIE), 'The cookie present before host attachment must survive');
    // Fault injection kills the actual owned Python child, never a browser or
    // another workline. All recovery and disconnect operations use host APIs.
    const processes = host as unknown as { workers: Map<string, Promise<{ child: ChildProcess }>> };
    const child = (await processes.workers.get(binding.sessionId)!).child;
    assert(child.pid);
    const crashed = once(child, 'exit');
    child.kill('SIGKILL');
    await crashed;
    const restored = await host!.invoke(binding.sessionId, { kind: 'state' });
    assert.equal(restored.session.state, 'stopped');
    assert(restored.session.personalExtension);
    assert.equal(restored.session.isController, false);
    const disconnected = await host!.invoke(binding.sessionId, { kind: 'disconnect-existing-extension', ...epochs(restored.session) });
    assert.equal(disconnected.session.personalExtension, null);
    assert.equal(disconnected.session.isController, true);
    assert.equal(control.status().state, 'human');
    writeFileSync(
      path.join(root, 'evidence.json'),
      JSON.stringify({ isPersonal, actualChrome: true, browserSessionId: initial.browserSessionId, profileId: initial.profileId, aiBlocked: true, originalCookie: true, trustedReceipt: receipt, sameBrowserAfterReturn: true, realWorkerCrashRecoveredThroughHost: true }, null, 2)
    );
    console.log(JSON.stringify({ passed: true, isPersonal, evidence: path.join(root, 'evidence.json') }));
  } else {
    await tool('browser_action', { kind: 'input', input: { kind: 'click', x: 80, y: 169 }, ...epochs(returned) });
    const deadline = Date.now() + 10_000;
    let download: { id: string; sha256: string } | undefined;
    while (!download) {
      const state = (await worker.invoke({ kind: 'state' })) as { session: { downloads: Array<{ id: string; sha256: string }> } };
      download = state.session.downloads[0];
      if (!download) {
        assert(Date.now() < deadline, 'Actual browser download did not complete');
        await delay(50);
      }
    }
    assert.equal(downloads.length, 1);
    assert(downloads[0].includes('desktop_login=present'));
    assert.deepEqual(Buffer.from(await worker.download(download.id)), downloadPayload);
    assert.equal(download.sha256, createHash('sha256').update(downloadPayload).digest('hex'));
    writeFileSync(path.join(root, 'evidence.json'), JSON.stringify({ isHeadless, browserSessionId: initial.browserSessionId, profileId: initial.profileId, aiBlocked: true, originalCookie: true, trustedReceipt: receipt, stagedFile: staged!.file, downloaded: download }, null, 2));
    console.log(JSON.stringify({ passed: true, isHeadless, isHost, isStdio, evidence: path.join(root, 'evidence.json') }));
  }
} finally {
  await stdio?.close();
  await worker.close();
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
