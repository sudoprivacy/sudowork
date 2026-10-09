import { afterEach, describe, expect, it, vi } from 'vitest';
import { createModelBillingClient, isPayableOrder, type ModelOrder } from '../../../../packages/renderer/src/pages/settings/model-account/client';

afterEach(() => vi.useRealTimers());

describe('organization model billing client', () => {
  it('preserves USD decimal strings and a stable idempotency key on retries', async () => {
    const fetcher = vi.fn(async (_url: string, _options?: RequestInit) => new Response(JSON.stringify({ success: true, data: { order_no: 'org-order' } })));
    const request = createModelBillingClient('https://moss.test/', fetcher);
    const body = { purchase_amount_usd: '10.00', payment_method: 'ALIPAY' };
    await request('model-billing/orders', 'POST', body, 'same-request');
    await request('model-billing/orders', 'POST', body, 'same-request');
    for (const call of fetcher.mock.calls)
      expect(call).toEqual([
        'https://moss.test/api/v1/model-billing/orders',
        {
          method: 'POST',
          signal: expect.any(AbortSignal),
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'same-request' },
          body: JSON.stringify(body),
        },
      ]);
  });
  it('surfaces permission denial without treating it as a paid order', async () => {
    const request = createModelBillingClient('https://moss.test', async () => new Response(JSON.stringify({ success: false, error: { code: 'FORBIDDEN', message: 'admin required' } }), { status: 403 }));
    await expect(request('model-billing/orders')).rejects.toThrow('admin required');
  });
  it('does not confuse paid with credited', async () => {
    const paid = { payment_status: 'paid', credit_status: 'needs_review' };
    const request = createModelBillingClient('https://moss.test', async () => new Response(JSON.stringify({ success: true, data: paid })));
    expect(await request('model-billing/orders/order/sync', 'POST')).toEqual(paid);
  });
});

it('manual credits cannot become payable even with malformed payment fields', () => {
  expect(isPayableOrder({ source: 'manual', payment_status: 'pending', expires_at: Date.now() + 10000 } as unknown as ModelOrder)).toBe(false);
  expect(isPayableOrder({ source: 'online', payment_status: 'pending', expires_at: 2000 } as ModelOrder, 1000)).toBe(true);
  expect(isPayableOrder({ source: 'online', payment_status: 'pending', expires_at: 2000 } as ModelOrder, 2000)).toBe(false);
});

it.each(['configuration', 'authentication', 'body'])('times out stalled billing %s without sending a late request', async (stage) => {
  vi.useFakeTimers();
  let finish!: (value: unknown) => void;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const resolveBaseUrl = vi.fn(async () => 'https://moss.test');
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: [] })));
  if (stage === 'configuration') resolveBaseUrl.mockReturnValue(pending as Promise<string>);
  if (stage === 'authentication') fetcher.mockReturnValue(pending);
  if (stage === 'body') fetcher.mockResolvedValue({ ok: true, json: () => pending });
  const request = createModelBillingClient(resolveBaseUrl, fetcher);
  const assertion = expect(request('model-billing/orders', 'POST', {}, 'stable')).rejects.toMatchObject({ name: 'TimeoutError' });
  await vi.advanceTimersByTimeAsync(15_000);
  await assertion;
  finish(stage === 'configuration' ? 'https://late.test' : stage === 'body' ? { success: true, data: [] } : new Response('{}'));
  await vi.advanceTimersByTimeAsync(1);
  if (stage === 'configuration') expect(fetcher).not.toHaveBeenCalled();
  else expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
