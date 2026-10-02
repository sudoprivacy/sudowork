/**
 * Published artifacts -> production installers -> signed plugin load -> real
 * vault RPCs -> restart -> read/update/delete. No daemon or network substitutes.
 * Run locally with SUDOWORK_RUNTIME_E2E=1; CI runs the same isolated workflow.
 */
import { execFileSync, spawn, type ChildProcess } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { stripVTControlCharacters } from 'util';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { NexusVfsClient } from '@nexus-ai-fs/vfs-client';
import { NexusSecretClient } from '../../src/common/nexus/nexus-secret-client';
import type { Nexus } from '../../src/common/nexus/nexus-vfs-client';
import versions from '../../src/shared/runtime-versions.json';

let root: string;
// Supply only Electron's filesystem locations and logging. Installers, HTTP,
// archive extraction, checksums, filesystem, daemon, and RPC clients stay real.
vi.mock('electron', () => ({ app: { getPath: () => path.join(root, 'home'), getAppPath: () => path.join(root, 'app'), isPackaged: false } }));
vi.mock('@process/utils/mainLogger', () => ({ mainLog: console.log, mainWarn: console.warn, mainError: console.error }));

const desktopRoot = path.resolve(__dirname, '../..');
const isLegacyUpgradeEnabled = process.env.SUDOWORK_RUNTIME_LEGACY_E2E === '1';
const suite = process.env.SUDOWORK_RUNTIME_E2E === '1' || isLegacyUpgradeEnabled ? describe : describe.skip;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { expectedPluginsFor } = require('../../scripts/expected-plugin-set.js') as {
  expectedPluginsFor: (platform: string, arch: string) => Array<{ name: string; dylib: string; artifact: string }>;
};

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

suite('published runtime installation and persistence', () => {
  let installRoot: string;
  let resources: string;
  let binary: string;
  let daemon: ChildProcess | undefined;
  let rpc: NexusVfsClient | undefined;
  let secrets: NexusSecretClient;
  let daemonLog = '';
  const plugins = expectedPluginsFor(process.platform, process.arch);

  async function stop(): Promise<void> {
    rpc?.close();
    rpc = undefined;
    if (daemon && daemon.exitCode === null && daemon.signalCode === null) {
      const proc = daemon;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          proc.kill('SIGKILL');
          reject(new Error('Daemon did not exit within 10 seconds'));
        }, 10_000);
        proc.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
        proc.kill('SIGTERM');
      });
    }
    daemon = undefined;
  }

  async function boot(cluster = binary, pluginDir = path.join(installRoot, 'plugins'), dataDir = path.join(installRoot, 'data')): Promise<void> {
    const port = await freePort();
    daemonLog = '';
    daemon = spawn(cluster, ['serve-local', '--port', String(port), '--hostname', 'localhost', '--data-dir', dataDir, '--plugin-dir', pluginDir], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, NEXUS_DATA_DIR: dataDir, NEXUS_IDENTITY_DIR: path.join(dataDir, '..', 'identity'), NEXUS_PEERS: '', RUST_LOG: 'info,kernel::kernel::plugins=debug' },
    });
    let spawnError: Error | undefined;
    daemon.on('error', (error) => {
      spawnError = error;
    });
    for (const stream of [daemon.stdout!, daemon.stderr!])
      stream.on('data', (chunk: Buffer) => {
        daemonLog = (daemonLog + stripVTControlCharacters(chunk.toString())).slice(-40_000);
      });
    // The client applies connectTimeoutMs to every unary RPC. Vault writes
    // include durable disk I/O, so use the production deadline after startup.
    rpc = new NexusVfsClient(`127.0.0.1:${port}`);
    const client = rpc;
    secrets = new NexusSecretClient({ callBinary: (method: string, payload: Buffer) => client.callBinary(method, payload, '') } as Nexus);
    const deadline = Date.now() + 30_000;
    let lastError: unknown;
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      if (daemon.exitCode !== null) throw new Error(`Daemon exited: ${daemonLog}`);
      try {
        expect((await rpc.serverInfo('')).zone_id).toBe('root');
        await secrets.listSecrets();
        return;
      } catch (error) {
        lastError = error;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Daemon/vault readiness failed: ${String(lastError)}\n${daemonLog}`);
  }

  beforeAll(() => {
    expect(
      plugins.some((plugin) => plugin.name === 'nexus_vault'),
      'This live gate requires a published vault plugin'
    ).toBe(true);
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'sudowork-runtime-e2e-'));
    installRoot = path.join(root, 'home', '.nexus-vfs');
    resources = path.join(root, 'app', 'resources');
    execFileSync(process.execPath, [path.join(desktopRoot, 'scripts/download-nexus-vfs.js'), '--force'], {
      env: { ...process.env, SUDOWORK_NEXUS_INSTALL_ROOT: installRoot, SUDOWORK_NEXUS_RESOURCES_DIR: resources },
      stdio: 'inherit',
      timeout: 240_000,
      windowsHide: true,
    });
    binary = path.join(installRoot, 'bin', process.platform === 'win32' ? 'nexusd-cluster.exe' : 'nexusd-cluster');
    expect(fs.readFileSync(path.join(installRoot, 'bin/.nexus-vfs-bin-ready'), 'utf8')).toBe(versions['nexusd-cluster']);
    const banner = execFileSync(binary, ['--version'], { encoding: 'utf8', windowsHide: true });
    expect(banner).toContain(`v${versions['nexusd-cluster']}`);
    expect(banner).toContain('plugin-abi 7');
    for (const plugin of plugins) {
      expect(fs.statSync(path.join(installRoot, 'plugins', plugin.dylib)).size).toBeGreaterThan(100_000);
      expect(fs.statSync(path.join(installRoot, 'plugins', `${plugin.dylib}.sig`)).size).toBe(64);
    }
  }, 300_000);

  afterEach(stop);

  afterAll(async () => {
    await stop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it('loads verified plugins, persists a secret across restart, then rotates and deletes it', async () => {
    await boot();
    expect(daemonLog.match(/plugin signature verified/g)).toHaveLength(plugins.length);
    expect(daemonLog).not.toMatch(/plugin API version mismatch|signature did not verify|failed to load/);
    const serviceNames: Record<string, string> = { nexus_vault: 'password-vault', nexus_local_connector: 'local-connector', nexus_fuse_plugin: 'fuse' };
    for (const plugin of plugins) expect(daemonLog).toMatch(new RegExp(`plugin loaded[^\\n]*name="${serviceNames[plugin.name]}"`));
    const namespace = `migration:${randomUUID()}`;
    const key = 'CON:credential'; // Exercises the upstream portable-path fix on Windows.
    const value = randomUUID();
    const created = await secrets.putSecret(namespace, key, value, 'release migration');
    expect(created.currentVersion).toBe(1);
    expect(await secrets.getSecret(namespace, key)).toBe(value);
    await stop();
    expect(fs.readdirSync(path.join(installRoot, 'data')).length).toBeGreaterThan(0);
    await boot();
    expect(await secrets.getSecret(namespace, key)).toBe(value);
    const nextValue = `${await secrets.getSecret(namespace, key)}-rotated`;
    expect((await secrets.putSecret(namespace, key, nextValue)).currentVersion).toBe(2);
    expect(await secrets.getSecret(namespace, key)).toBe(nextValue);
    expect(await secrets.getSecret(namespace, key, 1)).toBe(value);
    expect(await secrets.deleteSecret(namespace, key)).toBe(true);
    await expect(secrets.getSecret(namespace, key)).rejects.toThrow();
    await stop();
  }, 90_000);

  it('replaces stale markers through the production packaged-app installers', async () => {
    const { dynamicNexusVfsService } = await import('../../src/process/services/nexus-vfs/DynamicNexusVfsService');
    const marker = path.join(installRoot, 'bin/.nexus-vfs-bin-ready');
    const pluginMarkers = plugins.map((plugin) => path.join(installRoot, 'plugins', `.${plugin.name.replaceAll('_', '-')}-ready`));
    fs.writeFileSync(marker, '0.1.5');
    for (const pluginMarker of pluginMarkers) fs.writeFileSync(pluginMarker, 'old-version');
    expect(dynamicNexusVfsService.checkInstalledSync()).toBe(false);
    // The first install uses the versioned resources staged by the build script.
    await dynamicNexusVfsService.install();
    expect(dynamicNexusVfsService.checkInstalledSync()).toBe(true);
    for (const plugin of plugins) {
      const versionKey = plugin.name.replaceAll('_', '-');
      expect(fs.readFileSync(path.join(installRoot, 'plugins', `.${versionKey}-ready`), 'utf8')).toBe((versions as Record<string, string>)[versionKey]);
    }
    // Remove only our staged archives; exercise the real remote fallback too.
    for (const entry of fs.readdirSync(resources)) fs.unlinkSync(path.join(resources, entry));
    fs.writeFileSync(marker, '0.1.5');
    for (const pluginMarker of pluginMarkers) fs.writeFileSync(pluginMarker, 'old-version');
    await dynamicNexusVfsService.install();
    expect(dynamicNexusVfsService.checkInstalledSync()).toBe(true);
    for (const plugin of plugins) {
      const versionKey = plugin.name.replaceAll('_', '-');
      expect(fs.readFileSync(path.join(installRoot, 'plugins', `.${versionKey}-ready`), 'utf8')).toBe((versions as Record<string, string>)[versionKey]);
    }
    await boot();
    const value = randomUUID();
    await secrets.putSecret('reinstalled', 'token', value);
    expect(await secrets.getSecret('reinstalled', 'token')).toBe(value);
    await stop();
  }, 240_000);

  it.skipIf(!isLegacyUpgradeEnabled)(
    'reads and rotates a secret written by the previous published runtime',
    async () => {
      const legacyBinary = process.env.SUDOWORK_LEGACY_CLUSTER_BIN;
      const legacyVaultArchive = process.env.SUDOWORK_LEGACY_VAULT_ARCHIVE;
      if (!legacyBinary || !legacyVaultArchive) throw new Error('Legacy upgrade requires SUDOWORK_LEGACY_CLUSTER_BIN and SUDOWORK_LEGACY_VAULT_ARCHIVE');
      const banner = execFileSync(legacyBinary, ['--version'], { encoding: 'utf8', timeout: 10_000, windowsHide: true });
      expect(banner).toContain('v0.1.5');
      expect(banner).toContain('plugin-abi 6');
      // Archive digests from the previous runtime pin (vault 0.5.56).
      const legacyDigests: Record<string, string> = {
        'win32-x64': 'd3793400979ecb508c28a57610a5022089815bab2333777e2d547145f290e3e6',
        'linux-x64': '93bb9c7744f1711a570bb309848b37769d9a8a7883c83d8a30ef407f97d73833',
      };
      const expectedDigest = legacyDigests[`${process.platform}-${process.arch}`];
      expect(expectedDigest, 'Legacy fixture supports Windows/Linux x64').toBeTruthy();
      expect(createHash('sha256').update(fs.readFileSync(legacyVaultArchive)).digest('hex')).toBe(expectedDigest);
      const legacyPlugins = path.join(root, 'legacy-plugins');
      fs.mkdirSync(legacyPlugins);
      execFileSync('tar', ['-xf', legacyVaultArchive, '-C', legacyPlugins], { timeout: 30_000, windowsHide: true });

      const namespace = `upgrade-${randomUUID()}`;
      const value = randomUUID();
      const legacyDataDir = path.join(root, 'legacy-state', 'data');
      await boot(legacyBinary, legacyPlugins, legacyDataDir);
      expect(daemonLog).not.toMatch(/plugin API version mismatch|signature did not verify|failed to load/);
      expect((await secrets.putSecret(namespace, 'token', value)).currentVersion).toBe(1);
      expect(await secrets.getSecret(namespace, 'token')).toBe(value);
      await stop();
      // Reuse the old daemon's actual data and identity directories unchanged.
      await boot(binary, path.join(installRoot, 'plugins'), legacyDataDir);
      expect(await secrets.getSecret(namespace, 'token')).toBe(value);
      expect((await secrets.putSecret(namespace, 'token', `${value}-upgraded`)).currentVersion).toBe(2);
      await stop();
      await boot(binary, path.join(installRoot, 'plugins'), legacyDataDir);
      expect(await secrets.getSecret(namespace, 'token')).toBe(`${value}-upgraded`);
      expect(await secrets.getSecret(namespace, 'token', 1)).toBe(value);
      expect(await secrets.deleteSecret(namespace, 'token')).toBe(true);
      await stop();
    },
    120_000
  );
});
