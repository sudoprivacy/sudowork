/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  applyRemoteConfig: vi.fn(),
  resetPolicyConfirmation: vi.fn(),
  verifyServer: vi.fn(),
  configSet: vi.fn(),
}));

vi.mock('@/renderer/context/AuthContext', () => ({
  useAuth: () => ({ status: 'authenticated', user: {}, ensureValidToken: vi.fn() }),
}));
vi.mock('@/renderer/hooks/useAppMode', () => ({
  useAppMode: () => ({ isEnterprise: true }),
}));
vi.mock('@/renderer/stores/useTenantStore', () => ({
  useTenantStore: (selector: (state: unknown) => unknown) => selector({ applyRemoteConfig: mocks.applyRemoteConfig, resetPolicyConfirmation: mocks.resetPolicyConfirmation }),
}));
vi.mock('@/common/storage', () => ({
  ConfigStorage: {
    get: vi.fn().mockResolvedValue('https://moss.example.com'),
    set: mocks.configSet,
  },
}));
vi.mock('@/common', () => ({
  ipcBridge: {
    eeclaw: { verifyServer: { invoke: mocks.verifyServer } },
    sudoworkServer: { getConfig: { invoke: vi.fn() } },
  },
}));
vi.mock('@/common/sudoworkServer', () => ({ getSudoworkServerBaseUrl: vi.fn() }));

import TenantConfigSync from '@/renderer/components/TenantConfigSync';

describe('TenantConfigSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.applyRemoteConfig.mockReturnValue({ companyName: 'Remote Company' });
  });

  it('成功获取企业租户配置后统一更新 Store', async () => {
    const remote = { app_name: 'Remote App', client_cron_enabled: false };
    mocks.verifyServer.mockResolvedValue({ success: true, data: remote });

    const view = render(<TenantConfigSync />);

    await waitFor(() => expect(mocks.applyRemoteConfig).toHaveBeenCalledWith(remote));
    expect(mocks.configSet).toHaveBeenCalledWith('eeclaw.tenantName', 'Remote Company');
    view.unmount();
  });

  it('请求失败时不修改 Store', async () => {
    mocks.verifyServer.mockResolvedValue({ success: false });

    const view = render(<TenantConfigSync />);

    await waitFor(() => expect(mocks.verifyServer).toHaveBeenCalled());
    expect(mocks.applyRemoteConfig).not.toHaveBeenCalled();
    view.unmount();
  });
});
