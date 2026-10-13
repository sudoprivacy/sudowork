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

it('refreshes once after an unexpected 401 and preserves the exact POST identity', async () => {
  state.token.mockResolvedValueOnce('old-token').mockResolvedValueOnce('new-token');
  state.request.mockResolvedValueOnce(Response.json({}, { status: 401 })).mockResolvedValueOnce(Response.json({ success: true, data: [] }));
  await expect(externalProviderPort.create({ agent_id: 'a', query: 'synthetic', idempotency_key: 'key-123456' })).rejects.toThrow();
  expect(state.token).toHaveBeenLastCalledWith(true);
  expect(state.request).toHaveBeenCalledTimes(2);
  expect(state.request.mock.calls[0][1].body).toBe(state.request.mock.calls[1][1].body);
  expect(state.request.mock.calls[1][1].headers.Authorization).toBe('Bearer new-token');
});
it('does not loop on 401 or retry after identity changes during refresh', async () => {
  state.request.mockImplementation(async () => Response.json({}, { status: 401 }));
  await expect(externalProviderPort.agents()).rejects.toThrow();
  expect(state.request).toHaveBeenCalledTimes(2);
  state.request.mockClear();
  state.token.mockImplementation(async (isForced: boolean) => {
    if (isForced) state.scope = 'account-b';
    return 'token';
  });
  await expect(externalProviderPort.agents()).rejects.toThrow('identity changed');
  expect(state.request).toHaveBeenCalledTimes(1);
});
