import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: {} });
  return { get: vi.fn(), set: vi.fn(), reporting: vi.fn(), prepareRuntime: vi.fn(), modelPreference: vi.fn() };
});
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@sudowork/common/storage', () => ({ ConfigStorage: { get: state.get, set: state.set } }));
vi.mock('@sudowork/host-bridge/desktopLoginSetup', () => ({
  fetchAndCacheCredentials: state.reporting,
  syncScodeGuidModelPreference: state.modelPreference,
  prepareDesktopLogin: vi.fn(),
  applyLoginImageModel: vi.fn(),
}));
vi.mock('@sudowork/host-bridge/ipcBridge', () => ({
  eeclaw: {
    prepareLocalRuntime: { invoke: state.prepareRuntime },
    tokenRefreshed: { on: () => () => undefined },
    authRequired: { on: () => () => undefined },
  },
}));
import { AuthProvider, useAuth } from '@renderer/context/AuthContext';

function SessionState() {
  const { status, ready, user } = useAuth();
  return <div>{`${status}:${ready}:${user?.id || ''}`}</div>;
}

beforeEach(() => {
  vi.resetAllMocks();
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
  Object.defineProperty(window, 'localStorage', { configurable: true, value: storage });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  localStorage.setItem(
    'eeclaw_auth_v1',
    JSON.stringify({
      access_token: 'test-session',
      refresh_token: 'test-refresh',
      expires_at: Date.now() + 3_600_000,
      device_id: 'device',
      session_type: 'phone',
      user: { id: 'user', nickname: 'User', role: 'USER', localModeAvailable: true, execution: { isLocalAllowed: true, isRemoteAllowed: true, defaultTarget: 'local' } },
    })
  );
  state.get.mockResolvedValue(undefined);
  state.set.mockResolvedValue(undefined);
  state.prepareRuntime.mockResolvedValue({ success: true, data: { execution: { isLocalAllowed: true, isRemoteAllowed: true, defaultTarget: 'local' }, localRuntime: { userId: 'user', organizationId: 'org', status: 'ready' } } });
  state.modelPreference.mockResolvedValue(undefined);
});
afterEach(cleanup);

it('restores a managed desktop session after login reload even when reporting initialization never replies', async () => {
  state.reporting.mockReturnValue(new Promise<void>(() => undefined));
  render(
    <AuthProvider>
      <SessionState />
    </AuthProvider>
  );
  await waitFor(() => expect(screen.getByText('authenticated:true:user')).toBeTruthy());
  expect(state.prepareRuntime).toHaveBeenCalledOnce();
  expect(state.reporting).toHaveBeenCalledWith('test-session');
});
