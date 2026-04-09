/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Import after mocking
import { ZentaoPlugin } from '@/channels/plugins/zentao/ZentaoPlugin';

describe('ZentaoPlugin.testConnection', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return false when credentials are missing', async () => {
    const result = await ZentaoPlugin.testConnection('', 'admin', 'pass');
    expect(result.success).toBe(false);
    expect(result.error).toContain('required');
  });

  it('should return false when url is missing', async () => {
    const result = await ZentaoPlugin.testConnection(undefined, 'admin', 'pass');
    expect(result.success).toBe(false);
  });

  it('should return true on successful v1 API call', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ token: 'abc123' }),
    });

    const result = await ZentaoPlugin.testConnection('https://zentao.example.com', 'admin', 'password123');

    expect(result.success).toBe(true);
    expect(result.botInfo?.name).toBe('Zentao');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://zentao.example.com/api.php/v1/tokens',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    );
  });

  it('should trim trailing slashes from URL', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ token: 'abc123' }),
    });

    await ZentaoPlugin.testConnection('https://zentao.example.com/', 'admin', 'password123');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://zentao.example.com/api.php/v1/tokens',
      expect.anything()
    );
  });

  it('should fall back to legacy API when v1 returns 404', async () => {
    // v1 API returns 404
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => 'Not Found',
    });

    // Legacy session ID request
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ session: 'session-123' }),
    });

    // Legacy login request
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ locate: '/index', user: { account: 'admin' } }),
    });

    const result = await ZentaoPlugin.testConnection('https://zentao.example.com', 'admin', 'password123');

    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('should return error on v1 API failure with non-404 status', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });

    const result = await ZentaoPlugin.testConnection('https://zentao.example.com', 'admin', 'wrong');

    expect(result.success).toBe(false);
    expect(result.error).toContain('401');
  });

  it('should return error on v1 API response without token', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ error: 'invalid credentials' }),
    });

    const result = await ZentaoPlugin.testConnection('https://zentao.example.com', 'admin', 'wrong');

    expect(result.success).toBe(false);
  });

  it('should return error on network failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const result = await ZentaoPlugin.testConnection('https://zentao.example.com', 'admin', 'password');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Network error');
  });

  it('should fall back to legacy API on TypeError (network issue with v1)', async () => {
    // v1 API throws TypeError (e.g. DNS failure)
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    // Legacy session ID request
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ session: 'session-123' }),
    });

    // Legacy login request
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ locate: '/my' }),
    });

    const result = await ZentaoPlugin.testConnection('https://zentao.example.com', 'admin', 'password');

    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('should send correct POST body for v1 API', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ token: 'test-token' }),
    });

    await ZentaoPlugin.testConnection('https://zentao.example.com', 'myuser', 'mypass');

    const callArgs = mockFetch.mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body).toEqual({ account: 'myuser', password: 'mypass' });
  });
});
