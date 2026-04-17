/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// --- Mock declarations via vi.hoisted (Vitest 4 pattern) ---
const { mockEnsureValidToken, mockForceRefreshToken, mockSecretGet, mockSecretPut, mockConfigStorageGet, mockConfigStorageSet, mockFetch } =
  vi.hoisted(() => ({
    mockEnsureValidToken: vi.fn(),
    mockForceRefreshToken: vi.fn(),
    mockSecretGet: vi.fn(),
    mockSecretPut: vi.fn(),
    mockConfigStorageGet: vi.fn(),
    mockConfigStorageSet: vi.fn(),
    mockFetch: vi.fn(),
  }));

// --- Module mocks ---
vi.mock('@/renderer/context/AuthContext', () => ({
  useAuth: () => ({
    ensureValidToken: mockEnsureValidToken,
    forceRefreshToken: mockForceRefreshToken,
  }),
}));

vi.mock('@/common/ipcBridge', () => ({
  secret: {
    get: { invoke: (...args: unknown[]) => mockSecretGet(...args) },
    put: { invoke: (...args: unknown[]) => mockSecretPut(...args) },
  },
}));

vi.mock('@/common/storage', () => ({
  ConfigStorage: {
    get: (...args: unknown[]) => mockConfigStorageGet(...args),
    set: (...args: unknown[]) => mockConfigStorageSet(...args),
  },
}));

// Mock global fetch
vi.stubGlobal('fetch', mockFetch);

// Import the hook after mocks are set up
import { useTenantConfigItems } from '@/renderer/components/SettingsModal/contents/secrets/useTenantConfigItems';

const defaultApiResponse = {
  success: true,
  data: [
    {
      id: 1,
      name: 'model_config',
      entries: [
        { id: 10, config_key: 'max_tokens', config_desc: '最大token数' },
        { id: 11, config_key: 'temperature', config_desc: '温度参数' },
      ],
    },
    {
      id: 2,
      name: 'prompt_config',
      entries: [{ id: 20, config_key: 'system_prompt', config_desc: '系统提示词' }],
    },
  ],
};

function mockApiSuccess(data = defaultApiResponse) {
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
  });
}

describe('useTenantConfigItems', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockEnsureValidToken.mockResolvedValue('test-access-token');
    mockForceRefreshToken.mockResolvedValue('new-access-token');
    mockSecretGet.mockResolvedValue({ success: true, data: null });
    mockSecretPut.mockResolvedValue({ success: true });
    mockConfigStorageGet.mockResolvedValue(undefined);
    mockConfigStorageSet.mockResolvedValue(undefined);

    mockApiSuccess();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should fetch config items on mount', async () => {
    const { result } = renderHook(() => useTenantConfigItems());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.configItems).toHaveLength(2);
    expect(result.current.configItems[0].name).toBe('model_config');
    expect(result.current.configItems[0].entries).toHaveLength(2);
    expect(result.current.configItems[1].name).toBe('prompt_config');
    expect(result.current.configItems[1].entries).toHaveLength(1);
  });

  it('should call API with Bearer token', async () => {
    const { result } = renderHook(() => useTenantConfigItems());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockEnsureValidToken).toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/config/items'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-access-token',
        }),
      }),
    );
  });

  it('should load values from Nexus for each entry', async () => {
    mockSecretGet.mockImplementation(({ namespace, key }: { namespace: string; key: string }) => {
      if (namespace === 'tenant:1' && key === 'max_tokens') return Promise.resolve({ success: true, data: '4096' });
      if (namespace === 'tenant:1' && key === 'temperature') return Promise.resolve({ success: true, data: '0.7' });
      if (namespace === 'tenant:2' && key === 'system_prompt') return Promise.resolve({ success: true, data: 'You are helpful' });
      return Promise.resolve({ success: true, data: null });
    });

    const { result } = renderHook(() => useTenantConfigItems());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.valuesMap[1]).toEqual({
      max_tokens: '4096',
      temperature: '0.7',
    });
    expect(result.current.valuesMap[2]).toEqual({
      system_prompt: 'You are helpful',
    });
  });

  it('should handle empty API response', async () => {
    mockApiSuccess({ success: true, data: [] });

    const { result } = renderHook(() => useTenantConfigItems());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.configItems).toHaveLength(0);
    expect(result.current.error).toBeNull();
  });

  it('should handle no token (not logged in)', async () => {
    mockEnsureValidToken.mockResolvedValue(null);

    const { result } = renderHook(() => useTenantConfigItems());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.configItems).toHaveLength(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should retry with refreshed token on 401', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ success: false, msg: '未授权' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            success: true,
            data: [
              {
                id: 1,
                name: 'model_config',
                entries: [{ id: 10, config_key: 'max_tokens', config_desc: '最大token数' }],
              },
            ],
          }),
      });

    const { result } = renderHook(() => useTenantConfigItems());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockForceRefreshToken).toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.current.configItems).toHaveLength(1);
  });

  it('should handle API failure gracefully', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useTenantConfigItems());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Network error');
    expect(result.current.configItems).toHaveLength(0);
  });

  it('should handle non-ok HTTP response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: () => Promise.resolve({ success: false, msg: 'Server error' }),
    });

    const { result } = renderHook(() => useTenantConfigItems());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('HTTP 500');
  });

  it('should handle Nexus read failure silently', async () => {
    mockSecretGet.mockRejectedValue(new Error('Nexus error'));

    const { result } = renderHook(() => useTenantConfigItems());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Should still render config items, valuesMap entry exists but is empty since Nexus reads failed
    expect(result.current.configItems).toHaveLength(2);
    expect(result.current.valuesMap[1]).toBeDefined();
  });

  it('should save item values to Nexus', async () => {
    const { result } = renderHook(() => useTenantConfigItems());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const success = await act(async () => {
      return result.current.saveItem(1, result.current.configItems[0].entries, {
        max_tokens: '8192',
        temperature: '0.5',
      });
    });

    expect(success).toBe(true);
    expect(mockSecretPut).toHaveBeenCalledTimes(2);
    expect(mockSecretPut).toHaveBeenCalledWith({
      namespace: 'tenant:1',
      key: 'max_tokens',
      value: '8192',
      description: '最大token数',
    });
    expect(mockSecretPut).toHaveBeenCalledWith({
      namespace: 'tenant:1',
      key: 'temperature',
      value: '0.5',
      description: '温度参数',
    });
  });

  it('should return false when save partially fails', async () => {
    mockSecretPut.mockImplementation(({ key }: { key: string }) => {
      if (key === 'max_tokens') return Promise.resolve({ success: true });
      return Promise.resolve({ success: false });
    });

    const { result } = renderHook(() => useTenantConfigItems());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const success = await act(async () => {
      return result.current.saveItem(1, result.current.configItems[0].entries, {
        max_tokens: '8192',
        temperature: '0.5',
      });
    });

    expect(success).toBe(false);
  });

  it('should handle null config_desc by using config_key as description', async () => {
    mockApiSuccess({
      success: true,
      data: [
        {
          id: 3,
          name: 'raw_config',
          entries: [{ id: 30, config_key: 'raw_key', config_desc: null }],
        },
      ],
    });

    const { result } = renderHook(() => useTenantConfigItems());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.saveItem(3, result.current.configItems[0].entries, { raw_key: 'raw_value' });
    });

    expect(mockSecretPut).toHaveBeenCalledWith({
      namespace: 'tenant:3',
      key: 'raw_key',
      value: 'raw_value',
      description: 'raw_key',
    });
  });

  it('should toggle enabled state and persist to ConfigStorage', async () => {
    const { result } = renderHook(() => useTenantConfigItems());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.enabledMap[1]).toBe(false);

    await act(async () => {
      await result.current.toggleEnabled(1, true);
    });

    expect(result.current.enabledMap[1]).toBe(true);
    expect(mockConfigStorageSet).toHaveBeenCalledWith('settings.tenant.enabled', expect.objectContaining({ 1: true }));
  });

  it('should load enabled state from ConfigStorage', async () => {
    mockConfigStorageGet.mockResolvedValue({ 1: true, 2: false });

    const { result } = renderHook(() => useTenantConfigItems());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.enabledMap[1]).toBe(true);
    expect(result.current.enabledMap[2]).toBe(false);
  });

  it('should track savingId correctly during save', async () => {
    const { result } = renderHook(() => useTenantConfigItems());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Before save, savingId should be null
    expect(result.current.savingId).toBeNull();

    // Start save
    const savePromise = result.current.saveItem(1, result.current.configItems[0].entries, {
      max_tokens: '8192',
      temperature: '0.5',
    });

    // After save completes, savingId should be null
    await savePromise;

    expect(result.current.savingId).toBeNull();
  });
});
