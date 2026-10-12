/**
 * Secret Migration Coordinator - Orchestrates initial secret migration from local storage to Nexus.
 *
 * Responsibilities:
 * 1. Check if migration has already been done (via secret_migration_version)
 * 2. Migrate all secret types through Sudocode in order:
 *    - Channel credentials (Telegram, Feishu, DingTalk, WeChat)
 *    - AI Platform API Keys (OpenAI, Anthropic, Gemini, Bedrock)
 *    - ACP Auth Tokens
 *    - JWT Secrets
 * 3. Mark migration as complete
 * 4. Trigger cache preload
 */

import { decryptCredentials } from '@/channels/utils/credentialCrypto';
import { getDatabase } from '@process/database/export';
import { ProcessConfig } from '@process/initStorage';
import type { ScodeSecretsClient } from '../scode/secretsClient';
import { getScodeSecretsClient } from '../scode/secretsClient';
import { secretCache, markMigrated } from './secret-cache';

// ============================================================================
// Types
// ============================================================================

export interface MigrationResult {
  success: boolean;
  migratedCount: number;
  failedCount: number;
  errors: string[];
}

interface MigrationMap {
  [secretRef: string]: {
    migrated: boolean;
    migratedAt: number;
  };
}

// ============================================================================
// Constants
// ============================================================================

const SECRET_MIGRATION_VERSION_KEY = 'secret_migration_version';
const SECRET_MIGRATION_VERSION = 1;

/**
 * Credential field names by channel type.
 * Only sensitive fields that need to be stored in Nexus.
 * ID fields (appId, clientId, accountId) are not credentials - they stay in SQLite.
 */
const CHANNEL_CREDENTIAL_FIELDS: Record<string, string[]> = {
  telegram: ['token'],
  lark: ['appSecret', 'encryptKey', 'verificationToken', 'larkUserAccessToken', 'larkUserRefreshToken'],
  dingtalk: ['clientSecret'],
  wechat: [], // WeChat uses token-based auth, no separate secret
  zentao: ['zentaoPassword'],
};

// ============================================================================
// Migration Coordinator
// ============================================================================

export class SecretMigrationCoordinator {
  private client: ScodeSecretsClient | null = null;
  private migrationMap: MigrationMap = {};

  /**
   * Initialize the coordinator with Sudocode's Vault capability.
   */
  initialize(): void {
    this.client = getScodeSecretsClient();
    secretCache.initialize();
  }

  /**
   * Check if migration is needed.
   */
  async isMigrationNeeded(): Promise<boolean> {
    const version = await this.getMigrationVersion();
    return version < SECRET_MIGRATION_VERSION;
  }

  /**
   * Run migration if not already done.
   * Idempotent - safe to call multiple times.
   */
  async migrateAll(): Promise<MigrationResult> {
    const result: MigrationResult = {
      success: true,
      migratedCount: 0,
      failedCount: 0,
      errors: [],
    };

    // Step 1: Check if already migrated
    const version = await this.getMigrationVersion();
    if (version >= SECRET_MIGRATION_VERSION) {
      console.log('[SecretMigration] Already migrated, skipping');
      return result;
    }

    // Load durable migration progress before submitting Vault operations.
    await this.loadMigrationMap();

    // Migrate each secret type.
    const migrateFunctions = [this.migrateChannelCredentials.bind(this), this.migrateAIPlatformCredentials.bind(this), this.migrateACPAuthTokens.bind(this)];

    for (const migrateFn of migrateFunctions) {
      try {
        const count = await migrateFn();
        result.migratedCount += count;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        result.errors.push(errorMsg);
        result.failedCount++;
      }
    }

    // Mark migration complete after all writes have been verified.
    if (result.failedCount === 0) {
      await this.setMigrationVersion(SECRET_MIGRATION_VERSION);
      console.log(`[SecretMigration] Migration complete: ${result.migratedCount} secrets migrated`);
    } else {
      result.success = false;
      console.error(`[SecretMigration] Migration completed with errors: ${result.errors.join(', ')}`);
    }

    return result;
  }

  /**
   * Get current migration version from ConfigStorage.
   */
  private async getMigrationVersion(): Promise<number> {
    try {
      const version = await ProcessConfig.get(SECRET_MIGRATION_VERSION_KEY as any);
      return version ? parseInt(String(version), 10) : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Set migration version in ConfigStorage.
   */
  private async setMigrationVersion(version: number): Promise<void> {
    await ProcessConfig.set(SECRET_MIGRATION_VERSION_KEY as any, String(version));
  }

  /**
   * Load migration map from ConfigStorage.
   */
  private async loadMigrationMap(): Promise<void> {
    try {
      const mapJson = await ProcessConfig.get('secret_migration_map' as any);
      if (mapJson && typeof mapJson === 'string') {
        this.migrationMap = JSON.parse(mapJson);
      }
    } catch {
      this.migrationMap = {};
    }
  }

  /**
   * Save migration map to ConfigStorage.
   */
  private async saveMigrationMap(): Promise<void> {
    await ProcessConfig.set('secret_migration_map' as any, JSON.stringify(this.migrationMap));
  }

  /**
   * Check if a secret has been migrated.
   */
  private isMigrated(namespace: string, key: string): boolean {
    const ref = `${namespace}:${key}`;
    return this.migrationMap[ref]?.migrated === true;
  }

  /**
   * Mark a secret as migrated.
   */
  private markMigratedLocal(namespace: string, key: string): void {
    const ref = `${namespace}:${key}`;
    this.migrationMap[ref] = {
      migrated: true,
      migratedAt: Date.now(),
    };
  }

  /**
   * Migrate a single secret to Nexus with verification.
   */
  private async migrateSecret(namespace: string, key: string, value: string): Promise<void> {
    if (!this.client) {
      throw new Error('ScodeSecretsClient not initialized');
    }

    const ref = `${namespace}:${key}`;
    if (this.isMigrated(namespace, key)) {
      console.log(`[SecretMigration] Skipping ${ref} (already migrated)`);
      return;
    }

    try {
      // Step 1: Write secret to Nexus
      await this.client.putSecret(namespace, key, value);

      // Step 2: Read back to verify - ensure secret was stored correctly
      const storedValue = await this.client.getSecret(namespace, key);

      // Step 3: Data integrity check
      if (storedValue !== value) {
        throw new Error(`Verification failed: stored value mismatch for ${ref}`);
      }

      // Step 4: Verification passed, mark as migrated
      this.markMigratedLocal(namespace, key);
      markMigrated(namespace, key, value);
      console.log(`[SecretMigration] Secret verified: ${ref}`);
    } catch (error) {
      console.error(`[SecretMigration] Failed to migrate ${ref}: ${error instanceof Error ? error.message : String(error)}`);
      throw error; // Re-throw so the caller can track failures
    }
  }

  // ============================================================================
  // Migration functions for each secret type
  // ============================================================================

  /**
   * Migrate channel credentials from SQLite assistant_plugins table.
   * Channels: Telegram, Feishu, DingTalk, WeChat
   * Migrates ALL credential fields to Nexus (not just token).
   */
  private async migrateChannelCredentials(): Promise<number> {
    console.log('[SecretMigration] Migrating channel credentials...');
    let migrated = 0;
    let failed = 0;

    try {
      const db = getDatabase();
      // Use dedicated method to get raw credentials (not via getChannelPlugins which reads from Nexus)
      const rows = db.getAssistantPluginsForMigration();

      if (!rows || rows.length === 0) {
        console.log('[SecretMigration] No channel plugins found');
        return 0;
      }

      for (const row of rows) {
        const credentialFields = CHANNEL_CREDENTIAL_FIELDS[row.type] || [];
        if (credentialFields.length === 0) {
          continue;
        }

        // Parse original credentials from config column
        const storedConfig = JSON.parse(row.config || '{}');
        const credentials = storedConfig.credentials || {};

        // Decrypt credentials before storing
        const decryptedCredentials = decryptCredentials(credentials);
        if (!decryptedCredentials) {
          continue;
        }

        const namespace = `channel:${row.type}:${row.id}`;

        for (const field of credentialFields) {
          const value = decryptedCredentials[field];
          if (value && typeof value === 'string') {
            try {
              await this.migrateSecret(namespace, field, value);
              migrated++;
            } catch {
              // Error already logged in migrateSecret
              failed++;
            }
          }
        }
      }

      // Also save the migration map
      await this.saveMigrationMap();
    } catch (error) {
      console.error('[SecretMigration] Error migrating channel credentials:', error);
    }

    console.log(`[SecretMigration] Channel credentials migration complete: ${migrated} migrated, ${failed} failed`);
    return migrated;
  }

  /**
   * Get credential fields for a channel type.
   * Used by database layer for reading/writing.
   */
  public static getChannelCredentialFields(channelType: string): string[] {
    return CHANNEL_CREDENTIAL_FIELDS[channelType] || [];
  }

  /**
   * Migrate AI platform credentials from ConfigStorage model.config.
   * Providers: OpenAI, Anthropic, Gemini, Bedrock
   */
  private async migrateAIPlatformCredentials(): Promise<number> {
    console.log('[SecretMigration] Migrating AI platform credentials...');
    let migrated = 0;
    let failed = 0;

    try {
      const modelConfig = await ProcessConfig.get('model.config' as any);
      if (!modelConfig || !Array.isArray(modelConfig)) {
        console.log('[SecretMigration] No model.config found');
        return 0;
      }

      for (const provider of modelConfig) {
        // Migrate apiKey
        if (provider.apiKey && typeof provider.apiKey === 'string') {
          const namespace = `provider:${provider.id}`;
          try {
            await this.migrateSecret(namespace, 'api_key', provider.apiKey);
            migrated++;
          } catch {
            failed++;
          }
        }

        // Migrate Bedrock credentials
        if (provider.platform === 'bedrock' && provider.bedrockConfig) {
          const config = provider.bedrockConfig;

          if (config.accessKeyId && typeof config.accessKeyId === 'string') {
            try {
              await this.migrateSecret(`provider:${provider.id}`, 'access_key_id', config.accessKeyId);
              migrated++;
            } catch {
              failed++;
            }
          }

          if (config.secretAccessKey && typeof config.secretAccessKey === 'string') {
            try {
              await this.migrateSecret(`provider:${provider.id}`, 'secret_access_key', config.secretAccessKey);
              migrated++;
            } catch {
              failed++;
            }
          }
        }
      }

      await this.saveMigrationMap();
    } catch (error) {
      console.error('[SecretMigration] Error migrating AI platform credentials:', error);
    }

    console.log(`[SecretMigration] AI platform credentials migration complete: ${migrated} migrated, ${failed} failed`);
    return migrated;
  }

  /**
   * Migrate ACP auth tokens from ConfigStorage acp.config.
   */
  private async migrateACPAuthTokens(): Promise<number> {
    console.log('[SecretMigration] Migrating ACP auth tokens...');
    let migrated = 0;
    let failed = 0;

    try {
      const acpConfig = await ProcessConfig.get('acp.config' as any);
      if (!acpConfig || typeof acpConfig !== 'object') {
        console.log('[SecretMigration] No acp.config found');
        return 0;
      }

      // acp.config structure: { [backend]: { authToken?, ... } }
      for (const [backend, config] of Object.entries(acpConfig)) {
        if (!config || typeof config !== 'object') {
          continue;
        }

        const acpConfigObj = config as Record<string, unknown>;
        const authToken = acpConfigObj.authToken;

        if (authToken && typeof authToken === 'string') {
          const namespace = `auth:acp:${backend}`;
          try {
            await this.migrateSecret(namespace, 'auth_token', authToken);
            migrated++;
          } catch {
            failed++;
          }
        }
      }

      await this.saveMigrationMap();
    } catch (error) {
      console.error('[SecretMigration] Error migrating ACP auth tokens:', error);
    }

    console.log(`[SecretMigration] ACP auth tokens migration complete: ${migrated} migrated, ${failed} failed`);
    return migrated;
  }
}

// Singleton instance
let migrationCoordinator: SecretMigrationCoordinator | null = null;

/**
 * Get or create the migration coordinator singleton.
 */
export function getMigrationCoordinator(): SecretMigrationCoordinator {
  if (!migrationCoordinator) {
    migrationCoordinator = new SecretMigrationCoordinator();
  }
  return migrationCoordinator;
}

/**
 * Initialize and run migration, then preload the cache.
 * Called after the Sudocode service connection is ready.
 */
export async function initializeSecrets(): Promise<void> {
  const coordinator = getMigrationCoordinator();
  coordinator.initialize();

  // Run migration if needed
  const migrationResult = await coordinator.migrateAll();

  if (!migrationResult.success) {
    console.warn('[SecretMigration] Migration completed with errors:', migrationResult.errors);
    // Continue to preload even if migration had issues
  }

  // Preload cache after migration
  try {
    await secretCache.preload();
    console.log('[SecretMigration] Secret cache preloaded successfully');
  } catch (error) {
    console.error('[SecretMigration] Failed to preload secret cache:', error);
    // Don't throw - we can still operate in fallback mode
  }
}
