/**
 * Secret Cache - In-memory cache for secrets with synchronous access.
 *
 * Design goals:
 * - Startup preload: Load all secrets from Nexus once at startup
 * - Synchronous reads: No async/await for runtime access (resolveSecret is sync)
 * - Write-through cache: Updates go to both cache and Nexus
 * - Fallback: If cache miss, return original value (for downgrade scenarios)
 *
 * This solves the async/sync conflict by preloading all secrets at startup,
 * then serving from memory during runtime.
 */

import { getSecretStore, type ISecretStore } from './secret-store.js';

// ============================================================================
// Types
// ============================================================================

export interface MigrationMap {
  [secretRef: string]: {
    migrated: boolean;
    migratedAt: number;
  };
}

// ============================================================================
// Secret Cache
// ============================================================================

class SecretCacheImpl {
  private cache = new Map<string, string>(); // key: "namespace:key" -> 明文值
  private migrated = new Set<string>(); // 已迁移的 secretRef 集合
  private client: ISecretStore | null = null;
  private initialized = false;

  /**
   * Initialize the client.
   * Uses resolveConfig() to get full config including identity headers.
   * Called once at startup.
   */
  initialize(): void {
    this.client = getSecretStore();
  }

  /**
   * Preload all secrets from Nexus into memory cache.
   * Called once at startup after migration.
   */
  async preload(): Promise<void> {
    if (!this.client) {
      throw new Error('SecretCache not initialized. Call initialize() first.');
    }

    if (this.initialized) {
      return; // Already preloaded
    }

    try {
      const secrets = this.client.listSecrets();
      console.log('[SecretCache] listSecrets returned:', secrets.length, 'secrets');
      for (const secret of secrets) {
        if (secret.deleted) {
          continue; // Skip deleted secrets
        }
        console.log('[SecretCache] Getting secret:', secret.namespace, secret.key);
        try {
          const value = this.client.getSecret(secret.namespace, secret.key);
          this.cache.set(`${secret.namespace}:${secret.key}`, value);
          this.migrated.add(`${secret.namespace}:${secret.key}`);
        } catch (err) {
          // Skip secrets that cannot be retrieved (may be deleted or inaccessible)
          console.warn('[SecretCache] Skipping inaccessible secret:', secret.namespace, secret.key, '-', err instanceof Error ? err.message : err);
        }
      }
      this.initialized = true;
    } catch (error) {
      console.error('[SecretCache] Failed to preload secrets:', error);
      throw error;
    }
  }

  /**
   * Synchronous read from cache.
   * Returns undefined if not in cache.
   */
  get(namespace: string, key: string): string | undefined {
    return this.cache.get(`${namespace}:${key}`);
  }

  /**
   * Synchronous check if a secret has been migrated to Nexus.
   */
  isMigrated(namespace: string, key: string): boolean {
    return this.migrated.has(`${namespace}:${key}`);
  }

  /**
   * Synchronous update of cache entry.
   * Also writes to Nexus via fire-and-forget.
   */
  put(namespace: string, key: string, value: string): void {
    const ref = `${namespace}:${key}`;
    this.cache.set(ref, value);
    this.migrated.add(ref);

    // Fire-and-forget write to Nexus (putSecret is synchronous — use try/catch, not .catch())
    if (this.client) {
      try {
        this.client.putSecret(namespace, key, value);
      } catch (error) {
        console.error(`[SecretCache] Failed to write secret ${ref} to Nexus:`, error);
      }
    }
  }

  /**
   * Remove a cache entry.
   * Keeps the entry in the migrated set (secret remains migrated in Nexus,
   * just not available locally). After delete, resolveSecret() returns empty string.
   */
  delete(namespace: string, key: string): void {
    this.cache.delete(`${namespace}:${key}`);
  }

  /**
   * Async write to Nexus only (no cache update).
   * Used for initial migration.
   */
  async putToNexus(namespace: string, key: string, value: string): Promise<void> {
    if (!this.client) {
      throw new Error('SecretCache not initialized. Call initialize() first.');
    }
    this.client.putSecret(namespace, key, value);
  }

  /**
   * Mark a secret as migrated (called during initial migration).
   * Also caches the value locally.
   */
  markMigrated(namespace: string, key: string, value: string): void {
    const ref = `${namespace}:${key}`;
    this.cache.set(ref, value);
    this.migrated.add(ref);
  }

  /**
   * Check if initialized.
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

// Singleton instance
export const secretCache = new SecretCacheImpl();

// ============================================================================
// Synchronous API (for runtime use)
// ============================================================================

/**
 * Synchronous secret resolution - the main API for runtime access.
 *
 * After migration:
 * - Nexus is the ONLY source of truth for credentials
 * - Original storage is frozen - values are discarded and never read or synced
 * - This function returns cached value from Nexus, or empty string if not found
 *
 * Before migration (downgrade scenario):
 * - Fallback returns the original value for backward compatibility
 *
 * @param namespace - Secret namespace
 * @param key - Secret key
 * @param fallback - Only used before migration (for downgrade); ignored after migration
 * @returns The secret value from Nexus cache (or fallback before migration)
 */
export function resolveSecret(namespace: string, key: string, fallback: string): string {
  // Case 1: Secret is migrated -> return cached value from Nexus (ONLY source of truth)
  if (secretCache.isMigrated(namespace, key)) {
    const cached = secretCache.get(namespace, key);
    if (cached !== undefined) {
      // After migration: original storage is frozen, never sync back to Nexus
      return cached;
    }
    // Case 2: Cache miss but migrated -> return empty (Nexus is source of truth)
    return '';
  }

  // Case 3: Not migrated yet -> return fallback (for downgrade/migration period)
  // This is only used during migration, not after migration is complete
  return fallback;
}

/**
 * Synchronous update of cache + sync write to Nexus.
 * Use this in write path interceptors.
 */
export function cachePut(namespace: string, key: string, value: string): void {
  secretCache.put(namespace, key, value);
}

/**
 * Async write to Nexus (fire-and-forget, non-blocking).
 */
export function putSecretToNexus(namespace: string, key: string, value: string): void {
  secretCache.put(namespace, key, value);
}

/**
 * Mark a secret as migrated and cache its value.
 * Called during initial migration to populate the cache without Nexus write.
 */
export function markMigrated(namespace: string, key: string, value: string): void {
  secretCache.markMigrated(namespace, key, value);
}

/**
 * Synchronous removal of a cache entry.
 * Used after soft-deleting a secret from Nexus to ensure Auth Proxy
 * no longer injects the deleted secret.
 */
export function cacheDelete(namespace: string, key: string): void {
  secretCache.delete(namespace, key);
}
