/**
 * Secret Store - Singleton factory for SecretStoreClient.
 *
 * Provides a single instance of SecretStoreClient for the application.
 */

import { SecretStoreClient } from './secret-store-client.js';
import { resolveConfig } from './config.js';

let clientInstance: SecretStoreClient | null = null;

/**
 * Get or create the SecretStoreClient singleton.
 * Thread-safe in Node.js module context.
 *
 * Uses resolveConfig() to read baseUrl from:
 * 1. ~/.nexus/config.yaml
 * 2. NEXUS_URL environment variable
 * 3. Default: http://localhost:12012
 */
export function getSecretStoreClient(apiKey?: string): SecretStoreClient {
  if (!clientInstance && apiKey) {
    const config = resolveConfig({ apiKey });
    clientInstance = new SecretStoreClient(apiKey, config.baseUrl);
  }
  if (!clientInstance) {
    throw new Error('SecretStoreClient not initialized. Call getSecretStoreClient(apiKey) first.');
  }
  return clientInstance;
}

/**
 * Initialize the SecretStoreClient with API key.
 * Uses resolveConfig() to read baseUrl from config file or environment.
 */
export function initializeSecretStoreClient(apiKey: string): void {
  const config = resolveConfig({ apiKey });
  clientInstance = new SecretStoreClient(apiKey, config.baseUrl);
}

// Re-export types
export { SecretStoreClient } from './secret-store-client.js';
export type {
  SecretMetadata,
  VersionMetadata,
  PutSecretRequest,
  GetSecretRequest,
} from './secret-store-client.js';
