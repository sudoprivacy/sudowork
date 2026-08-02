import fs from 'fs';
import { afterAll, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ home: `/tmp/sudowork-scode-offline-${process.pid}` }));

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, default: { ...actual, homedir: () => state.home }, homedir: () => state.home };
});
vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '/missing-sudowork-app' } }));
vi.mock('@process/utils/mainLogger', () => ({ mainLog: vi.fn(), mainWarn: vi.fn(), mainError: vi.fn() }));

import { ensureScodeInstalled } from '@/process/services/scode/ScodeInstallService';

describe('ScodeInstallService offline resources', () => {
  afterAll(() => fs.rmSync(state.home, { recursive: true, force: true }));

  it('throws immediately when the bundled archive is missing', async () => {
    await expect(ensureScodeInstalled({ forceReinstall: true })).rejects.toThrow('内网安装包缺少 Sudocode');
  });
});
