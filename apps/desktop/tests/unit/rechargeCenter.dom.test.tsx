import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ authFetch: vi.fn(), config: vi.fn(), refresh: vi.fn(), t: (key: string) => key }));
vi.mock('@arco-design/web-react', async (importOriginal) => ({ ...(await importOriginal<typeof import('@arco-design/web-react')>()), Message: { error: vi.fn(), success: vi.fn() } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: state.t }) }));
vi.mock('@renderer/context/AuthContext', () => ({ useAuth: () => ({ user: { token: 'test-session' }, authFetch: state.authFetch, refresh: state.refresh }) }));
vi.mock('@sudowork/host-bridge/ipcBridge', () => ({ sudoworkServer: { getConfig: { invoke: state.config } } }));
vi.mock('@renderer/components/base/PageWrapper', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('@renderer/pages/settings/recharge/components/CreditApplicationPanel', () => ({ default: () => <div>applications</div> }));
import { CONSUMER_REQUEST_TIMEOUT_MS } from '@sudowork/host-bridge/consumerApi';
import RechargeCenter from '@renderer/pages/settings/recharge';

const pkg = { amount: 5, amount_cny: 35, points: 500, bonus: 0, description: 'Starter package', exchange_rate: 7 };
const respond = (data: unknown) => new Response(JSON.stringify({ success: true, data }));
beforeEach(() => {
  vi.clearAllMocks();
  state.config.mockResolvedValue({ baseUrl: 'https://moss.example' });
  state.authFetch.mockImplementation(async (url: string) => {
    if (url.endsWith('/system-config')) return respond({ recharge_mode: 'pay' });
    if (url.endsWith('/user/dashboard')) return respond({ points: { remaining: 42, used: 2, bonus: 1 } });
    if (url.endsWith('/recharge/packages')) return respond([pkg]);
    if (url.includes('/recharge/list')) return respond({ list: [] });
    throw new Error('Unexpected test endpoint');
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('loads points, packages and orders with the same authenticated request path', async () => {
  render(<RechargeCenter />);
  await waitFor(() => expect(screen.getByText('Starter package')).toBeTruthy());
  expect(screen.getByText('42')).toBeTruthy();
  expect(screen.getByText('settings.orders.noOrders')).toBeTruthy();
  expect(document.querySelector('.arco-spin-loading')).toBeNull();
  expect(state.authFetch.mock.calls.map(([url]) => new URL(url).pathname)).toEqual(expect.arrayContaining(['/api/v1/user/dashboard', '/api/v1/recharge/packages', '/api/v1/recharge/list']));
});

it('releases a stalled configuration spinner and lets the user retry successfully', async () => {
  vi.useFakeTimers();
  state.config.mockReturnValue(new Promise(() => undefined));
  render(<RechargeCenter />);
  await act(() => vi.advanceTimersByTimeAsync(CONSUMER_REQUEST_TIMEOUT_MS));
  expect(screen.getByRole('alert').textContent).toContain('settings.recharge.loadFailed');
  expect(state.authFetch).not.toHaveBeenCalled();
  state.config.mockResolvedValue({ baseUrl: 'https://moss.example' });
  await act(async () => {
    fireEvent.click(screen.getByText('common.retry'));
  });
  expect(screen.getByText('Starter package')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('reports an order-list failure instead of claiming there are no orders', async () => {
  const normal = state.authFetch.getMockImplementation()!;
  state.authFetch.mockImplementation((url: string) => (url.includes('/recharge/list') ? Promise.resolve(new Response('{}', { status: 503 })) : normal(url)));
  render(<RechargeCenter />);
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('settings.orders.loadFailed'));
  expect(screen.queryByText('settings.orders.noOrders')).toBeNull();
  state.authFetch.mockImplementation(normal);
  fireEvent.click(screen.getByText('common.retry'));
  await waitFor(() => expect(screen.getByText('settings.orders.noOrders')).toBeTruthy());
});
