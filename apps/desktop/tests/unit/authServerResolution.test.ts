import { beforeEach, describe, expect, it, vi } from 'vitest';

let configValues: Record<string, string | boolean | undefined> = {};

vi.mock('@sudowork/common/storage', () => ({
  ConfigStorage: {
    get: vi.fn(async (key: string) => configValues[key]),
    set: vi.fn(async () => undefined),
  },
}));

const { getAuthServerBaseUrl } = await import('@sudowork/host-bridge/authServer');
const { FALLBACK_SUDOWORK_SERVER_BASE_URL, getMossServerPolicy, normalizeHttpOrigin } = await import('@sudowork/common/sudoworkServer');

beforeEach(() => {
  configValues = {};
});

describe('Moss server resolution', () => {
  it('uses the hosted Moss deployment by default', async () => {
    expect(await getAuthServerBaseUrl()).toBe(FALLBACK_SUDOWORK_SERVER_BASE_URL);
  });

  it('uses the user-selected Moss address for every online login method', async () => {
    configValues['eeclaw.serverUrl'] = 'https://agent.example.com/';
    expect(await getAuthServerBaseUrl()).toBe('https://agent.example.com');
    expect(await getMossServerPolicy()).toEqual({
      serverUrl: 'https://agent.example.com',
      isLocked: false,
      source: 'user',
    });
  });

  it('gives an administrator-locked address precedence over the user setting', async () => {
    configValues['system.managedMossServerUrl'] = 'https://managed.example.com';
    configValues['system.mossServerUrlLocked'] = true;
    configValues['eeclaw.serverUrl'] = 'https://user.example.com';

    expect(await getMossServerPolicy()).toEqual({
      serverUrl: 'https://managed.example.com',
      isLocked: true,
      source: 'managed',
    });
  });

  it('lets a user override an unlocked administrator-distributed address', async () => {
    configValues['system.managedMossServerUrl'] = 'https://managed.example.com';
    configValues['system.mossServerUrlLocked'] = false;
    configValues['eeclaw.serverUrl'] = 'https://user.example.com';

    expect(await getMossServerPolicy()).toEqual({
      serverUrl: 'https://user.example.com',
      isLocked: false,
      source: 'user',
    });
  });

  it('uses an unlocked administrator-distributed address when the user has no override', async () => {
    configValues['system.managedMossServerUrl'] = 'https://managed.example.com';

    expect(await getMossServerPolicy()).toEqual({
      serverUrl: 'https://managed.example.com',
      isLocked: false,
      source: 'managed',
    });
  });

  it('keeps a valid legacy server setting during upgrade', async () => {
    configValues['system.sudoworkServerUrl'] = 'http://10.0.1.206:43127/';
    expect(await getAuthServerBaseUrl()).toBe('http://10.0.1.206:43127');
  });

  it('rejects credentials, paths, unsupported schemes and malformed URLs', () => {
    expect(normalizeHttpOrigin('https://user:secret@example.com')).toBeNull();
    expect(normalizeHttpOrigin('https://example.com/api')).toBeNull();
    expect(normalizeHttpOrigin('file:///tmp/moss')).toBeNull();
    expect(normalizeHttpOrigin('not a url')).toBeNull();
  });
});
