import { createServer } from 'node:http';
import { once } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onAgentArchiveRequest } from '@process/services/authProxy/agentArchiveApi';

const mocks = vi.hoisted(() => ({ identity: vi.fn(() => ({ server: 'https://cloud.example', scope: 'alice' })), assertIdentity: vi.fn(), token: vi.fn(async () => 'cloud-token') }));
vi.mock('@process/services/mossCatalogApi', () => ({ mossCatalogIdentity: mocks.identity, assertMossCatalogIdentity: mocks.assertIdentity }));
vi.mock('@process/bridge/eeclawBridge', () => ({ getValidToken: mocks.token }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('private archive account forwarding', () => {
  it('forwards bytes with host credentials and exposes no token in its response', async () => {
    const clientFetch = globalThis.fetch;
    const upstream = vi.fn(async () => new Response(JSON.stringify({ agents: [] }), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', upstream);
    const server = createServer((req, res) => {
      void onAgentArchiveRequest(req, res, new URL(req.url!, 'http://localhost').pathname);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const address = server.address() as { port: number };
      const response = await clientFetch(`http://127.0.0.1:${address.port}/agent-archives`);
      expect(await response.json()).toEqual({ agents: [] });
      expect(upstream).toHaveBeenCalledWith('https://cloud.example/api/v1/agents/private-archives', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer cloud-token' }), redirect: 'error' }));
      expect(mocks.assertIdentity).toHaveBeenCalledTimes(2);
      const rejected = await clientFetch(`http://127.0.0.1:${address.port}/agent-archives/../../secrets`);
      expect(rejected.status).toBe(404);
      expect(upstream).toHaveBeenCalledTimes(1);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
