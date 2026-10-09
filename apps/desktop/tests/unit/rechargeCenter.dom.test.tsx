import React from 'react';
import { SWRConfig } from 'swr';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ authFetch: vi.fn(), config: vi.fn(), refresh: vi.fn(), t: (key: string) => key }));
vi.mock('@arco-design/web-react', async (importOriginal) => ({ ...(await importOriginal<typeof import('@arco-design/web-react')>()), Message: { error: vi.fn(), success: vi.fn() } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: state.t }) }));
vi.mock('@renderer/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'org-admin', token: 'test-session' }, authFetch: state.authFetch, refresh: state.refresh }) }));
vi.mock('@sudowork/host-bridge/ipcBridge', () => ({ sudoworkServer: { getConfig: { invoke: vi.fn() } } }));
vi.mock('@sudowork/common/sudoworkServer', () => ({ getSudoworkServerBaseUrl: state.config }));
vi.mock('@renderer/components/base/PageWrapper', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
import { CONSUMER_REQUEST_TIMEOUT_MS } from '@sudowork/host-bridge/consumerApi';
import RechargeCenter from '@renderer/pages/settings/recharge';

const pkg = { purchase_amount_usd: '5.00', amount_cny_fen: 3500, bonus_amount_usd: '0.00' };
const renderRecharge = () =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <RechargeCenter />
    </SWRConfig>
  );
const respond = (data: unknown) => new Response(JSON.stringify({ success: true, data }));
beforeEach(() => {
  vi.clearAllMocks();
  state.config.mockResolvedValue('https://moss.example');
  state.authFetch.mockImplementation(async (url: string) => {
    if (url.endsWith('/model-account/access')) return respond({ can_recharge: true });
    if (url.endsWith('/model-account')) return respond({ can_recharge: true, model_balance_usd: '42.00', member: { used_amount_usd: '2.00' } });
    if (url.endsWith('/model-billing/packages')) return respond({ items: [pkg] });
    if (url.includes('/model-billing/orders?page=')) return respond({ items: [], total: 0 });
    throw new Error('Unexpected test endpoint');
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('loads the organization balance, USD packages and orders with authenticated requests', async () => {
  renderRecharge();
  await waitFor(() => expect(screen.getByRole('button', { name: '$5.00 + $0.00 · ¥35.00' })).toBeTruthy());
  expect(screen.getByText('modelBilling.organizationBalance: $42.00')).toBeTruthy();
  await waitFor(() => expect(document.querySelector('.arco-spin-loading')).toBeNull());
  expect(state.authFetch.mock.calls.map(([url]) => new URL(url).pathname)).toEqual(expect.arrayContaining(['/api/v1/model-account', '/api/v1/model-billing/packages', '/api/v1/model-billing/orders']));
});

it('releases a stalled configuration spinner and lets the user retry successfully', async () => {
  vi.useFakeTimers();
  state.config.mockReturnValue(new Promise(() => undefined));
  renderRecharge();
  await act(() => vi.advanceTimersByTimeAsync(CONSUMER_REQUEST_TIMEOUT_MS));
  expect(screen.getByRole('alert').textContent).toContain('Account request timed out');
  expect(state.authFetch).not.toHaveBeenCalled();
  state.config.mockResolvedValue('https://moss.example');
  await act(async () => {
    fireEvent.click(screen.getByText('common.retry'));
  });
  expect(screen.getByRole('button', { name: '$5.00 + $0.00 · ¥35.00' })).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('reports an order-list failure instead of claiming there are no orders', async () => {
  const normal = state.authFetch.getMockImplementation()!;
  state.authFetch.mockImplementation((url: string) => (url.includes('/model-billing/orders?page=') ? Promise.resolve(new Response(JSON.stringify({ success: false, msg: 'Order list unavailable' }), { status: 503 })) : normal(url)));
  renderRecharge();
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Order list unavailable'));
  expect(document.querySelector('.arco-table')).toBeNull();
  state.authFetch.mockImplementation(normal);
  fireEvent.click(screen.getByText('common.retry'));
  await waitFor(() => expect(document.querySelector('.arco-table')).not.toBeNull());
  await waitFor(() => expect(document.querySelector('.arco-spin-loading')).toBeNull());
  expect(screen.queryByRole('alert')).toBeNull();
});

it('offers recharge while the optional Router dashboard is still hanging', async () => {
  const normal = state.authFetch.getMockImplementation()!;
  state.authFetch.mockImplementation((url: string) => (url.endsWith('/model-account') ? new Promise(() => undefined) : normal(url)));
  const view = renderRecharge();
  await screen.findByRole('button', { name: '$5.00 + $0.00 · ¥35.00' });
  expect(screen.getByRole('button', { name: 'modelBilling.createOrder' })).toBeTruthy();
  expect(screen.queryByText(/\$0.00$/)).toBeNull();
  view.unmount();
});

it('shows unavailable balance without blocking payment and recovers on refresh', async () => {
  const normal = state.authFetch.getMockImplementation()!;
  state.authFetch.mockImplementation((url: string) => (url.endsWith('/model-account') ? Promise.resolve(new Response(JSON.stringify({ success: false, msg: 'Router down' }), { status: 503 })) : normal(url)));
  renderRecharge();
  await screen.findByRole('button', { name: 'modelBilling.refreshBalance' });
  expect(screen.getByText('modelBilling.organizationBalance: modelBilling.balanceUnavailable')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'modelBilling.createOrder' })).toBeTruthy();
  state.authFetch.mockImplementation(normal);
  fireEvent.click(screen.getByRole('button', { name: 'modelBilling.refreshBalance' }));
  await screen.findByText('modelBilling.organizationBalance: $42.00');
});

it('denies recharge according to access even if a stale dashboard claims it is allowed', async () => {
  const normal = state.authFetch.getMockImplementation()!;
  state.authFetch.mockImplementation((url: string) => (url.endsWith('/model-account/access') ? Promise.resolve(respond({ can_recharge: false })) : normal(url)));
  renderRecharge();
  await screen.findByText('modelBilling.adminOnly');
  expect(state.authFetch.mock.calls.some(([url]) => url.includes('/model-billing/'))).toBe(false);
});
