import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  config: new Map<string, unknown>(),
  initializeStore: vi.fn(),
  preload: vi.fn(),
}));

vi.mock('@/channels/utils/credentialCrypto', () => ({ decryptCredentials: (value: unknown) => value }));
vi.mock('@process/database/export', () => ({ getDatabase: () => ({ getAssistantPluginsForMigration: () => [] }) }));
vi.mock('@/webserver/auth/repository/UserRepository', () => ({ UserRepository: { listUsers: () => [] } }));
vi.mock('@process/initStorage', () => ({
  ProcessConfig: {
    get: (key: string) => Promise.resolve(state.config.get(key)),
    set: (key: string, value: unknown) => {
      state.config.set(key, value);
      return Promise.resolve();
    },
  },
}));
vi.mock('@/common/nexus/secret-cache', () => ({
  secretCache: { initialize: vi.fn(), preload: state.preload },
  markMigrated: vi.fn(),
}));
vi.mock('@/common/nexus/secret-store', () => ({
  initializeSecretStore: state.initializeStore,
  getSecretStore: () => ({ putSecret: vi.fn(), getSecret: vi.fn(), listSecrets: vi.fn(() => []) }),
}));
vi.mock('@/common/nexus/config', () => ({ resolveConfig: () => ({ baseUrl: 'http://127.0.0.1:12022' }) }));

import { initializeSecrets } from '@/common/nexus/secret-migration';

describe('offline secret migration', () => {
  beforeEach(() => {
    state.config.clear();
    state.config.set('model.config', []);
    state.config.set('acp.config', {});
    vi.clearAllMocks();
  });

  afterEach(() => vi.restoreAllMocks());

  it('migrates to the local store without probing Nexus health', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await initializeSecrets();

    expect(state.initializeStore).toHaveBeenCalledOnce();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(state.config.get('local_secret_migration_version')).toBe('1');
    expect(state.preload).toHaveBeenCalledOnce();
  });
});
