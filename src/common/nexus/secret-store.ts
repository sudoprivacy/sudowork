/**
 * Secret Store - Singleton factory for SecretStoreClient.
 *
 * Provides a single instance of SecretStoreClient for the application.
 */

import { SecretStoreClient } from './secret-store-client.js';

let clientInstance: SecretStoreClient | null = null;

/**
 * Get or create the SecretStoreClient singleton.
 * Thread-safe in Node.js module context.
 */
export function getSecretStoreClient(apiKey?: string): SecretStoreClient {
  if (!clientInstance && apiKey) {
    clientInstance = new SecretStoreClient(apiKey, 'http://localhost:12012');
  }
  if (!clientInstance) {
    throw new Error('SecretStoreClient not initialized. Call getSecretStoreClient(apiKey) first.');
  }
  return clientInstance;
}

/**
 * Initialize the SecretStoreClient with API key.
 */
export function initializeSecretStoreClient(apiKey: string): void {
  clientInstance = new SecretStoreClient(apiKey, 'http://localhost:12012');
}

// Re-export types
export { SecretStoreClient } from './secret-store-client.js';
export type {
  SecretMetadata,
  VersionMetadata,
  PutSecretRequest,
  GetSecretRequest,
} from './secret-store-client.js';
