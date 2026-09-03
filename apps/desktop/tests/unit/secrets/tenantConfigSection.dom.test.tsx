/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const { mockEnsureValidToken, mockForceRefreshToken, mockSecretGet, mockSecretPut, mockConfigStorageGet, mockConfigStorageSet, mockAuthProxyEnabledStateChangedOn, mockAuthProxyRefreshRules, mockFetch } = vi.hoisted(() => ({
  mockEnsureValidToken: vi.fn(),
  mockForceRefreshToken: vi.fn(),
  mockSecretGet: vi.fn(),
  mockSecretPut: vi.fn(),
  mockConfigStorageGet: vi.fn(),
  mockConfigStorageSet: vi.fn(),
  mockAuthProxyEnabledStateChangedOn: vi.fn(),
  mockAuthProxyRefreshRules: vi.fn(),
  mockFetch: vi.fn(),
}));

vi.mock('@/renderer/context/AuthContext', () => ({
  useAuth: () => ({
    ensureValidToken: mockEnsureValidToken,
    forceRefreshToken: mockForceRefreshToken,
  }),
}));

vi.mock('@sudowork/host-bridge/ipcBridge', () => ({
  secret: {
    get: { invoke: (...args: unknown[]) => mockSecretGet(...args) },
    put: { invoke: (...args: unknown[]) => mockSecretPut(...args) },
  },
  authProxy: {
    enabledStateChanged: { on: (...args: unknown[]) => mockAuthProxyEnabledStateChangedOn(...args) },
    refreshRules: { invoke: (...args: unknown[]) => mockAuthProxyRefreshRules(...args) },
  },
}));

vi.mock('@/common/storage', () => ({
  ConfigStorage: {
    get: (...args: unknown[]) => mockConfigStorageGet(...args),
    set: (...args: unknown[]) => mockConfigStorageSet(...args),
  },
}));

vi.stubGlobal('fetch', mockFetch);

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, defaultValue?: string) => defaultValue || key }),
}));

vi.mock('@arco-design/web-react', async () => {
  const actual = await vi.importActual<typeof import('@arco-design/web-react')>('@arco-design/web-react');
  return {
    ...actual,
    Spin: () => <div data-testid='spin'>Loading...</div>,
    Button: ({ children, ...props }: any) => (
      <button data-testid='button' {...props}>
        {children}
      </button>
    ),
  };
});

vi.mock('@/renderer/pages/settings/channels/components/TenantConfigItemGroup', () => ({
  default: ({ configItem }: { configItem: { id: number; name: string } }) => <div data-testid={`config-item-${configItem.id}`}>{configItem.name}</div>,
}));

import TenantConfigSection from '@/renderer/pages/settings/channels/components/TenantConfigSection';

const defaultApiResponse = {
  success: true,
  data: [
    {
      id: 1,
      name: 'model_config',
      pinyin: 'model_config',
      entries: [{ id: 10, config_key: 'max_tokens', config_desc: '最大token数', name: '最大Token数', required: 1 }],
    },
    {
      id: 2,
      name: 'prompt_config',
      pinyin: 'prompt_config',
      entries: [{ id: 20, config_key: 'system_prompt', config_desc: '系统提示词', name: '系统提示词', required: 1 }],
    },
  ],
};

describe('TenantConfigSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockEnsureValidToken.mockResolvedValue('test-token');
    mockForceRefreshToken.mockResolvedValue('new-token');
    mockSecretGet.mockResolvedValue({ success: true, data: null });
    mockSecretPut.mockResolvedValue({ success: true });
    mockConfigStorageGet.mockResolvedValue(undefined);
    mockConfigStorageSet.mockResolvedValue(undefined);
    mockAuthProxyEnabledStateChangedOn.mockReturnValue(vi.fn());
    mockAuthProxyRefreshRules.mockResolvedValue({ success: true });
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(defaultApiResponse),
    });
  });

  it('should show loading spinner initially', () => {
    render(<TenantConfigSection />);
    expect(screen.getByTestId('spin')).toBeInTheDocument();
  });

  it('should render config items after loading', async () => {
    render(<TenantConfigSection />);

    await screen.findByTestId('config-item-1');
    await screen.findByTestId('config-item-2');

    expect(screen.getByText('model_config')).toBeInTheDocument();
    expect(screen.getByText('prompt_config')).toBeInTheDocument();
  });

  it('should not render anything when API returns empty array', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: [] }),
    });

    render(<TenantConfigSection />);

    await waitFor(() => {
      expect(screen.queryByTestId('config-item-1')).not.toBeInTheDocument();
    });
    expect(screen.queryByTestId('spin')).not.toBeInTheDocument();
  });

  it('should not render anything when not logged in', async () => {
    mockEnsureValidToken.mockResolvedValue(null);

    render(<TenantConfigSection />);

    await waitFor(() => {
      expect(screen.queryByTestId('config-item-1')).not.toBeInTheDocument();
    });
    expect(screen.queryByTestId('spin')).not.toBeInTheDocument();
  });

  it('should show error state with retry button on API failure', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    render(<TenantConfigSection />);

    await screen.findByText('Network error');
    const retryButton = screen.getByText('重试');
    expect(retryButton).toBeInTheDocument();
  });

  it('should show error state on HTTP error', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ success: false }),
    });

    render(<TenantConfigSection />);

    await screen.findByText('HTTP 500');
  });

  it('should pass refreshTrigger to trigger re-fetch', async () => {
    const { rerender } = render(<TenantConfigSection refreshTrigger={0} />);

    await screen.findByTestId('config-item-1');

    const callCountAfterMount = mockFetch.mock.calls.length;

    rerender(<TenantConfigSection refreshTrigger={1} />);

    await screen.findByTestId('config-item-1');

    expect(mockFetch.mock.calls.length).toBeGreaterThan(callCountAfterMount);
  });

  it('should show correct number of config item groups', async () => {
    render(<TenantConfigSection />);

    await screen.findByTestId('config-item-1');
    await screen.findByTestId('config-item-2');

    expect(screen.getAllByTestId(/config-item-\d/)).toHaveLength(2);
  });

  it('should filter out config items with null pinyin', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          success: true,
          data: [
            { id: 1, name: 'valid_item', pinyin: 'valid_item', entries: [{ id: 10, config_key: 'key1', config_desc: 'desc', name: 'Key1', required: 1 }] },
            { id: 2, name: 'invalid_item', pinyin: null, entries: [{ id: 20, config_key: 'key2', config_desc: 'desc', name: 'Key2', required: 1 }] },
          ],
        }),
    });

    render(<TenantConfigSection />);

    await screen.findByTestId('config-item-1');
    expect(screen.getByText('valid_item')).toBeInTheDocument();
    expect(screen.queryByTestId('config-item-2')).not.toBeInTheDocument();
    expect(screen.queryByText('invalid_item')).not.toBeInTheDocument();
  });
});
