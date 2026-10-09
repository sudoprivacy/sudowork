import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getServerUrl, getRendererServerUrl } = vi.hoisted(() => ({
  getServerUrl: vi.fn(() => 'https://managed.example.test'),
  getRendererServerUrl: vi.fn(() => new Promise<string>(() => {})),
}));

vi.mock('@process/initStorage', () => ({ getSudoworkServerBaseUrlSync: getServerUrl }));
vi.mock('@sudowork/common/sudoworkServer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@sudowork/common/sudoworkServer')>()),
  getSudoworkServerBaseUrl: getRendererServerUrl,
}));
vi.mock('@process/utils/mainLogger', () => ({ mainLog: vi.fn(), mainError: vi.fn() }));

import { getCosReleaseBase, isVersionUpdateEnabled, setSystemConfigCache } from '@sudowork/common/systemConfig';
import { ensureMainSystemConfig } from '@process/services/systemConfigBootstrap';

describe('Startup update configuration before the renderer is ready', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSystemConfigCache(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setSystemConfigCache(null);
  });

  it('loads the managed update policy without waiting for the renderer storage bridge', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: { version_update: { enabled: 1, cos_domain: 'updates.example.test' } } })));
    vi.stubGlobal('fetch', fetchMock);

    await ensureMainSystemConfig();

    expect(getRendererServerUrl).not.toHaveBeenCalled();
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://managed.example.test/api/v1/system-config');
    expect(isVersionUpdateEnabled()).toBe(true);
    expect(getCosReleaseBase()).toBe('https://updates.example.test');
  });

  it('honors an explicit server policy disabling automatic updates', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: { version_update: { enabled: 0 } } }))));

    await ensureMainSystemConfig();

    expect(isVersionUpdateEnabled()).toBe(false);
    expect(getRendererServerUrl).not.toHaveBeenCalled();
  });

  it('keeps the cached update policy when a startup refresh cannot reach the server', async () => {
    setSystemConfigCache({ version_update: { enabled: 0 } });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Connection unavailable')));

    await ensureMainSystemConfig();

    expect(isVersionUpdateEnabled()).toBe(false);
  });
});
