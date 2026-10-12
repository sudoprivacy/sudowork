import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ scope: 'account-a', request: vi.fn(), token: vi.fn() }));
vi.mock('electron', () => ({ net: { fetch: state.request } }));
vi.mock('@process/initStorage', () => ({ ProcessConfig: { getSync: (key: string) => (key === 'eeclaw.serverUrl' ? 'http://moss.test' : state.scope) } }));
vi.mock('@process/bridge/eeclawBridge', () => ({ getValidToken: state.token }));
import { externalProviderPort } from '@process/services/mossExternalProviders';
beforeEach(() => {
  vi.clearAllMocks();
  state.scope = 'account-a';
  state.token.mockResolvedValue('session-token');
  state.request.mockResolvedValue(Response.json({ success: true, data: [] }));
});
it('desktop uses only its current Moss token and exposes no provider credential', async () => {
  expect(await externalProviderPort.agents()).toEqual([]);
  expect(state.request).toHaveBeenCalledWith('http://moss.test/api/v1/external-agents', expect.objectContaining({ headers: { Authorization: 'Bearer session-token' } }));
});
it('account switches invalidate a late response', async () => {
  state.request.mockImplementation(async () => {
    state.scope = 'account-b';
    return Response.json({ success: true, data: [] });
  });
  await expect(externalProviderPort.agents()).rejects.toThrow('identity changed');
});
it('transport errors do not trigger an automatic task retry', async () => {
  state.request.mockRejectedValue(new Error('connection closed'));
  await expect(externalProviderPort.create({ agent_id: 'a', query: 'synthetic', idempotency_key: 'key-123456' })).rejects.toThrow();
  expect(state.request).toHaveBeenCalledTimes(1);
});
