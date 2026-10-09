/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockAuthFetch, mockGetServerConfig } = vi.hoisted(() => ({
  mockAuthFetch: vi.fn(),
  mockGetServerConfig: vi.fn(),
}));

vi.mock('@renderer/context/AuthContext', () => ({
  useAuth: () => ({
    user: { token: 'cached-token' },
    authFetch: mockAuthFetch,
  }),
}));

vi.mock('@sudowork/host-bridge/ipcBridge', () => ({
  sudoworkServer: {
    getConfig: { invoke: (...args: unknown[]) => mockGetServerConfig(...args) },
  },
}));

import { useModelUsageStats } from '@renderer/hooks/useModelUsageStats';

describe('useModelUsageStats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerConfig.mockResolvedValue({ baseUrl: 'https://sudowork.example' });
    mockAuthFetch.mockResolvedValue({
      json: () =>
        Promise.resolve({
          success: true,
          data: [{ date: '2026-09-11', model: 'scode', prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 }],
        }),
    });
  });

  it('loads model usage through the shared authenticated fetch path', async () => {
    const { result } = renderHook(() => useModelUsageStats());

    await act(async () => {
      await result.current.fetchStats('2026-09-01', '2026-09-11');
    });

    expect(mockAuthFetch).toHaveBeenCalledWith('https://sudowork.example/api/v1/user/model-usage-stats?start_date=2026-09-01&end_date=2026-09-11');
    expect(result.current.data).toEqual([{ date: '2026-09-11', model: 'scode', prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 }]);
    expect(result.current.error).toBeNull();
  });
});
