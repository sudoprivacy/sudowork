import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ScodeAcpTransport } from '../../src/agent/acp/transport';
import { configureScodeService, getScodeServiceClient } from '../../src/common/scode/serviceClient';
import type { AcpMessage } from '../../src/types/acpTypes';

const suite = process.env.SUDOWORK_RUNTIME_E2E === '1' ? describe : describe.skip;

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Session did not respond before the deadline');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

suite('desktop session adapter through the actual Sudocode service', () => {
  let root: string;
  let originalServiceRoot: string | undefined;
  const transports: ScodeAcpTransport[] = [];
  beforeAll(async () => {
    if (!process.env.SCODE_BIN) throw new Error('SCODE_BIN is required');
    root = await mkdtemp(path.join(os.tmpdir(), 'scode-sessions-'));
    originalServiceRoot = process.env.SCODE_SERVICE_ROOT;
    process.env.SCODE_SERVICE_ROOT = root;
    configureScodeService(() => process.env.SCODE_BIN!);
    await getScodeServiceClient().request('service.install', {}, 600_000);
    await writeFile(
      path.join(root, 'agent.cjs'),
      [
        "const readline = require('node:readline');",
        "console.log(JSON.stringify({jsonrpc:'2.0',method:'hello',params:{pid:process.pid}}));",
        "readline.createInterface({input:process.stdin}).on('line', line => {",
        '  const message = JSON.parse(line);',
        "  console.log(JSON.stringify({jsonrpc:'2.0',id:message.id,result:message.params}));",
        '});',
      ].join('\n')
    );
  }, 600_000);

  afterAll(async () => {
    await Promise.all(transports.map((transport) => transport.close()));
    if (root) await getScodeServiceClient().request('service.shutdown');
    getScodeServiceClient().close();
    if (originalServiceRoot === undefined) delete process.env.SCODE_SERVICE_ROOT;
    else process.env.SCODE_SERVICE_ROOT = originalServiceRoot;
  });

  it('runs two managed agents, preserves their separate mailboxes, and sends while reads wait', async () => {
    const messages: AcpMessage[][] = [[], []];
    for (let index = 0; index < 2; index++) {
      const transport = new ScodeAcpTransport({
        agentId: `service-fixture-${index}`,
        spawnSpec: { cmd: process.execPath, args: [path.join(root, 'agent.cjs')], env: { ...process.env }, cwd: root, shell: false },
        events: { onMessage: (message) => messages[index].push(message), onClose: () => {}, onSetupError: () => {} },
      });
      transports.push(transport);
      await transport.connect();
    }
    await waitFor(() => messages.every((entries) => entries.some((message) => 'method' in message && message.method === 'hello')));
    const start = Date.now();
    transports.forEach((transport, index) => transport.send({ jsonrpc: '2.0', id: 7, method: 'ping', params: { recipient: index, text: '完整字节 round trip' } }));
    await waitFor(() => messages.every((entries) => entries.some((message) => 'id' in message && message.id === 7)));
    expect(Date.now() - start).toBeLessThan(2000);
    messages.forEach((entries, index) => expect(entries.find((message) => 'id' in message && message.id === 7)).toMatchObject({ result: { recipient: index, text: '完整字节 round trip' } }));
    const pids = transports.map((transport) => transport.pid);
    expect(pids.every((pid) => typeof pid === 'number' && pid > 0)).toBe(true);
    expect(new Set(pids).size).toBe(2);
    await transports[0].close();
    expect(transports[1].connected).toBe(true);
    transports[1].send({ jsonrpc: '2.0', id: 8, method: 'ping', params: { afterPeerClosed: true } });
    await waitFor(() => messages[1].some((message) => 'id' in message && message.id === 8));
  }, 45_000);
});
