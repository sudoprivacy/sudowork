/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Production NexusAcpTransport against a live daemon and subprocess adapter.
 * ACP messages travel in session envelopes on the conversation transcript.
 * Set ACP_GRPC_ENDPOINT to run; the agent is a shell fixture with no model.
 */

import { describe, it, expect } from 'vitest';
import { NexusAcpTransport } from '../../src/agent/acp/transport';
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

suite('NexusAcpTransport ↔ live nexusd-cluster', () => {
  it('spawns via managed_agent, exchanges session messages both directions, cancels on close', async () => {
    const messages: AcpMessage[] = [];
    let closed = false;
    const transport = new NexusAcpTransport({
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
    });

    await transport.connect();
    expect(transport.connected).toBe(true);

    // 1. Agent → client: the startup notification arrives, through the session mailbox.
    await waitFor(() => messages.some((m) => (m as { method?: string }).method === 'hello'), 5000);
    expect(messages.find((m) => (m as { method?: string }).method === 'hello')).toMatchObject({
      method: 'hello',
      params: { x: 1 },
    });

    // 2. Round-trip through the shared mailbox and internal subprocess adapter.
    transport.send({ jsonrpc: '2.0', id: 1, method: 'ping' });
    await waitFor(() => messages.some((m) => (m as { id?: number }).id === 1 && (m as { result?: string }).result === 'pong'), 5000);

    // 3. close() cancels the managed session and tears down the client.
    await transport.close();
    expect(transport.connected).toBe(false);
    expect(closed).toBe(false); // graceful close() is not a runtime onClose
  }, 30000);
});
