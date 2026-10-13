import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RechargeCenter from '@renderer/pages/settings/recharge';

const billing = vi.hoisted(() => ({
  access: { can_recharge: false },
  account: { model_balance_usd: '20.00' },
  request: vi.fn(),
  refresh: vi.fn(async () => undefined),
  refreshAccess: vi.fn(async () => undefined),
  t: (key: string) => key,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: billing.t }) }));
vi.mock('@renderer/pages/settings/model-account/useModelAccount', () => ({
  useModelAccount: () => ({ ...billing, isLoading: false, error: undefined, isAccessLoading: false, accessError: undefined }),
}));
vi.mock('@renderer/components/base/PageWrapper', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  billing.access.can_recharge = false;
  billing.refresh.mockResolvedValue(undefined);
});

describe('organization recharge page', () => {
  it('denies direct navigation for members without requesting payment data', () => {
    render(<RechargeCenter />);
    expect(screen.getByText('modelBilling.adminOnly')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'modelBilling.createOrder' })).toBeNull();
    expect(billing.request).not.toHaveBeenCalled();
  });

  it('preserves the USD order and distinguishes a verified payment from successful credit', async () => {
    billing.access.can_recharge = true;
    const order = {
      order_no: 'org-test-order',
      purchase_amount_usd: '10.00',
      bonus_amount_usd: '1.00',
      amount_cny_fen: 7300,
      payment_method: 'ALIPAY',
      payment_status: 'pending',
      credit_status: 'pending',
      created_at: Date.now(),
      expires_at: Date.now() + 1_800_000,
    };
    billing.request.mockImplementation(async (path: string, method = 'GET') => {
      if (path === 'model-billing/packages') return { items: [] };
      if (path.startsWith('model-billing/orders?page=')) return { items: [], total: 0 };
      if (path === 'model-billing/orders' && method === 'POST') return order;
      if (path.endsWith('/pay')) return { qr_code_url: 'https://payment.test/order', order: { ...order, payment_status: 'paying' } };
      if (path.endsWith('/sync')) return { ...order, payment_status: 'paid', credit_status: 'needs_review' };
      throw new Error(`Unexpected request ${path}`);
    });
    render(<RechargeCenter />);
    fireEvent.click(screen.getByRole('button', { name: 'modelBilling.createOrder' }));
    await screen.findByRole('button', { name: 'modelBilling.refresh' });
    expect(billing.request).toHaveBeenCalledWith('model-billing/orders', 'POST', { purchase_amount_usd: '10.00', payment_method: 'ALIPAY' }, expect.any(String));
    fireEvent.click(screen.getByRole('button', { name: 'modelBilling.refresh' }));
    await screen.findByText('modelBilling.creditStatuses.needs_review');
    expect(screen.queryByText('modelBilling.creditStatuses.credited')).toBeNull();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'modelBilling.cancel' })).toBeNull());
  });
});

it('displays manual credits without CNY payment or a continue-payment action', async () => {
  billing.access.can_recharge = true;
  const manual = {
    source: 'manual',
    order_no: 'manual-one',
    purchase_amount_usd: '11.00',
    bonus_amount_usd: '0.00',
    amount_cny_fen: null,
    payment_method: null,
    payment_status: 'not_required',
    credit_status: 'needs_review',
    created_at: Date.now(),
    expires_at: null,
    payer_username: 'operator',
    reason: 'Verified correction',
  };
  billing.request.mockImplementation(async (path: string) => (path === 'model-billing/packages' ? { items: [] } : { items: [manual], total: 1 }));
  render(<RechargeCenter />);
  await screen.findByText('manual-one');
  expect(screen.getByText('modelBilling.manualCredit')).toBeTruthy();
  expect(screen.getByText('modelBilling.noPayment')).toBeTruthy();
  expect(screen.getByText('modelBilling.creditStatuses.needs_review')).toBeTruthy();
  expect(screen.getByText('operator')).toBeTruthy();
  expect(screen.getByText('Verified correction')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'modelBilling.continuePay' })).toBeNull();
});

it('keeps QR and verified payment visible when optional records and balance refresh fail', async () => {
  billing.access.can_recharge = true;
  billing.refresh.mockRejectedValue(new Error('Balance upstream unavailable'));
  let isPaymentCreated = false;
  const order = { order_no: 'refresh-failure', purchase_amount_usd: '10.00', bonus_amount_usd: '0.00', amount_cny_fen: 7300, payment_method: 'ALIPAY', payment_status: 'paying', credit_status: 'pending', expires_at: Date.now() + 1_800_000 };
  billing.request.mockImplementation(async (path: string) => {
    if (path === 'model-billing/packages') return { items: [] };
    if (path.includes('orders?page=')) {
      if (isPaymentCreated) throw new Error('Order list unavailable');
      return { items: [], total: 0 };
    }
    if (path === 'model-billing/orders') return order;
    if (path.endsWith('/pay')) {
      isPaymentCreated = true;
      return { qr_code_url: 'https://payment.test/refresh', order };
    }
    if (path.endsWith('/sync')) return { ...order, payment_status: 'paid', credit_status: 'credited' };
    throw new Error(path);
  });
  render(<RechargeCenter />);
  await waitFor(() => expect(billing.request).toHaveBeenCalledWith('model-billing/packages'));
  fireEvent.click(screen.getByRole('button', { name: 'modelBilling.createOrder' }));
  await screen.findByRole('button', { name: 'modelBilling.refresh' });
  await screen.findByText('Order list unavailable');
  expect(screen.queryByText('Balance upstream unavailable')).toBeNull();
  expect(document.querySelector('svg')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'modelBilling.refresh' }));
  await screen.findByText('modelBilling.creditStatuses.credited');
  expect(screen.queryByText('Balance upstream unavailable')).toBeNull();
});
