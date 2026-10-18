import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ScodeServiceClient } from '../../src/common/scode/serviceClient';
import { ScodeSecretsClient } from '../../src/common/scode/secretsClient';
import { recordRuntimeEvidence } from './runtimeEvidence';

const isLive = process.env.SUDOWORK_RUNTIME_E2E === '1';
const executable = process.env.SCODE_BIN;
const namespace = `acceptance:${randomUUID()}`;
const body = Buffer.from(`durable-content-中文-${randomUUID()}`);
const secret = `synthetic-value-${randomUUID()}`;
let root: string;
let first: ScodeServiceClient;
let second: ScodeServiceClient;
let vault: ScodeSecretsClient;
let originalRoot: string | undefined;
let originalConfig: string | undefined;
let originalLog: string | undefined;

/** Actual desktop adapters -> Scode process channel -> signed runtime -> encrypted Vault. */
describe.skipIf(!isLive)('Sudocode shared services using published runtime artifacts', () => {
  afterEach(() => recordRuntimeEvidence(root, 'vault'));
  beforeAll(async () => {
    if (!executable || !fs.existsSync(executable)) throw new Error('SCODE_BIN must name the actual tested CLI');
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'sudowork-scode-service-'));
    originalRoot = process.env.SCODE_SERVICE_ROOT;
    originalConfig = process.env.SUDO_CODE_CONFIG_HOME;
    originalLog = process.env.RUST_LOG;
    process.env.SCODE_SERVICE_ROOT = root;
    process.env.SUDO_CODE_CONFIG_HOME = path.join(root, 'config');
    process.env.RUST_LOG = 'info';
    first = new ScodeServiceClient(() => executable);
    second = new ScodeServiceClient(() => executable);
    vault = new ScodeSecretsClient(() => first);
    await first.request('service.install', {}, 600_000);
  }, 660_000);

  afterAll(async () => {
    if (second) await second.request('service.shutdown').catch(() => undefined);
    first?.close();
    second?.close();
    if (originalRoot === undefined) delete process.env.SCODE_SERVICE_ROOT;
    else process.env.SCODE_SERVICE_ROOT = originalRoot;
    if (originalConfig === undefined) delete process.env.SUDO_CODE_CONFIG_HOME;
    else process.env.SUDO_CODE_CONFIG_HOME = originalConfig;
    if (originalLog === undefined) delete process.env.RUST_LOG;
    else process.env.RUST_LOG = originalLog;
  });

  it('shares one actual Nexus daemon between concurrent frontend starts', async () => {
    const [a, b] = await Promise.all([first.request<{ nexusPid: number; instance: string }>('service.start'), second.request<{ nexusPid: number; instance: string }>('service.start')]);
    expect(a.nexusPid).toBeGreaterThan(0);
    expect(a.nexusPid).toBe(b.nexusPid);
    expect(a.instance).toBe(b.instance);
    const installation = await first.request<{ plugins: string[] }>('service.checkInstalled');
    expect(installation.plugins.length).toBeGreaterThan(0);
    await expect
      .poll(
        () => {
          const log = fs.readFileSync(path.join(root, 'run', 'runtime.log'), 'utf8');
          return installation.plugins.filter((plugin) => !log.includes(plugin));
        },
        { timeout: 5000 }
      )
      .toEqual([]);
  }, 60_000);

  it('persists versions, keeps values out of metadata and restores deleted secrets', async () => {
    await vault.putSecret(namespace, 'sample', secret);
    await vault.putSecret(namespace, 'sample', `${secret}-rotated`);
    const otherVault = new ScodeSecretsClient(() => second);
    expect(await otherVault.getSecret(namespace, 'sample')).toBe(`${secret}-rotated`);
    expect(await vault.getSecret(namespace, 'sample', 1)).toBe(secret);
    expect(await vault.listVersions(namespace, 'sample')).toHaveLength(2);
    expect(JSON.stringify(await vault.listSecrets(namespace))).not.toContain(secret);
    expect(await vault.deleteSecret(namespace, 'sample')).toBe(true);
    await expect(otherVault.getSecret(namespace, 'sample')).rejects.toThrow('does not exist');
    expect(await otherVault.restoreSecret(namespace, 'sample')).toBe(true);
    expect(await vault.getSecret(namespace, 'sample')).toBe(`${secret}-rotated`);
    await first.request('files.mkdir', { path: '/acceptance/body' });
    await first.request('files.write', { path: '/acceptance/body/content', data: body.toString('base64') });
    expect(Buffer.from(await second.request<string>('files.read', { path: '/acceptance/body/content' }), 'base64')).toEqual(body);
  }, 60_000);

  it('continues after a frontend closes and restores durable data after service restart', async () => {
    first.close();
    expect((await second.request<{ running: boolean }>('service.status')).running).toBe(true);
    await second.request('service.shutdown');
    second.close();
    second = new ScodeServiceClient(() => executable!);
    await second.request('service.start');
    const recovered = new ScodeSecretsClient(() => second);
    expect(await recovered.getSecret(namespace, 'sample')).toBe(`${secret}-rotated`);
    expect(Buffer.from(await second.request<string>('files.read', { path: '/acceptance/body/content' }), 'base64')).toEqual(body);
  }, 60_000);
});
