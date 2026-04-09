import { describe, it, expect, vi, beforeEach } from 'vitest';
import { secretCache, resolveSecret, cachePut } from '../../../src/common/nexus/secret-cache.js';

// Mock the SecretStoreClient and its factory
vi.mock('../../../src/common/nexus/secret-store.js', () => ({
  getSecretStoreClient: vi.fn(() => ({
    listSecrets: vi.fn(),
    getSecret: vi.fn(),
    putSecret: vi.fn(),
  })),
}));

describe('SecretCache', () => {
  beforeEach(() => {
    // Reset singleton state between tests
    (secretCache as any).cache.clear();
    (secretCache as any).migrated.clear();
    (secretCache as any).initialized = false;
    (secretCache as any).client = null;
  });

  describe('initialize', () => {
    it('should initialize the client', () => {
      secretCache.initialize();
      expect((secretCache as any).client).toBeDefined();
    });
  });

  describe('preload', () => {
    it('should preload secrets from client', async () => {
      const mockClient = {
        listSecrets: vi.fn().mockResolvedValue([{ namespace: 'ns', key: 'k1' }]),
        getSecret: vi.fn().mockResolvedValue('v1'),
        putSecret: vi.fn(),
      };
      (secretCache as any).client = mockClient;

      await secretCache.preload();

      expect(secretCache.isInitialized()).toBe(true);
      expect(secretCache.get('ns', 'k1')).toBe('v1');
      expect(secretCache.isMigrated('ns', 'k1')).toBe(true);
    });
  });

  describe('resolveSecret', () => {
    it('should return fallback if not migrated', () => {
      const result = resolveSecret('ns', 'k1', 'fallback-v');
      expect(result).toBe('fallback-v');
    });

    it('should return cached value if migrated', () => {
      secretCache.markMigrated('ns', 'k1', 'cached-v');
      const result = resolveSecret('ns', 'k1', 'fallback-v');
      expect(result).toBe('cached-v');
    });

    it('should NOT sync fallback to Nexus if differs from cache (after migration)', () => {
      // After migration: original storage is frozen, never sync back to Nexus
      const putSpy = vi.spyOn(secretCache, 'put');
      secretCache.markMigrated('ns', 'k1', 'cached-v');

      // Even if fallback differs from cache, we should NOT update Nexus
      const result = resolveSecret('ns', 'k1', 'new-v');

      expect(result).toBe('cached-v'); // Returns current cache first
      expect(putSpy).not.toHaveBeenCalled(); // No sync to Nexus
    });
  });

  describe('cachePut', () => {
    it('should update cache and trigger client put', () => {
      const mockClient = {
        putSecret: vi.fn().mockResolvedValue({}),
      };
      (secretCache as any).client = mockClient;
      
      cachePut('ns', 'k1', 'new-val');
      
      expect(secretCache.get('ns', 'k1')).toBe('new-val');
      expect(mockClient.putSecret).toHaveBeenCalledWith('ns', 'k1', 'new-val');
    });
  });
});
