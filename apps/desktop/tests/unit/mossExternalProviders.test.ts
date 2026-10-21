import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EXTERNAL_REQUEST_TIMEOUT_MS } from '@sudowork/moss-client/external-providers';
const state = vi.hoisted(() => ({ scope: 'account-a', request: vi.fn(), token: vi.fn() }));
vi.mock('electron', () => ({ net: { fetch: state.request } }));
vi.mock('@process/initStorage', () => ({ ProcessConfig: { getSync: (key: string) => (key === 'eeclaw.serverUrl' ? 'http://moss.test' : state.scope) } }));
vi.mock('@process/bridge/eeclawBridge', () => ({ getValidToken: state.token }));
import { externalProviderPort, hostedTaskPort } from '@process/services/mossExternalProviders';
afterEach(() => vi.useRealTimers());
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
  await expect(externalProviderPort.agents()).rejects.toThrow('EXTERNAL_IDENTITY_CHANGED');
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
  await expect(externalProviderPort.agents()).rejects.toThrow('EXTERNAL_IDENTITY_CHANGED');
  expect(state.request).toHaveBeenCalledTimes(1);
});

it('bounds a stalled token read and cannot send a task after the deadline', async () => {
  vi.useFakeTimers();
  let release!: (token: string) => void;
  state.token.mockImplementation(
    () =>
      new Promise<string>((resolve) => {
        release = resolve;
      })
  );
  const request = externalProviderPort.create({ agent_id: 'a', query: 'synthetic', idempotency_key: 'key-123456' });
  const rejected = expect(request).rejects.toThrow('EXTERNAL_TASK_TIMEOUT');
  await vi.advanceTimersByTimeAsync(EXTERNAL_REQUEST_TIMEOUT_MS);
  await rejected;
  release('late-token');
  await Promise.resolve();
  expect(state.request).not.toHaveBeenCalled();
});

it('aborts a stalled HTTP request without automatically retrying', async () => {
  vi.useFakeTimers();
  let signal!: AbortSignal;
  state.request.mockImplementation((_url, init) => {
    signal = init.signal;
    return new Promise(() => {});
  });
  const rejected = expect(externalProviderPort.agents()).rejects.toThrow('EXTERNAL_TASK_TIMEOUT');
  await vi.advanceTimersByTimeAsync(EXTERNAL_REQUEST_TIMEOUT_MS);
  await rejected;
  expect(signal.aborted).toBe(true);
  expect(state.request).toHaveBeenCalledTimes(1);
});

it('hosted transport refreshes once with the same formal request', async () => {
  state.request.mockResolvedValueOnce(Response.json({}, { status: 401 })).mockResolvedValueOnce(Response.json({ success: true, data: [] }));
  await expect(hostedTaskPort.create({ agent_id: 'a', requested_version: 'v1', query: 'synthetic', idempotency_key: 'hosted-key-123' })).rejects.toThrow();
  expect(state.request).toHaveBeenCalledTimes(2);
  expect(state.request.mock.calls[0][1].body).toBe(state.request.mock.calls[1][1].body);
  expect(JSON.parse(state.request.mock.calls[0][1].body).kind).toBe('SubmitTask');
});
