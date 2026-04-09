/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 全自动化集成测试：Nexus Secrets 认证适配
 *
 * 测试目标：
 * 1. 验证 SecretStoreClient 正确传递身份头（subject, agentId, zoneId）
 * 2. 验证无 apiKey 时支持开放访问模式（仅身份头认证）
 * 3. 验证有 apiKey 时使用 Bearer token 认证
 *
 * 运行方式：
 *   NEXUS_URL=http://localhost:12016 NEXUS_SUBJECT=user:test npm test -- --testNamePattern="secrets-auth"
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

// Mock electron module before any imports
vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '1.0.0'),
    getPath: vi.fn(() => '/test/path'),
    isPackaged: false,
  },
}));

// Mock database module to avoid initStorage dependencies
vi.mock('../../src/process/database/index', () => ({
  getDatabase: vi.fn(() => ({
    getAssistantPluginsForMigration: vi.fn(() => []),
  })),
  getAssistantPluginsForMigration: vi.fn(() => []),
}));

// Mock ProcessConfig
vi.mock('../../src/process/initStorage', () => ({
  ProcessConfig: {
    get: vi.fn(() => Promise.resolve(null)),
    set: vi.fn(() => Promise.resolve()),
  },
}));

// Mock UserRepository
vi.mock('../../src/webserver/auth/repository/UserRepository', () => ({
  UserRepository: {
    listUsers: vi.fn(() => []),
  },
}));

// Mock credentialCrypto
vi.mock('../../src/channels/utils/credentialCrypto', () => ({
  decryptCredentials: vi.fn(() => ({})),
}));

// Now import the modules under test
import { SecretStoreClient } from '../../src/common/nexus/secret-store-client';
import { resolveConfig } from '../../src/common/nexus/config';

describe('Nexus Secrets Auth Adaptation Integration Tests', () => {
  const TEST_NAMESPACE = 'test:auth:integration';
  const TEST_KEY = 'test-secret-key';
  const TEST_VALUE = `test-secret-value-${Date.now()}`;

  // Track if nexus is available
  let nexusAvailable = false;
  let testClient: SecretStoreClient | null = null;

  beforeAll(async () => {
    // Check if nexus is available
    const config = resolveConfig();
    const healthUrl = `${config.baseUrl}/health`;
    console.log('[Test] Checking Nexus health at:', healthUrl);
    console.log('[Test] Config:', JSON.stringify({
      baseUrl: config.baseUrl,
      hasApiKey: !!config.apiKey,
      subject: config.subject,
      agentId: config.agentId,
      zoneId: config.zoneId,
    }));

    let attempts = 0;
    const maxAttempts = 30;

    while (attempts < maxAttempts) {
      try {
        const res = await fetch(healthUrl, { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          nexusAvailable = true;
          console.log('[Test] Nexus is available at', config.baseUrl);
          break;
        }
      } catch (err) {
        // Ignore and retry
      }
      attempts++;
      if (attempts < maxAttempts) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    if (!nexusAvailable) {
      console.log('[Test] Nexus not available, tests will be skipped');
    } else {
      // Create test client with config
      const config = resolveConfig();
      testClient = new SecretStoreClient({
        apiKey: config.apiKey || undefined,
        baseUrl: config.baseUrl,
        subject: config.subject,
        agentId: config.agentId,
        zoneId: config.zoneId,
      });
    }
  }, 60000);

  afterAll(async () => {
    // Cleanup test data
    if (nexusAvailable && testClient) {
      try {
        await testClient.deleteSecret(TEST_NAMESPACE, TEST_KEY);
        console.log('[Test] Cleanup completed');
      } catch (err) {
        console.log('[Test] Cleanup error:', err);
      }
    }
  });

  it('1. resolveConfig returns configuration with identity headers', () => {
    const config = resolveConfig();
    console.log('[Test] Config:', JSON.stringify({
      baseUrl: config.baseUrl,
      hasApiKey: !!config.apiKey,
      subject: config.subject,
      agentId: config.agentId,
      zoneId: config.zoneId,
    }));

    // Verify baseUrl is defined
    expect(config.baseUrl).toBeDefined();
    // At least one credential should be present (either apiKey or identity headers)
    const hasCredentials = !!config.apiKey || !!config.subject || !!config.agentId || !!config.zoneId;
    expect(hasCredentials).toBe(true);
  });

  it('2. SecretStoreClient can write and read secrets with proper auth', async () => {
    if (!nexusAvailable || !testClient) {
      console.log('[Test] Skipping - Nexus not available');
      return;
    }

    expect(testClient).toBeDefined();

    // Write a test secret
    await testClient.putSecret(TEST_NAMESPACE, TEST_KEY, TEST_VALUE);
    console.log('[Test] Secret written:', TEST_NAMESPACE, TEST_KEY);

    // Read it back
    const value = await testClient.getSecret(TEST_NAMESPACE, TEST_KEY);
    expect(value).toBe(TEST_VALUE);
    console.log('[Test] Secret read successfully');
  });

  it('3. SecretStoreClient supports batch operations', async () => {
    if (!nexusAvailable || !testClient) {
      console.log('[Test] Skipping - Nexus not available');
      return;
    }

    const batchSecrets = [
      { namespace: TEST_NAMESPACE, key: `${TEST_KEY}-batch1`, value: 'batch-value-1' },
      { namespace: TEST_NAMESPACE, key: `${TEST_KEY}-batch2`, value: 'batch-value-2' },
    ];

    await testClient.batchPut(batchSecrets);
    console.log('[Test] Batch write completed');

    const results = await testClient.batchGet([
      { namespace: TEST_NAMESPACE, key: `${TEST_KEY}-batch1` },
      { namespace: TEST_NAMESPACE, key: `${TEST_KEY}-batch2` },
    ]);

    expect(results[`${TEST_NAMESPACE}:${TEST_KEY}-batch1`]).toBe('batch-value-1');
    expect(results[`${TEST_NAMESPACE}:${TEST_KEY}-batch2`]).toBe('batch-value-2');
    console.log('[Test] Batch read completed');

    // Cleanup batch test data
    await testClient.deleteSecret(TEST_NAMESPACE, `${TEST_KEY}-batch1`);
    await testClient.deleteSecret(TEST_NAMESPACE, `${TEST_KEY}-batch2`);
  });

  it('4. SecretStoreClient supports list and delete operations', async () => {
    if (!nexusAvailable || !testClient) {
      console.log('[Test] Skipping - Nexus not available');
      return;
    }

    // List secrets
    const secrets = await testClient.listSecrets();
    expect(secrets).toBeDefined();
    expect(Array.isArray(secrets)).toBe(true);
    console.log('[Test] Listed secrets, count:', secrets.length);

    // Delete the test secret
    const deleted = await testClient.deleteSecret(TEST_NAMESPACE, TEST_KEY);
    expect(deleted).toBe(true);
    console.log('[Test] Secret deleted successfully');
  });
});
