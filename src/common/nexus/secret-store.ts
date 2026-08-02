import { app, safeStorage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { IS_OFFLINE_BUILD } from '@/common/buildMode';
import { getNexusSecretClient, type NexusSecretClient, type SecretMetadata } from './nexus-secret-client';

export interface ISecretStore {
  initialize(): Promise<void>;
  putSecret(namespace: string, key: string, value: string, description?: string): SecretMetadata;
  getSecret(namespace: string, key: string, version?: number): string;
  deleteSecret(namespace: string, key: string): boolean;
  restoreSecret(namespace: string, key: string): boolean;
  listSecrets(namespace?: string, includeDeleted?: boolean): SecretMetadata[];
}

interface IStoredSecret extends SecretMetadata {
  value: string;
}

interface IEncryptedFile {
  version: 1;
  payload: string;
}

class NexusVaultSecretStore implements ISecretStore {
  constructor(private readonly client: NexusSecretClient) {}

  async initialize(): Promise<void> {}

  putSecret(namespace: string, key: string, value: string, description?: string): SecretMetadata {
    return this.client.putSecret(namespace, key, value, description);
  }

  getSecret(namespace: string, key: string, version?: number): string {
    return this.client.getSecret(namespace, key, version);
  }

  deleteSecret(namespace: string, key: string): boolean {
    return this.client.deleteSecret(namespace, key);
  }

  restoreSecret(namespace: string, key: string): boolean {
    return this.client.restoreSecret(namespace, key);
  }

  listSecrets(namespace?: string, includeDeleted?: boolean): SecretMetadata[] {
    return this.client.listSecrets(namespace, includeDeleted);
  }
}

export class LocalEncryptedSecretStore implements ISecretStore {
  private readonly entries = new Map<string, IStoredSecret>();
  private isInitialized = false;

  private get filePath(): string {
    return path.join(app.getPath('userData'), 'nexus-secrets.enc');
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    // 本地密钥库必须依赖操作系统提供的 safeStorage，不能降级成 Base64 或明文保存。
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('系统安全存储不可用，无法初始化本地 Nexus 密钥库');
    }
    // Linux 的 basic_text 后端没有真实加密能力，宁可阻止启动也不能静默保存敏感信息。
    if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') {
      throw new Error('系统密钥环不可用，拒绝使用明文后端保存凭据');
    }
    const backupPath = `${this.filePath}.bak`;
    // Windows 原子替换中断后可能只剩备份文件，主文件缺失时优先恢复备份。
    if (!fs.existsSync(this.filePath) && fs.existsSync(backupPath)) {
      fs.renameSync(backupPath, this.filePath);
    }
    if (fs.existsSync(this.filePath)) {
      let entries: IStoredSecret[];
      try {
        const file = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as IEncryptedFile;
        if (file.version !== 1 || typeof file.payload !== 'string') throw new Error('invalid envelope');
        entries = JSON.parse(safeStorage.decryptString(Buffer.from(file.payload, 'base64'))) as IStoredSecret[];
        if (!Array.isArray(entries) || entries.some((entry) => !entry || typeof entry.namespace !== 'string' || typeof entry.key !== 'string' || typeof entry.value !== 'string')) {
          throw new Error('invalid entries');
        }
      } catch {
        // 解密失败时绝不能用空密钥库覆盖原文件，否则会造成不可恢复的数据丢失。
        throw new Error('本地 Nexus 密钥库文件损坏或无法解密，请联系管理员恢复');
      }
      for (const entry of entries) this.entries.set(this.ref(entry.namespace, entry.key), entry);
      try {
        fs.rmSync(backupPath, { force: true });
      } catch {
        // 主文件已成功读取，残留备份清理失败不影响本次初始化。
      }
    }
    this.isInitialized = true;
  }

  putSecret(namespace: string, key: string, value: string, description?: string): SecretMetadata {
    this.assertInitialized();
    const now = Date.now();
    const ref = this.ref(namespace, key);
    const previous = this.entries.get(ref);
    const entry: IStoredSecret = {
      namespace,
      key,
      value,
      description,
      currentVersion: (previous?.currentVersion ?? 0) + 1,
      deleted: false,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
    this.entries.set(ref, entry);
    try {
      this.persist();
    } catch (error) {
      if (previous) this.entries.set(ref, previous);
      else this.entries.delete(ref);
      throw error;
    }
    return this.metadata(entry);
  }

  getSecret(namespace: string, key: string, version?: number): string {
    this.assertInitialized();
    const entry = this.entries.get(this.ref(namespace, key));
    if (!entry || entry.deleted) throw new Error(`Secret not found: ${namespace}/${key}`);
    if (version !== undefined && version !== entry.currentVersion) {
      throw new Error('本地 Nexus 密钥库不支持读取历史版本');
    }
    return entry.value;
  }

  deleteSecret(namespace: string, key: string): boolean {
    this.assertInitialized();
    const entry = this.entries.get(this.ref(namespace, key));
    if (!entry || entry.deleted) return false;
    const previousUpdatedAt = entry.updatedAt;
    entry.deleted = true;
    entry.updatedAt = Date.now();
    try {
      this.persist();
    } catch (error) {
      entry.deleted = false;
      entry.updatedAt = previousUpdatedAt;
      throw error;
    }
    return true;
  }

  restoreSecret(namespace: string, key: string): boolean {
    this.assertInitialized();
    const entry = this.entries.get(this.ref(namespace, key));
    if (!entry || !entry.deleted) return false;
    const previousUpdatedAt = entry.updatedAt;
    entry.deleted = false;
    entry.updatedAt = Date.now();
    try {
      this.persist();
    } catch (error) {
      entry.deleted = true;
      entry.updatedAt = previousUpdatedAt;
      throw error;
    }
    return true;
  }

  listSecrets(namespace?: string, includeDeleted = false): SecretMetadata[] {
    this.assertInitialized();
    return [...this.entries.values()].filter((entry) => (!namespace || entry.namespace === namespace) && (includeDeleted || !entry.deleted)).map((entry) => this.metadata(entry));
  }

  private assertInitialized(): void {
    if (!this.isInitialized) throw new Error('本地 Nexus 密钥库尚未初始化');
  }

  private ref(namespace: string, key: string): string {
    return `${namespace}\0${key}`;
  }

  private metadata(entry: IStoredSecret): SecretMetadata {
    const { value: _value, ...metadata } = entry;
    return metadata;
  }

  private persist(): void {
    const dir = path.dirname(this.filePath);
    // 始终先写临时文件再原子替换，避免进程中断留下半写入的密钥库。
    const tempPath = `${this.filePath}.tmp`;
    fs.mkdirSync(dir, { recursive: true });
    const payload = safeStorage.encryptString(JSON.stringify([...this.entries.values()])).toString('base64');
    fs.writeFileSync(tempPath, JSON.stringify({ version: 1, payload } satisfies IEncryptedFile), { mode: 0o600 });
    if (process.platform !== 'win32' || !fs.existsSync(this.filePath)) {
      fs.renameSync(tempPath, this.filePath);
      return;
    }

    // Windows 不能直接覆盖已存在文件，先保留旧文件，替换失败时立即回滚。
    const backupPath = `${this.filePath}.bak`;
    fs.rmSync(backupPath, { force: true });
    fs.renameSync(this.filePath, backupPath);
    try {
      fs.renameSync(tempPath, this.filePath);
    } catch (error) {
      fs.renameSync(backupPath, this.filePath);
      throw error;
    }
    try {
      fs.rmSync(backupPath, { force: true });
    } catch {
      // 新主文件已提交，备份清理只是善后，失败不能反向回滚内存状态。
    }
  }
}

let store: ISecretStore | null = null;
let initialization: Promise<void> | null = null;

export function getSecretStore(): ISecretStore {
  // 在线版继续使用 Nexus Vault；内网版仅替换存储后端，不移除上层凭据能力。
  if (!store) store = IS_OFFLINE_BUILD ? new LocalEncryptedSecretStore() : new NexusVaultSecretStore(getNexusSecretClient());
  return store;
}

export function initializeSecretStore(): Promise<void> {
  initialization ??= getSecretStore()
    .initialize()
    .catch((error) => {
      initialization = null;
      throw error;
    });
  return initialization;
}
