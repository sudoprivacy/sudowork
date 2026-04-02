/**
 * Secret Migration Coordinator - Orchestrates initial secret migration from local storage to Nexus.
 *
 * Responsibilities:
 * 1. Check if migration has already been done (via secret_migration_version)
 * 2. Wait for Nexus to be healthy
 * 3. Migrate all secret types in order:
 *    - Channel credentials (Telegram, Feishu, DingTalk, WeChat)
 *    - AI Platform API Keys (OpenAI, Anthropic, Gemini, Bedrock)
 *    - ACP Auth Tokens
 *    - Device Auth Tokens
 *    - JWT Secrets
 * 4. Mark migration as complete
 * 5. Trigger cache preload
 */

import { secretCache, markMigrated } from './secret-cache';
import { getSecretStoreClient, SecretStoreClient } from './secret-store';
import { resolveConfig } from './config';
import { decryptCredentials } from '@/channels/utils/credentialCrypto';
import { getDatabase } from '@process/database/export';
import { UserRepository } from '@/webserver/auth/repository/UserRepository';
import { ProcessConfig } from '@process/initStorage';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

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
  lark: ['appSecret', 'encryptKey', 'verificationToken'],
  dingtalk: ['clientSecret'],
  wechat: [], // WeChat uses token-based auth, no separate secret
};

// ============================================================================
// Migration Coordinator
// ============================================================================

export class SecretMigrationCoordinator {
  private client: SecretStoreClient | null = null;
  private migrationMap: MigrationMap = {};
  private apiKey: string = '';

  /**
   * Initialize the coordinator with API key for Nexus authentication.
   */
  initialize(apiKey: string): void {
    this.apiKey = apiKey;
    this.client = getSecretStoreClient(apiKey);
    secretCache.initialize(apiKey);
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

    // Step 2: Wait for Nexus to be healthy
    console.log('[SecretMigration] Waiting for Nexus to be healthy...');
    const nexusHealthy = await this.waitForNexus(30000); // 30s timeout
    if (!nexusHealthy) {
      result.success = false;
      result.errors.push('Nexus is not healthy, cannot migrate');
      return result;
    }

    console.log('[SecretMigration] Nexus is healthy, starting migration...');

    // Step 3: Load migration map
    await this.loadMigrationMap();

    // Step 4: Migrate each secret type
    const migrateFunctions = [
      this.migrateChannelCredentials.bind(this),
      this.migrateAIPlatformCredentials.bind(this),
      this.migrateACPAuthTokens.bind(this),
      this.migrateDeviceAuthTokens.bind(this),
      this.migrateJWTSecrets.bind(this),
    ];

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

    // Step 5: Mark migration as complete
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
   * Check if Nexus is healthy by calling /health endpoint.
   */
  private async waitForNexus(timeoutMs: number): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const response = await fetch('http://localhost:12012/health', {
          method: 'GET',
          signal: AbortSignal.timeout(5000),
        });
        if (response.ok) {
          return true;
        }
      } catch {
        // Ignore errors, keep waiting
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return false;
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
   * Migrate a single secret to Nexus.
   */
  private async migrateSecret(namespace: string, key: string, value: string): Promise<void> {
    if (!this.client) {
      throw new Error('SecretStoreClient not initialized');
    }

    const ref = `${namespace}:${key}`;
    if (this.isMigrated(namespace, key)) {
      console.log(`[SecretMigration] Skipping ${ref} (already migrated)`);
      return;
    }

    try {
      await this.client.putSecret(namespace, key, value);
      this.markMigratedLocal(namespace, key);
      markMigrated(namespace, key, value);
      console.log(`[SecretMigration] Migrated ${ref}`);
    } catch (error) {
      const errorMsg = `Failed to migrate ${ref}: ${error instanceof Error ? error.message : String(error)}`;
      console.error(`[SecretMigration] ${errorMsg}`);
      throw new Error(errorMsg);
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
    let count = 0;

    try {
      const db = getDatabase();
      const pluginsResult = db.getChannelPlugins();

      if (!pluginsResult.success || !pluginsResult.data) {
        console.log('[SecretMigration] No channel plugins found or error reading');
        return 0;
      }

      for (const plugin of pluginsResult.data) {
        const credentialFields = CHANNEL_CREDENTIAL_FIELDS[plugin.type] || [];
        if (credentialFields.length === 0) {
          continue;
        }

        // Decrypt credentials before storing
        const decryptedCredentials = decryptCredentials(plugin.credentials);
        if (!decryptedCredentials) {
          continue;
        }

        const namespace = `channel:${plugin.type}:${plugin.id}`;

        for (const field of credentialFields) {
          const value = decryptedCredentials[field];
          if (value && typeof value === 'string') {
            try {
              await this.migrateSecret(namespace, field, value);
              count++;
            } catch (error) {
              console.error(`[SecretMigration] Failed to migrate channel ${plugin.type}:${plugin.id}:${field}:`, error);
            }
          }
        }
      }

      // Also save the migration map
      await this.saveMigrationMap();
    } catch (error) {
      console.error('[SecretMigration] Error migrating channel credentials:', error);
    }

    return count;
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
    let count = 0;

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
            count++;
          } catch (error) {
            console.error(`[SecretMigration] Failed to migrate provider ${provider.id} api_key:`, error);
          }
        }

        // Migrate Bedrock credentials
        if (provider.platform === 'bedrock' && provider.bedrockConfig) {
          const config = provider.bedrockConfig;

          if (config.accessKeyId && typeof config.accessKeyId === 'string') {
            try {
              await this.migrateSecret(`provider:${provider.id}`, 'access_key_id', config.accessKeyId);
              count++;
            } catch (error) {
              console.error(`[SecretMigration] Failed to migrate provider ${provider.id} access_key_id:`, error);
            }
          }

          if (config.secretAccessKey && typeof config.secretAccessKey === 'string') {
            try {
              await this.migrateSecret(`provider:${provider.id}`, 'secret_access_key', config.secretAccessKey);
              count++;
            } catch (error) {
              console.error(`[SecretMigration] Failed to migrate provider ${provider.id} secret_access_key:`, error);
            }
          }
        }
      }

      await this.saveMigrationMap();
    } catch (error) {
      console.error('[SecretMigration] Error migrating AI platform credentials:', error);
    }

    return count;
  }

  /**
   * Migrate ACP auth tokens from ConfigStorage acp.config.
   */
  private async migrateACPAuthTokens(): Promise<number> {
    console.log('[SecretMigration] Migrating ACP auth tokens...');
    let count = 0;

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
            count++;
          } catch (error) {
            console.error(`[SecretMigration] Failed to migrate acp ${backend} auth_token:`, error);
          }
        }
      }

      await this.saveMigrationMap();
    } catch (error) {
      console.error('[SecretMigration] Error migrating ACP auth tokens:', error);
    }

    return count;
  }

  /**
   * Migrate device auth tokens from ~/.openclaw/identity/device-auth.json.
   */
  private async migrateDeviceAuthTokens(): Promise<number> {
    console.log('[SecretMigration] Migrating device auth tokens...');
    let count = 0;

    try {
      const deviceAuthPath = this.resolveDeviceAuthPath();
      if (!fs.existsSync(deviceAuthPath)) {
        console.log('[SecretMigration] No device-auth.json found');
        return 0;
      }

      const content = fs.readFileSync(deviceAuthPath, 'utf-8');
      const store = JSON.parse(content);

      if (!store.tokens || typeof store.tokens !== 'object') {
        return 0;
      }

      // Each token entry has structure: { token, role, scopes, updatedAtMs }
      for (const [role, entry] of Object.entries(store.tokens)) {
        if (!entry || typeof entry !== 'object') {
          continue;
        }

        const tokenEntry = entry as { token?: string };
        if (tokenEntry.token && typeof tokenEntry.token === 'string') {
          // Use role as part of the key to differentiate tokens
          const namespace = 'auth:device';
          const key = role === 'default' ? 'token' : `token:${role}`;
          try {
            await this.migrateSecret(namespace, key, tokenEntry.token);
            count++;
          } catch (error) {
            console.error(`[SecretMigration] Failed to migrate device auth token (role: ${role}):`, error);
          }
        }
      }

      await this.saveMigrationMap();
    } catch (error) {
      console.error('[SecretMigration] Error migrating device auth tokens:', error);
    }

    return count;
  }

  /**
   * Resolve the device auth file path.
   */
  private resolveDeviceAuthPath(): string {
    const stateDir = process.env.OPENCLAW_STATE_DIR?.trim() || path.join(os.homedir(), '.openclaw');
    return path.join(stateDir, 'identity', 'device-auth.json');
  }

  /**
   * Migrate JWT secrets from SQLite users table.
   */
  private async migrateJWTSecrets(): Promise<number> {
    console.log('[SecretMigration] Migrating JWT secrets...');
    let count = 0;

    try {
      const users = UserRepository.listUsers();

      for (const user of users) {
        if (user.jwt_secret && typeof user.jwt_secret === 'string') {
          const namespace = 'auth:jwt';
          const key = user.id === 'system_default_user' ? 'webui_secret' : `webui_secret:${user.id}`;
          try {
            await this.migrateSecret(namespace, key, user.jwt_secret);
            count++;
          } catch (error) {
            console.error(`[SecretMigration] Failed to migrate JWT secret for user ${user.id}:`, error);
          }
        }
      }

      await this.saveMigrationMap();
    } catch (error) {
      console.error('[SecretMigration] Error migrating JWT secrets:', error);
    }

    return count;
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
 * This should be called after Nexus is healthy.
 */
export async function initializeSecrets(): Promise<void> {
  const config = resolveConfig();
  const apiKey = config.apiKey;

  if (!apiKey) {
    console.warn('[SecretMigration] No Nexus API key found, skipping secret migration');
    return;
  }

  const coordinator = getMigrationCoordinator();
  coordinator.initialize(apiKey);

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
