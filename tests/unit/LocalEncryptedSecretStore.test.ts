import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ userData: '', isEncryptionFailure: false }));

vi.mock('electron', () => ({
  app: { getPath: () => state.userData },
  safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'keychain',
    encryptString: (value: string) => {
      if (state.isEncryptionFailure) throw new Error('encryption failed');
      return Buffer.from(`encrypted:${value}`, 'utf-8');
    },
    decryptString: (value: Buffer) => value.toString('utf-8').replace(/^encrypted:/, ''),
  },
}));

vi.mock('@/common/buildMode', () => ({ IS_OFFLINE_BUILD: true }));

describe('LocalEncryptedSecretStore', () => {
  beforeEach(() => {
    state.userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sudowork-secret-store-'));
    state.isEncryptionFailure = false;
  });

  afterEach(() => {
    fs.rmSync(state.userData, { recursive: true, force: true });
  });

  it('persists encrypted secrets and restores them after restart', async () => {
    const { LocalEncryptedSecretStore } = await import('@/common/nexus/secret-store');
    const first = new LocalEncryptedSecretStore();
    await first.initialize();
    first.putSecret('provider:test', 'api_key', 'top-secret');

    const filePath = path.join(state.userData, 'nexus-secrets.enc');
    const file = fs.readFileSync(filePath, 'utf-8');
    expect(file).not.toContain('top-secret');
    expect(file).not.toContain('provider:test');

    const second = new LocalEncryptedSecretStore();
    await second.initialize();
    expect(second.getSecret('provider:test', 'api_key')).toBe('top-secret');
  });

  it('rolls back memory when persistence fails', async () => {
    const { LocalEncryptedSecretStore } = await import('@/common/nexus/secret-store');
    const store = new LocalEncryptedSecretStore();
    await store.initialize();
    state.isEncryptionFailure = true;

    expect(() => store.putSecret('provider:test', 'api_key', 'not-persisted')).toThrow('encryption failed');
    expect(() => store.getSecret('provider:test', 'api_key')).toThrow('Secret not found');
  });

  it('recovers an interrupted Windows-style replacement from the backup', async () => {
    const { LocalEncryptedSecretStore } = await import('@/common/nexus/secret-store');
    const first = new LocalEncryptedSecretStore();
    await first.initialize();
    first.putSecret('provider:test', 'api_key', 'recover-me');
    const filePath = path.join(state.userData, 'nexus-secrets.enc');
    fs.renameSync(filePath, `${filePath}.bak`);

    const second = new LocalEncryptedSecretStore();
    await second.initialize();
    expect(second.getSecret('provider:test', 'api_key')).toBe('recover-me');
    expect(fs.existsSync(`${filePath}.bak`)).toBe(false);
  });

  it('does not report corruption when stale backup cleanup fails', async () => {
    const { LocalEncryptedSecretStore } = await import('@/common/nexus/secret-store');
    const first = new LocalEncryptedSecretStore();
    await first.initialize();
    first.putSecret('provider:test', 'api_key', 'keep-reading');
    const backupPath = path.join(state.userData, 'nexus-secrets.enc.bak');
    fs.writeFileSync(backupPath, 'stale');
    const originalRmSync = fs.rmSync;
    const rmSync = vi.spyOn(fs, 'rmSync').mockImplementation((target, options) => {
      if (target === backupPath) throw new Error('locked');
      return originalRmSync(target, options);
    });

    try {
      const second = new LocalEncryptedSecretStore();
      await second.initialize();
      expect(second.getSecret('provider:test', 'api_key')).toBe('keep-reading');
    } finally {
      rmSync.mockRestore();
    }
  });

  it('reports a damaged encrypted store clearly without overwriting it', async () => {
    const { LocalEncryptedSecretStore } = await import('@/common/nexus/secret-store');
    const filePath = path.join(state.userData, 'nexus-secrets.enc');
    fs.writeFileSync(filePath, '{damaged');
    const store = new LocalEncryptedSecretStore();

    await expect(store.initialize()).rejects.toThrow('本地 Nexus 密钥库文件损坏或无法解密');
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('{damaged');
  });

  it('supports soft delete and restore', async () => {
    const { LocalEncryptedSecretStore } = await import('@/common/nexus/secret-store');
    const store = new LocalEncryptedSecretStore();
    await store.initialize();
    store.putSecret('service:test', 'token', 'value');

    expect(store.deleteSecret('service:test', 'token')).toBe(true);
    expect(() => store.getSecret('service:test', 'token')).toThrow('Secret not found');
    expect(store.listSecrets('service:test')).toEqual([]);
    expect(store.listSecrets('service:test', true)[0]?.deleted).toBe(true);

    expect(store.restoreSecret('service:test', 'token')).toBe(true);
    expect(store.getSecret('service:test', 'token')).toBe('value');
  });
});
