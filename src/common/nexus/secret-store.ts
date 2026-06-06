/**
 * Secret Store - Singleton factory for SecretStoreClient.
 *
 * Provides a single instance of SecretStoreClient for the application.
 */

import { SecretStoreClient, type SecretStoreClientOptions } from './secret-store-client.js';
import { resolveConfig } from './config.js';

let clientInstance: SecretStoreClient | null = null;

/**
 * Get or create the SecretStoreClient singleton.
 * Thread-safe in Node.js module context.
 *
 * Uses resolveConfig() to read full config (apiKey, baseUrl, subject, agentId, zoneId):
 * 1. Explicit overrides (constructor args)
 * 2. Config file (./nexus.yaml → ~/.nexus/config.yaml)
 * 3. Environment variables (NEXUS_URL, NEXUS_API_KEY, NEXUS_SUBJECT, etc.)
 * 4. Defaults: http://localhost:12022
 */
export function getSecretStoreClient(): SecretStoreClient {
  if (!clientInstance) {
    const config = resolveConfig();
    clientInstance = new SecretStoreClient({
      apiKey: config.apiKey || undefined,
      baseUrl: config.baseUrl,
      subject: config.subject,
      agentId: config.agentId,
      zoneId: config.zoneId,
    });
  }
  return clientInstance;
}

/**
 * Initialize the SecretStoreClient with optional overrides.
 * Uses resolveConfig() to read full config from file or environment.
 */
export function initializeSecretStoreClient(options?: Partial<SecretStoreClientOptions>): void {
  const config = resolveConfig(options);
  clientInstance = new SecretStoreClient({
    apiKey: config.apiKey || undefined,
    baseUrl: config.baseUrl,
    subject: config.subject,
    agentId: config.agentId,
    zoneId: config.zoneId,
  });
}

// Re-export types
export { SecretStoreClient } from './secret-store-client.js';
export type { SecretMetadata, VersionMetadata, PutSecretRequest, GetSecretRequest, SecretStoreClientOptions } from './secret-store-client.js';
