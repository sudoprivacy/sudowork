/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * End-to-end exercise of the real GrpcAcpTransport class against a live
 * nexusd-cluster (managed_agent + the VFS fd-stream tunnel).
 *
 * Unlike scripts/dev/acp-tunnel-smoke.mjs (a raw-client wire check), this drives
 * the actual production class: connect() → managed_agent.start_session_v1 →
 * readStdout (StreamReadAt + NdjsonParser) → onMessage; send() → StreamWriteNowait
 * to fd/0; close() → managed_agent.cancel_v1. The "agent" is a pure-sh NDJSON
 * responder, so no LLM / scode is needed in the daemon's environment.
 *
 * Gated on ACP_GRPC_ENDPOINT (host:port of a host-reachable nexusd-cluster, e.g.
 * a Docker daemon bound 0.0.0.0:2130 --no-tls --insecure-no-auth). Skips when
 * unset so the default suite stays green; the secrets-grpc-e2e-style CI job and
 * local Docker runs set it.
 */

import { describe, it, expect } from 'vitest';
import { GrpcAcpTransport } from '../../src/agent/acp/transport';
import type { AcpMessage } from '../../src/types/acpTypes';

const ENDPOINT = process.env.ACP_GRPC_ENDPOINT;
const suite = ENDPOINT ? describe : describe.skip;

async function waitFor(pred: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

// Mock ACP agent: emit one NDJSON notification on startup, then reply with a
// fixed NDJSON response for every line received on stdin (round-trip proof).
const MOCK_AGENT = [`printf '{"jsonrpc":"2.0","method":"hello","params":{"x":1}}\\n'`, `while IFS= read -r line; do printf '{"jsonrpc":"2.0","id":1,"result":"pong"}\\n'; done`].join('; ');

suite('GrpcAcpTransport ↔ live nexusd-cluster', () => {
  it('spawns via managed_agent, tunnels NDJSON both directions, cancels on close', async () => {
    const messages: AcpMessage[] = [];
    let closed = false;
    const transport = new GrpcAcpTransport({
      endpoint: ENDPOINT!,
      authToken: '',
      agentId: 'acp-transport-itest',
      spawnSpec: { cmd: 'sh', args: ['-c', MOCK_AGENT], env: { PATH: '/usr/bin:/bin' }, cwd: '/tmp', shell: false },
      events: {
        onMessage: (m) => messages.push(m),
        onClose: () => {
          closed = true;
        },
        onSetupError: () => {},
      },
      idlePollMs: 20,
    });

    await transport.connect();
    expect(transport.connected).toBe(true);

    // 1. Agent → client: the startup notification arrives, parsed by NdjsonParser.
    await waitFor(() => messages.some((m) => (m as { method?: string }).method === 'hello'), 5000);
    expect(messages.find((m) => (m as { method?: string }).method === 'hello')).toMatchObject({
      method: 'hello',
      params: { x: 1 },
    });

    // 2. Client → agent → client round-trip: send() writes fd/0, the reply comes
    //    back over fd/1. Proves StreamWriteNowait + the reader together.
    transport.send({ jsonrpc: '2.0', id: 1, method: 'ping' });
    await waitFor(() => messages.some((m) => (m as { id?: number }).id === 1 && (m as { result?: string }).result === 'pong'), 5000);

    // 3. close() cancels the managed session and tears down the client.
    await transport.close();
    expect(transport.connected).toBe(false);
    expect(closed).toBe(false); // graceful close() is not a runtime onClose
  }, 30000);
});
