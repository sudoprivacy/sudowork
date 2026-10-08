import { describe, expect, it, vi } from 'vitest';
import { createModelBillingClient, isPayableOrder, type ModelOrder } from '../../../../packages/renderer/src/pages/settings/model-account/client';

describe('organization model billing client', () => {
  it('preserves USD decimal strings and a stable idempotency key on retries', async () => {
    const fetcher = vi.fn(async (_url: string, _options?: RequestInit) => new Response(JSON.stringify({ success: true, data: { order_no: 'org-order' } })));
    const request = createModelBillingClient('https://moss.test/', fetcher);
    const body = { purchase_amount_usd: '10.00', payment_method: 'ALIPAY' };
    await request('model-billing/orders', 'POST', body, 'same-request');
    await request('model-billing/orders', 'POST', body, 'same-request');
    expect(fetcher.mock.calls[0]).toEqual(fetcher.mock.calls[1]);
    expect(fetcher.mock.calls[0]).toEqual([
      'https://moss.test/api/v1/model-billing/orders',
      {
        method: 'POST',
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
