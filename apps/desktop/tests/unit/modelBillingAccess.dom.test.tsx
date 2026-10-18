import React from 'react';
import { SWRConfig } from 'swr';
import { MemoryRouter } from 'react-router-dom';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SettingsSider from '@renderer/layouts/components/SettingsSider';

const state = vi.hoisted(() => ({ authFetch: vi.fn(), user: { id: 'admin', token: 'session-a' }, t: (key: string) => key, resolveExtTabName: () => 'Extension' }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: state.t }) }));
vi.mock('@renderer/context/AuthContext', () => ({ useAuth: () => ({ user: state.user, authFetch: state.authFetch, isGuest: false }) }));
vi.mock('@sudowork/common/sudoworkServer', () => ({ getSudoworkServerBaseUrl: async () => 'https://moss.example' }));
vi.mock('@renderer/hooks/useAppMode', () => ({ useAppMode: () => ({ isEnterprise: true }) }));
vi.mock('@renderer/hooks/useExtI18n', () => ({ useExtI18n: () => ({ resolveExtTabName: state.resolveExtTabName }) }));
vi.mock('@renderer/utils/platform', () => ({ isElectronDesktop: () => true, resolveExtensionAssetUrl: (url: string) => url }));
vi.mock('@sudowork/host-bridge/ipcBridge', () => ({ extensions: { getSettingsTabs: { invoke: async () => [{ id: 'test', name: 'Extension' }] }, stateChanged: { on: () => () => undefined } } }));
const respond = (data: unknown) => new Response(JSON.stringify({ success: true, data }));
function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MemoryRouter>{children}</MemoryRouter>
    </SWRConfig>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  state.user = { id: 'admin', token: 'session-a' };
});
afterEach(cleanup);

it('renders the recharge entry from local capability without any Router dashboard request', async () => {
  state.authFetch.mockImplementation(async (url: string) => {
    if (!url.endsWith('/model-account/access')) throw new Error('Dashboard must not gate the sidebar');
    return respond({ can_recharge: true });
  });
  render(<SettingsSider />, { wrapper: Wrapper });
  await screen.findByRole('button', { name: 'modelBilling.recharge' });
  expect(state.authFetch.mock.calls.every(([url]) => url.endsWith('/model-account/access'))).toBe(true);
});

it('hides recharge immediately on identity switch and respects the new member capability', async () => {
  state.authFetch.mockImplementation(async () => respond({ can_recharge: state.user.id === 'admin' }));
  const view = render(<SettingsSider />, { wrapper: Wrapper });
  await screen.findByRole('button', { name: 'modelBilling.recharge' });
  state.user = { id: 'member', token: 'session-b' };
  view.rerender(<SettingsSider />);
  expect(screen.queryByRole('button', { name: 'modelBilling.recharge' })).toBeNull();
  await waitFor(() => expect(state.authFetch).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole('button', { name: 'modelBilling.recharge' })).toBeNull();
});

it('never grants access from a role or failed capability request', async () => {
  state.authFetch.mockResolvedValue(new Response(JSON.stringify({ success: false, msg: 'Forbidden' }), { status: 403 }));
  render(<SettingsSider />, { wrapper: Wrapper });
  await waitFor(() => expect(state.authFetch).toHaveBeenCalled());
  expect(screen.queryByRole('button', { name: 'modelBilling.recharge' })).toBeNull();
});
