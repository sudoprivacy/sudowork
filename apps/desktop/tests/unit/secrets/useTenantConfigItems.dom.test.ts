/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// --- Mock declarations via vi.hoisted (Vitest 4 pattern) ---
const { mockEnsureValidToken, mockForceRefreshToken, mockSecretGet, mockSecretPut, mockSecretDelete, mockSecretRestore, mockConfigStorageGet, mockConfigStorageSet, mockAuthProxyEnabledStateChangedOn, mockAuthProxyRefreshRules, mockFetch } = vi.hoisted(() => ({
  mockEnsureValidToken: vi.fn(),
  mockForceRefreshToken: vi.fn(),
  mockSecretGet: vi.fn(),
  mockSecretPut: vi.fn(),
  mockSecretDelete: vi.fn(),
  mockSecretRestore: vi.fn(),
  mockConfigStorageGet: vi.fn(),
  mockConfigStorageSet: vi.fn(),
  mockAuthProxyEnabledStateChangedOn: vi.fn(),
  mockAuthProxyRefreshRules: vi.fn(),
  mockFetch: vi.fn(),
}));

// --- Module mocks ---
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
    delete: { invoke: (...args: unknown[]) => mockSecretDelete(...args) },
    restore: { invoke: (...args: unknown[]) => mockSecretRestore(...args) },
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

// Mock global fetch
vi.stubGlobal('fetch', mockFetch);

// Import the hook after mocks are set up
import { useTenantConfigItems } from '@/renderer/pages/settings/channels/hooks/useTenantConfigItems';

const defaultApiResponse = {
  success: true,
  data: [
    {
      id: 1,
      name: 'model_config',
      pinyin: 'model_config',
      entries: [
        { id: 10, config_key: 'max_tokens', config_desc: '最大token数', name: '最大Token数', required: 1 },
        { id: 11, config_key: 'temperature', config_desc: '温度参数', name: '温度参数', required: 0 },
      ],
    },
    {
      id: 2,
      name: 'prompt_config',
      pinyin: 'prompt_config',
      entries: [{ id: 20, config_key: 'system_prompt', config_desc: '系统提示词', name: '系统提示词', required: 1 }],
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
    mockSecretDelete.mockResolvedValue({ success: true, data: true });
    mockSecretRestore.mockResolvedValue({ success: true, data: true });
    mockConfigStorageGet.mockResolvedValue(undefined);
    mockConfigStorageSet.mockResolvedValue(undefined);
    mockAuthProxyEnabledStateChangedOn.mockReturnValue(vi.fn());
    mockAuthProxyRefreshRules.mockResolvedValue({ success: true });

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
      })
    );
  });

  it('should load values from Nexus for each entry', async () => {
    mockSecretGet.mockImplementation(({ namespace, key }: { namespace: string; key: string }) => {
      if (namespace === 'service:model_config' && key === 'max_tokens') return Promise.resolve({ success: true, data: '4096' });
      if (namespace === 'service:model_config' && key === 'temperature') return Promise.resolve({ success: true, data: '0.7' });
      if (namespace === 'service:prompt_config' && key === 'system_prompt') return Promise.resolve({ success: true, data: 'You are helpful' });
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

  it('should filter out config items with null pinyin', async () => {
    mockApiSuccess({
      success: true,
      data: [
        { id: 1, name: 'valid_item', pinyin: 'valid_item', entries: [{ id: 10, config_key: 'key1', config_desc: 'desc', name: 'Key1', required: 1 }] },
        { id: 2, name: 'invalid_item', pinyin: null, entries: [{ id: 20, config_key: 'key2', config_desc: 'desc', name: 'Key2', required: 1 }] },
      ],
    });

    const { result } = renderHook(() => useTenantConfigItems());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.configItems).toHaveLength(1);
    expect(result.current.configItems[0].name).toBe('valid_item');
    expect(result.current.valuesMap[2]).toBeUndefined();
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
                pinyin: 'model_config',
                entries: [{ id: 10, config_key: 'max_tokens', config_desc: '最大token数', name: '最大Token数', required: 1 }],
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
      return result.current.saveItem(
        1,
        'model_config',
        result.current.configItems[0].entries,
        {
          max_tokens: '8192',
          temperature: '0.5',
        },
        {}
      );
    });

    expect(success).toBe(true);
    expect(mockSecretPut).toHaveBeenCalledTimes(2);
    expect(mockSecretPut).toHaveBeenCalledWith({
      namespace: 'service:model_config',
      key: 'max_tokens',
      value: '8192',
      description: '最大Token数',
    });
    expect(mockSecretPut).toHaveBeenCalledWith({
      namespace: 'service:model_config',
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
      return result.current.saveItem(
        1,
        'model_config',
        result.current.configItems[0].entries,
        {
          max_tokens: '8192',
          temperature: '0.5',
        },
        {}
      );
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
          pinyin: 'raw_config',
          entries: [{ id: 30, config_key: 'raw_key', config_desc: null, name: 'raw_key', required: 1 }],
        },
      ],
    });

    const { result } = renderHook(() => useTenantConfigItems());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.saveItem(3, 'raw_config', result.current.configItems[0].entries, { raw_key: 'raw_value' }, {});
    });

    expect(mockSecretPut).toHaveBeenCalledWith({
      namespace: 'service:raw_config',
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
    const savePromise = result.current.saveItem(
      1,
      'model_config',
      result.current.configItems[0].entries,
      {
        max_tokens: '8192',
        temperature: '0.5',
      },
      {}
    );

    // After save completes, savingId should be null
    await savePromise;

    expect(result.current.savingId).toBeNull();
  });

  describe('saveItem with delete/restore handling', () => {
    // Helper to get a rendered hook result
    async function getHookResult() {
      const { result } = renderHook(() => useTenantConfigItems());
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
      return result;
    }

    it('should skip empty values when no old value exists (no delete called)', async () => {
      const result = await getHookResult();

      const success = await act(async () => {
        return result.current.saveItem(
          1,
          'model_config',
          result.current.configItems[0].entries,
          {
            max_tokens: '8192',
            temperature: '',
          },
          {}
        );
      });

      expect(success).toBe(true);
      expect(mockSecretPut).toHaveBeenCalledTimes(1);
      expect(mockSecretPut).toHaveBeenCalledWith(expect.objectContaining({ key: 'max_tokens' }));
      expect(mockSecretDelete).not.toHaveBeenCalled();
    });

    it('should delete empty values when old value exists', async () => {
      const result = await getHookResult();

      const success = await act(async () => {
        return result.current.saveItem(
          1,
          'model_config',
          result.current.configItems[0].entries,
          {
            max_tokens: '8192',
            temperature: '',
          },
          { temperature: '0.7' }
        );
      });

      expect(success).toBe(true);
      expect(mockSecretPut).toHaveBeenCalledTimes(1);
      expect(mockSecretDelete).toHaveBeenCalledTimes(1);
      expect(mockSecretDelete).toHaveBeenCalledWith({ namespace: 'service:model_config', key: 'temperature' });
    });

    it('should not block when delete fails (key does not exist)', async () => {
      mockSecretDelete.mockRejectedValue(new Error('Secret not found'));

      const result = await getHookResult();

      const success = await act(async () => {
        return result.current.saveItem(
          1,
          'model_config',
          result.current.configItems[0].entries,
          {
            max_tokens: '8192',
            temperature: '',
          },
          { temperature: '0.7' }
        );
      });

      expect(success).toBe(true);
      expect(mockSecretPut).toHaveBeenCalledTimes(1);
    });

    it('should not block when delete fails (key already deleted)', async () => {
      mockSecretDelete.mockResolvedValue({ success: false, data: false });

      const result = await getHookResult();

      const success = await act(async () => {
        return result.current.saveItem(
          1,
          'model_config',
          result.current.configItems[0].entries,
          {
            max_tokens: '8192',
            temperature: '',
          },
          { temperature: '0.7' }
        );
      });

      expect(success).toBe(true);
    });

    it('should put directly when get succeeds (key exists and is active)', async () => {
      mockSecretGet.mockResolvedValue({ success: true, data: '4096' });

      const result = await getHookResult();

      const success = await act(async () => {
        return result.current.saveItem(
          1,
          'model_config',
          result.current.configItems[0].entries,
          {
            max_tokens: '8192',
          },
          {}
        );
      });

      expect(success).toBe(true);
      expect(mockSecretRestore).not.toHaveBeenCalled();
      expect(mockSecretPut).toHaveBeenCalledWith(expect.objectContaining({ key: 'max_tokens', value: '8192' }));
    });

    it('should restore then put when get fails (key deleted)', async () => {
      mockSecretGet.mockResolvedValue({ success: false, data: null });

      const result = await getHookResult();

      const success = await act(async () => {
        return result.current.saveItem(
          1,
          'model_config',
          result.current.configItems[0].entries,
          {
            max_tokens: '8192',
          },
          {}
        );
      });

      expect(success).toBe(true);
      expect(mockSecretRestore).toHaveBeenCalledWith({ namespace: 'service:model_config', key: 'max_tokens' });
      expect(mockSecretPut).toHaveBeenCalledWith(expect.objectContaining({ key: 'max_tokens', value: '8192' }));
    });

    it('should still put when restore fails (key never existed)', async () => {
      mockSecretGet.mockResolvedValue({ success: false, data: null });
      mockSecretRestore.mockRejectedValue(new Error('Secret not found'));

      const result = await getHookResult();

      const success = await act(async () => {
        return result.current.saveItem(
          1,
          'model_config',
          result.current.configItems[0].entries,
          {
            max_tokens: '8192',
          },
          {}
        );
      });

      expect(success).toBe(true);
      expect(mockSecretRestore).toHaveBeenCalled();
      expect(mockSecretPut).toHaveBeenCalledWith(expect.objectContaining({ key: 'max_tokens', value: '8192' }));
    });

    it('should return false when restore fails and put also fails', async () => {
      mockSecretGet.mockResolvedValue({ success: false, data: null });
      mockSecretRestore.mockRejectedValue(new Error('Secret not found'));
      mockSecretPut.mockRejectedValue(new Error('Network error'));

      const result = await getHookResult();

      const success = await act(async () => {
        return result.current.saveItem(
          1,
          'model_config',
          result.current.configItems[0].entries,
          {
            max_tokens: '8192',
          },
          {}
        );
      });

      expect(success).toBe(false);
    });

    it('should delete all when all values are empty with old values', async () => {
      const result = await getHookResult();

      const success = await act(async () => {
        return result.current.saveItem(
          1,
          'model_config',
          result.current.configItems[0].entries,
          {
            max_tokens: '',
            temperature: '',
          },
          { max_tokens: '4096', temperature: '0.7' }
        );
      });

      expect(success).toBe(true);
      expect(mockSecretPut).not.toHaveBeenCalled();
      expect(mockSecretDelete).toHaveBeenCalledTimes(2);
    });

    it('should skip all when all values are empty with no old values', async () => {
      const result = await getHookResult();

      const success = await act(async () => {
        return result.current.saveItem(
          1,
          'model_config',
          result.current.configItems[0].entries,
          {
            max_tokens: '',
            temperature: '',
          },
          {}
        );
      });

      expect(success).toBe(true);
      expect(mockSecretPut).not.toHaveBeenCalled();
      expect(mockSecretDelete).not.toHaveBeenCalled();
      expect(mockSecretRestore).not.toHaveBeenCalled();
    });

    it('should handle mixed scenario: some put, some delete, some skip', async () => {
      // max_tokens: has value, get succeeds -> put directly
      // temperature: empty, has old value -> delete
      // system_prompt: has value, get fails -> restore + put
      mockSecretGet.mockImplementation(({ key }: { key: string }) => {
        if (key === 'max_tokens') return Promise.resolve({ success: true, data: '4096' });
        return Promise.resolve({ success: false, data: null });
      });

      const result = await getHookResult();

      const success = await act(async () => {
        return result.current.saveItem(
          1,
          'model_config',
          result.current.configItems[0].entries,
          {
            max_tokens: '8192',
            temperature: '',
          },
          { temperature: '0.7' }
        );
      });

      expect(success).toBe(true);
      expect(mockSecretPut).toHaveBeenCalledTimes(1);
      expect(mockSecretPut).toHaveBeenCalledWith(expect.objectContaining({ key: 'max_tokens', value: '8192' }));
      expect(mockSecretDelete).toHaveBeenCalledTimes(1);
      expect(mockSecretDelete).toHaveBeenCalledWith({ namespace: 'service:model_config', key: 'temperature' });
    });

    it('should treat whitespace-only values as empty', async () => {
      const result = await getHookResult();

      const success = await act(async () => {
        return result.current.saveItem(
          1,
          'model_config',
          result.current.configItems[0].entries,
          {
            max_tokens: '8192',
            temperature: '   ',
          },
          {}
        );
      });

      expect(success).toBe(true);
      expect(mockSecretPut).toHaveBeenCalledTimes(1);
      expect(mockSecretPut).toHaveBeenCalledWith(expect.objectContaining({ key: 'max_tokens' }));
      expect(mockSecretDelete).not.toHaveBeenCalled();
    });

    it('should return false when put partially fails in mixed scenario', async () => {
      mockSecretPut.mockImplementation(({ key }: { key: string }) => {
        if (key === 'max_tokens') return Promise.resolve({ success: true });
        return Promise.reject(new Error('put failed'));
      });

      const result = await getHookResult();

      const success = await act(async () => {
        return result.current.saveItem(
          1,
          'model_config',
          result.current.configItems[0].entries,
          {
            max_tokens: '8192',
            temperature: '0.5',
          },
          {}
        );
      });

      expect(success).toBe(false);
    });
  });
});
