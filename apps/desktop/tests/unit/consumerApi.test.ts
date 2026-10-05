import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ config: vi.fn() }));
vi.mock('@sudowork/host-bridge/ipcBridge', () => ({ sudoworkServer: { getConfig: { invoke: state.config } } }));
import { CONSUMER_REQUEST_TIMEOUT_MS, requestConsumerApi } from '@sudowork/host-bridge/consumerApi';

beforeEach(() => {
  vi.clearAllMocks();
  state.config.mockResolvedValue({ baseUrl: 'https://moss.example' });
});
afterEach(() => vi.useRealTimers());

describe.each(['web', 'desktop'])('%s account requests', (host) => {
  it('uses the host address and authenticated transport for reads and order actions', async () => {
    const origin = host === 'web' ? 'https://web.example' : 'https://moss.example';
    state.config.mockResolvedValue({ baseUrl: origin });
    const authFetch = vi.fn(async () => new Response(JSON.stringify({ success: true, data: [] })));
    for (const path of ['/api/v1/user/dashboard', '/api/v1/recharge/packages', '/api/v1/recharge/list?page=1', '/api/v1/recharge/query/order']) {
      expect(await requestConsumerApi(authFetch, path)).toEqual({ success: true, data: [] });
      expect(authFetch).toHaveBeenLastCalledWith(`${origin}${path}`, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    }
    for (const path of ['/api/v1/recharge/create', '/api/v1/recharge/pay', '/api/v1/recharge/cancel/order']) {
      await requestConsumerApi(authFetch, path, { method: 'POST', body: '{"amount":5}' });
      expect(authFetch).toHaveBeenLastCalledWith(`${origin}${path}`, expect.objectContaining({ method: 'POST', body: '{"amount":5}' }));
    }
  });
});

it.each(['configuration', 'authentication', 'body'])('bounds a stalled %s and ignores its late result', async (stage) => {
  vi.useFakeTimers();
  let finish!: (value: unknown) => void;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const authFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: [] })));
  if (stage === 'configuration') state.config.mockReturnValue(pending);
  if (stage === 'authentication') authFetch.mockReturnValue(pending);
  if (stage === 'body') authFetch.mockResolvedValue({ ok: true, json: () => pending });
  const result = requestConsumerApi(authFetch, '/api/v1/recharge/packages');
  const assertion = expect(result).rejects.toMatchObject({ name: 'TimeoutError' });
  await vi.advanceTimersByTimeAsync(CONSUMER_REQUEST_TIMEOUT_MS);
  await assertion;
  finish(stage === 'configuration' ? { baseUrl: 'https://late.example' } : stage === 'body' ? { success: true, data: [] } : new Response('{}'));
  await vi.advanceTimersByTimeAsync(1);
  if (stage === 'configuration') expect(authFetch).not.toHaveBeenCalled();
  else expect(authFetch.mock.calls[0][1].signal.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it('supports cancellation before a payment request is sent', async () => {
  const controller = new AbortController();
  controller.abort();
  const authFetch = vi.fn();
  await expect(requestConsumerApi(authFetch, '/api/v1/recharge/pay', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  expect(authFetch).not.toHaveBeenCalled();
});

it.each([new Response('{}', { status: 503 }), new Response('<html>error</html>'), new Response('{"unexpected":true}')])('rejects an HTTP or malformed response instead of displaying empty data', async (response) => {
  await expect(requestConsumerApi(vi.fn().mockResolvedValue(response), '/api/v1/recharge/packages')).rejects.toBeDefined();
});
