import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isEnterpriseMode: vi.fn(),
  getUserId: vi.fn(),
  getMossServerUrl: vi.fn(),
  getValidToken: vi.fn(),
  getSecret: vi.fn(),
  client: vi.fn(),
  mainLog: vi.fn(),
  mainWarn: vi.fn(),
}));

vi.mock('@/common/enterpriseDebugConfig', () => ({
  isEnterpriseMode: mocks.isEnterpriseMode,
  getUserId: mocks.getUserId,
  getMossServerUrl: mocks.getMossServerUrl,
}));
vi.mock('@process/bridge/eeclawBridge', () => ({ getValidToken: mocks.getValidToken }));
vi.mock('@sudowork/common/nexus/moss-secret-client', () => ({
  MossSecretClient: class {
    constructor(...args: unknown[]) {
      mocks.client(...args);
    }

    getSecret = mocks.getSecret;
  },
}));
vi.mock('@process/utils/mainLogger', () => ({ mainLog: mocks.mainLog, mainWarn: mocks.mainWarn }));

import { getShareoneApiKeyEnterprise } from '@process/services/shareoneCli/shareoneCredentials';

describe('enterprise ShareOne credentials', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.isEnterpriseMode.mockReturnValue(true);
    mocks.getUserId.mockReturnValue('user-a');
    mocks.getMossServerUrl.mockReturnValue('https://moss.example');
    mocks.getValidToken.mockResolvedValue('refreshed-token');
    mocks.getSecret.mockResolvedValue(null);
  });

  it('reads the current user key with a refreshed login token', async () => {
    mocks.getSecret.mockResolvedValue('  private-shareone-key  ');

    await expect(getShareoneApiKeyEnterprise()).resolves.toBe('private-shareone-key');
    expect(mocks.client).toHaveBeenCalledWith('https://moss.example', 'refreshed-token', 'user-a');
    expect(mocks.getSecret).toHaveBeenCalledWith('user:user-a:shareone', 'shareone_key');
    expect(JSON.stringify(mocks.mainLog.mock.calls)).not.toContain('private-shareone-key');
  });

  it('keeps consumer sessions on their existing credential path', async () => {
    mocks.isEnterpriseMode.mockReturnValue(false);

    await expect(getShareoneApiKeyEnterprise()).resolves.toBeNull();
    expect(mocks.getValidToken).not.toHaveBeenCalled();
    expect(mocks.getSecret).not.toHaveBeenCalled();
  });

  it('supports older credential field names', async () => {
    mocks.getSecret.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce('legacy-key');

    await expect(getShareoneApiKeyEnterprise()).resolves.toBe('legacy-key');
    expect(mocks.getSecret.mock.calls.map((call) => call[1])).toEqual(['shareone_key', 'api_key', 'X-API-Key']);
  });

  it('does not reuse keys across users or servers', async () => {
    mocks.getSecret.mockResolvedValueOnce('first-key').mockResolvedValueOnce('second-key');
    await expect(getShareoneApiKeyEnterprise()).resolves.toBe('first-key');

    mocks.getUserId.mockReturnValue('user-b');
    mocks.getMossServerUrl.mockReturnValue('https://other-moss.example');
    await expect(getShareoneApiKeyEnterprise()).resolves.toBe('second-key');
    expect(mocks.client).toHaveBeenLastCalledWith('https://other-moss.example', 'refreshed-token', 'user-b');
    expect(mocks.getSecret).toHaveBeenLastCalledWith('user:user-b:shareone', 'shareone_key');
  });

  it('discards an in-flight result after an account switch', async () => {
    mocks.getSecret.mockImplementation(async () => {
      mocks.getUserId.mockReturnValue('user-b');
      return 'previous-user-key';
    });

    await expect(getShareoneApiKeyEnterprise()).resolves.toBeNull();
  });

  it('allows normal chat when the optional credential service is unavailable', async () => {
    mocks.getSecret.mockRejectedValue(new Error('Service unavailable'));

    await expect(getShareoneApiKeyEnterprise()).resolves.toBeNull();
    expect(mocks.mainWarn).toHaveBeenCalled();
  });

  it('does not request secrets when the login cannot be refreshed', async () => {
    mocks.getValidToken.mockRejectedValue(new Error('AUTH_REQUIRED'));

    await expect(getShareoneApiKeyEnterprise()).resolves.toBeNull();
    expect(mocks.getSecret).not.toHaveBeenCalled();
  });
});
