/**
 * Real scode ACP session driven through the production GrpcAcpTransport, over a
 * managed_agent nexusd-cluster tunnel. Unlike acp-tunnel-smoke.mjs (sh echo) this
 * spawns REAL scode via managed_agent and runs the full ACP handshake:
 * initialize → session/new → session/prompt → real LLM response.
 *
 *   ACP_GRPC_ENDPOINT=127.0.0.1:2130 SCODE_BIN=/opt/scode/scode-linux-x64/scode \
 *     bun run scripts/dev/acp-scode-e2e.ts
 */
import { GrpcAcpTransport } from '../../src/agent/acp/transport';

const ENDPOINT = process.env.ACP_GRPC_ENDPOINT || '127.0.0.1:2130';
const SCODE = process.env.SCODE_BIN || '/opt/scode/scode-linux-x64/scode';

/* eslint-disable @typescript-eslint/no-explicit-any */
const pending = new Map<number, (m: any) => void>();
let sawText = '';

const transport = new GrpcAcpTransport({
  endpoint: ENDPOINT,
  authToken: '',
  agentId: 'scode-e2e',
  spawnSpec: {
    cmd: SCODE,
    args: ['--auth', 'proxy', 'acp'],
    env: {
      HOME: '/root',
      SCODE_HOME: '/root/.nexus/sudocode',
      PATH: '/usr/bin:/bin:/opt/scode/scode-linux-x64',
      TERM: 'xterm',
    },
    cwd: '/tmp/ws',
    shell: false,
  },
  events: {
    onMessage: (m: any) => handle(m),
    onClose: (info) => console.log('[transport] onClose', JSON.stringify(info)),
    onSetupError: (e) => console.log('[transport] onSetupError', e.message),
  },
  idlePollMs: 20,
});

function handle(m: any): void {
  // response to one of our requests
  if (typeof m.id === 'number' && m.method === undefined && pending.has(m.id)) {
    pending.get(m.id)!(m);
    pending.delete(m.id);
    return;
  }
  // agent → client request — answer minimally so scode doesn't stall
  if (m.method && typeof m.id === 'number') {
    if (m.method === 'session/request_permission') {
      transport.send({ jsonrpc: '2.0', id: m.id, result: { outcome: { outcome: 'selected', optionId: 'allow' } } });
    } else {
      transport.send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: `unsupported: ${m.method}` } });
    }
    return;
  }
  // notification: collect streamed assistant text
  if (m.method === 'session/update') {
    const u = m.params?.update;
    const t = u?.content?.text;
    if (u?.sessionUpdate === 'agent_message_chunk' && typeof t === 'string') {
      sawText += t;
      process.stdout.write(t);
    }
  }
}

let nextId = 0;
function rpc(method: string, params: unknown, timeoutMs = 60000): Promise<any> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    pending.set(id, (m) => {
      clearTimeout(timer);
      resolve(m);
    });
    transport.send({ jsonrpc: '2.0', id, method, params });
  });
}

(async () => {
  await transport.connect();
  console.log(`[e2e] connected via managed_agent, os_pid=${transport.pid}`);

  const init = await rpc('initialize', {
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
  });
  console.log('[e2e] initialize →', JSON.stringify(init.result ?? init.error));

  const ns = await rpc('session/new', { cwd: '/tmp/ws', mcpServers: [] });
  console.log('[e2e] session/new →', JSON.stringify(ns.result ?? ns.error));
  const sid = ns.result?.sessionId;

  if (sid) {
    console.log('[e2e] session/prompt → (streaming real LLM):');
    const pr = await rpc(
      'session/prompt',
      { sessionId: sid, prompt: [{ type: 'text', text: 'Reply with exactly the single word PONG and nothing else.' }] },
      120000,
    );
    console.log('\n[e2e] prompt result →', JSON.stringify(pr.result ?? pr.error));
  }

  await transport.close();
  const ok = sawText.toUpperCase().includes('PONG');
  console.log(`[e2e] ${ok ? '✅ REAL scode ACP session PASS (PONG received)' : '⚠️ handshake ok, LLM text=' + JSON.stringify(sawText.slice(0, 80))}`);
  process.exit(0);
})().catch((e) => {
  console.error('[e2e] ERROR:', e.message);
  process.exit(1);
});
