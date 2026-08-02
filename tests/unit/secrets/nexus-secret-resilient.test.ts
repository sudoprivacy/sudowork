/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the singleton client; we'll swap its behavior per test.
const mockClient = {
  putSecret: vi.fn(),
  getSecret: vi.fn(),
  batchPut: vi.fn(),
  batchGet: vi.fn(),
};

vi.mock('@common/nexus/nexus-secret-client.js', () => ({
  getNexusSecretClient: () => mockClient,
}));

vi.mock('@common/nexus/secret-store.js', () => ({
  getSecretStore: () => mockClient,
}));

// Resolve via the path the resilient module uses; the .js extension is the
// emit suffix preserved through bundler resolution.
import { putSecretResilient, getSecretResilient, isVaultMethodMissing } from '../../../src/common/nexus/nexus-secret-resilient';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('isVaultMethodMissing', () => {
  it('matches "method not found" case-insensitively', () => {
    expect(isVaultMethodMissing(new Error('Method Not Found'))).toBe(true);
    expect(isVaultMethodMissing(new Error('rpc error: method not found'))).toBe(true);
  });

  it('matches "UNIMPLEMENTED"', () => {
    expect(isVaultMethodMissing(new Error('StatusCode.UNIMPLEMENTED'))).toBe(true);
    expect(isVaultMethodMissing(new Error('14 UNIMPLEMENTED: ...'))).toBe(true);
  });

  it('does NOT match other error classes', () => {
    expect(isVaultMethodMissing(new Error('Network error'))).toBe(false);
    expect(isVaultMethodMissing(new Error('SHA mismatch'))).toBe(false);
    expect(isVaultMethodMissing(new Error('plugin API version mismatch: plugin=3, kernel=5'))).toBe(false);
  });

  it('does NOT match non-Error inputs', () => {
    expect(isVaultMethodMissing('method not found')).toBe(false);
    expect(isVaultMethodMissing(null)).toBe(false);
    expect(isVaultMethodMissing(undefined)).toBe(false);
  });
});

describe('putSecretResilient', () => {
  const meta = { namespace: 'svc:pwdlogin', key: 'demo', currentVersion: 1, deleted: false };

  it('returns putSecret metadata on the happy path (single-secret dispatch present)', () => {
    mockClient.putSecret.mockReturnValueOnce(meta);
    const result = putSecretResilient('svc:pwdlogin', 'demo', 'value', 'desc');
    expect(result).toEqual(meta);
    expect(mockClient.putSecret).toHaveBeenCalledWith('svc:pwdlogin', 'demo', 'value', 'desc');
    expect(mockClient.batchPut).not.toHaveBeenCalled();
  });

  it('falls back to batchPut when single-secret dispatch is missing', () => {
    // This is the 进二-bug-class: deployed vault dylib lacks secret_put.
    mockClient.putSecret.mockImplementationOnce(() => {
      throw new Error('rpc method not found: secret_put');
    });
    mockClient.batchPut.mockReturnValueOnce([meta]);
    const result = putSecretResilient('svc:pwdlogin', 'demo', 'value', 'desc');
    expect(result).toEqual(meta);
    expect(mockClient.batchPut).toHaveBeenCalledWith([{ namespace: 'svc:pwdlogin', key: 'demo', value: 'value', description: 'desc' }]);
  });

  it('falls back on UNIMPLEMENTED too (alternate error wording)', () => {
    mockClient.putSecret.mockImplementationOnce(() => {
      throw new Error('StatusCode.UNIMPLEMENTED');
    });
    mockClient.batchPut.mockReturnValueOnce([meta]);
    expect(putSecretResilient('ns', 'k', 'v')).toEqual(meta);
    expect(mockClient.batchPut).toHaveBeenCalled();
  });

  it('does NOT swallow non-method-missing errors', () => {
    // ABI mismatch / network / signature failures must propagate, not be
    // masked as "fall back to batch".
    mockClient.putSecret.mockImplementationOnce(() => {
      throw new Error('plugin API version mismatch: plugin=3, kernel=5');
    });
    expect(() => putSecretResilient('ns', 'k', 'v')).toThrow(/version mismatch/);
    expect(mockClient.batchPut).not.toHaveBeenCalled();
  });

  it('surfaces empty-batch-result loudly (vault impl bug, not silent success)', () => {
    mockClient.putSecret.mockImplementationOnce(() => {
      throw new Error('method not found');
    });
    mockClient.batchPut.mockReturnValueOnce([]);
    expect(() => putSecretResilient('ns', 'k', 'v')).toThrow(/batch_put fallback returned empty/);
  });
});

describe('getSecretResilient', () => {
  it('returns the value on the happy path', () => {
    mockClient.getSecret.mockReturnValueOnce('the-value');
    expect(getSecretResilient('ns', 'k')).toBe('the-value');
    expect(mockClient.batchGet).not.toHaveBeenCalled();
  });

  it('falls back to batchGet when single dispatch is missing', () => {
    mockClient.getSecret.mockImplementationOnce(() => {
      throw new Error('method not found');
    });
    mockClient.batchGet.mockReturnValueOnce({ k: 'the-value' });
    expect(getSecretResilient('ns', 'k')).toBe('the-value');
    expect(mockClient.batchGet).toHaveBeenCalledWith([{ namespace: 'ns', key: 'k' }]);
  });

  it("returns '' when fallback batchGet has no matching key (vault sentinel)", () => {
    mockClient.getSecret.mockImplementationOnce(() => {
      throw new Error('UNIMPLEMENTED');
    });
    mockClient.batchGet.mockReturnValueOnce({});
    expect(getSecretResilient('ns', 'k')).toBe('');
  });

  it('does NOT swallow non-method-missing errors', () => {
    mockClient.getSecret.mockImplementationOnce(() => {
      throw new Error('Not found: ns/k');
    });
    expect(() => getSecretResilient('ns', 'k')).toThrow(/Not found/);
    expect(mockClient.batchGet).not.toHaveBeenCalled();
  });
});
