import { mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getShareoneApiKeyEnterprise: vi.fn() }));
vi.mock('@process/services/shareoneCli/shareoneCredentials', () => mocks);
vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '/mock-app' } }));
vi.mock('@process/utils/mainLogger', () => ({ mainLog: vi.fn(), mainWarn: vi.fn() }));
vi.mock('@process/utils/shellEnv', () => ({
  getEnhancedEnv: () => ({ PATH: '/usr/bin' }),
  findSuitableNodeBin: vi.fn(),
  resolveNpxPath: vi.fn(() => 'npx'),
}));
vi.mock('@process/services/safety/SafetyPollingService', () => ({ isSafetyHookEnabled: () => false }));
vi.mock('@process/services/ffmpeg/FfmpegRuntimeService', () => ({ getFfmpegBinDir: () => null, getFfmpegBinaryPath: () => null }));
vi.mock('@process/services/scode/scodePaths', () => ({
  SCODE_CONFIG_HOME: '/missing-scode-config',
  SCODE_CONFIG_PATH: '/missing-scode-config/sudocode.json',
  SCODE_SETTINGS_PATH: '/missing-scode-config/settings.json',
}));
vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('child_process')>()),
  execFileSync: vi.fn(() => 'v22.22.0'),
}));

import { buildGenericSpawnSpec } from '@/agent/acp/acpConnectors';

describe('scode ShareOne environment', () => {
  let workspace: string;
  const customEnv = { IMAGE_MODEL: 'test-image', CLAUDE_CODE_OAUTH_TOKEN: 'test-oauth' };

  beforeEach(() => {
    workspace = mkdtempSync(path.join(os.tmpdir(), 'scode-shareone-env-'));
    mocks.getShareoneApiKeyEnterprise.mockReset().mockResolvedValue('enterprise-shareone-key');
  });

  afterEach(() => rmSync(workspace, { recursive: true, force: true }));

  it('passes the enterprise key to the spawn spec shared by local and tunnel sessions', async () => {
    const spec = await buildGenericSpawnSpec('scode', '/opt/scode', workspace, ['acp'], customEnv);

    expect(spec.env.SHAREONE_API_KEY).toBe('enterprise-shareone-key');
    expect(spec.args).not.toContain('enterprise-shareone-key');
    expect(customEnv).not.toHaveProperty('SHAREONE_API_KEY');
  });

  it('preserves an explicitly configured subprocess key', async () => {
    const spec = await buildGenericSpawnSpec('scode', '/opt/scode', workspace, ['acp'], { ...customEnv, SHAREONE_API_KEY: 'explicit-key' });

    expect(spec.env.SHAREONE_API_KEY).toBe('explicit-key');
    expect(mocks.getShareoneApiKeyEnterprise).not.toHaveBeenCalled();
  });

  it('starts sessions normally when no ShareOne key is configured', async () => {
    mocks.getShareoneApiKeyEnterprise.mockResolvedValue(null);
    const spec = await buildGenericSpawnSpec('scode', '/opt/scode', workspace, ['acp'], customEnv);

    expect(spec.env.SHAREONE_API_KEY).toBeUndefined();
  });

  it('does not fetch this credential for unrelated backends', async () => {
    const spec = await buildGenericSpawnSpec('goose', '/opt/goose', workspace, ['acp'], customEnv);

    expect(spec.env.SHAREONE_API_KEY).toBeUndefined();
    expect(mocks.getShareoneApiKeyEnterprise).not.toHaveBeenCalled();
  });
});
