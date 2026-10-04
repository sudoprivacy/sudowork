import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getNexusSecretClient } from '../../src/common/nexus/nexus-secret-client';

let root: string;
vi.mock('electron', () => ({ app: { getPath: () => path.join(root, 'home'), getAppPath: () => path.join(root, 'app'), isPackaged: false } }));
vi.mock('@process/utils/mainLogger', () => ({ mainLog: console.log, mainWarn: console.warn, mainError: console.error }));

import { dynamicNexusVfsService } from '../../src/process/services/nexus-vfs/DynamicNexusVfsService';
import { isFuseLibraryAvailable } from '../../src/process/services/nexus-vfs/VaultPluginInstaller';
import { getFusePluginClient } from '../../src/process/services/nexus-vfs/FusePluginClient';

const suite = process.platform === 'darwin' && process.env.SUDOWORK_NO_FUSE_E2E === '1' ? describe : describe.skip;
suite('published runtime on a Mac without FUSE-T', () => {
  beforeAll(async () => {
    expect(isFuseLibraryAvailable(), 'Run before installing FUSE-T; a provisioned runner hides the regression').toBe(false);
    // Refuse to disturb another local daemon when running this test manually.
    const server = net.createServer();
    await new Promise<void>((resolve, reject) => server.once('error', reject).listen(12022, '127.0.0.1', resolve));
    await new Promise<void>((resolve) => server.close(() => resolve()));
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-no-fuse-'));
    vi.stubEnv('NEXUS_IDENTITY_DIR', path.join(root, 'identity'));
    vi.stubEnv('NEXUS_PEERS', '');
    execFileSync(process.execPath, [path.resolve(__dirname, '../../scripts/download-nexus-vfs.js'), '--force'], {
      env: { ...process.env, SUDOWORK_NEXUS_INSTALL_ROOT: path.join(root, 'home/.nexus-vfs'), SUDOWORK_NEXUS_RESOURCES_DIR: path.join(root, 'app/resources') },
      stdio: 'inherit',
      timeout: 240_000,
    });
  }, 300_000);

  afterAll(async () => {
    if (root) {
      await dynamicNexusVfsService.stop();
      fs.rmSync(root, { recursive: true, force: true });
    }
    vi.unstubAllEnvs();
  });

  it('starts core services, preserves secrets across repair, and reports the optional mount prerequisite', async () => {
    const plugin = path.join(root, 'home/.nexus-vfs/plugins/libnexus_fuse_plugin.dylib');
    expect(fs.existsSync(plugin), 'Exercise a plugin left behind by the previous app').toBe(true);
    await dynamicNexusVfsService.installAndStart();
    expect(dynamicNexusVfsService.isRunning).toBe(true);
    expect(fs.existsSync(plugin)).toBe(false);
    expect((await getFusePluginClient().getStatus()).status).toBe('fuse-t-missing');
    const secrets = getNexusSecretClient();
    await secrets.putSecret('clean-install-acceptance', 'persisted', 'test value');
    await dynamicNexusVfsService.stop();
    dynamicNexusVfsService.removeInstallation();
    expect(dynamicNexusVfsService.checkInstalledSync()).toBe(false);
    await dynamicNexusVfsService.installAndStart();
    expect(await secrets.getSecret('clean-install-acceptance', 'persisted')).toBe('test value');
    expect(fs.existsSync(plugin)).toBe(false);
    await secrets.deleteSecret('clean-install-acceptance', 'persisted');
  }, 120_000);
});
