import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IConfigStorageRefer } from '@sudowork/common/storage';

let configValues: Record<string, string | boolean | undefined> = {};

vi.mock('@sudowork/common/storage', () => ({
  ConfigStorage: {
    get: vi.fn(async (key: string) => configValues[key]),
    set: vi.fn(async () => undefined),
  },
}));

const { getAuthServerBaseUrl } = await import('@sudowork/host-bridge/authServer');
const { FALLBACK_SUDOWORK_SERVER_BASE_URL, getMossServerPolicy, normalizeHttpOrigin, migrateHostedMossConfig } = await import('@sudowork/common/sudoworkServer');

beforeEach(() => {
  configValues = {};
});

describe('retired hosted server migration', () => {
  const retired = 'https://sudowork-server.sudoprivacy.com';
  const oldAuth = { access_token: 'old-session', refresh_token: 'old-refresh', expires_at: 1, device_id: 'device' };

  it.each(['system.sudoworkServerUrl', 'eeclaw.serverUrl'] as const)('migrates %s before restoring either process session', (key) => {
    const config: IConfigStorageRefer = {
      [key]: `${retired}/`,
      'eeclaw.authStorage': oldAuth,
      'eeclaw.userInfo': { id: 'old-id', username: 'Old' },
      'eeclaw.accountScope': 'old-scope',
      'eeclaw.tenantConfig': { client_cron_enabled: true },
      'eeclaw.localModeAvailable': true,
      'system.appMode': 'e',
    };
    const result = migrateHostedMossConfig(config)!;
    expect(result['eeclaw.serverUrl']).toBe(FALLBACK_SUDOWORK_SERVER_BASE_URL);
    expect(result['migration.hostedMossAuthReset']).toBe('hosted-moss-v1');
    for (const field of ['eeclaw.authStorage', 'eeclaw.userInfo', 'eeclaw.accountScope', 'eeclaw.tenantConfig', 'eeclaw.localModeAvailable']) expect(Object.keys(result)).not.toContain(field);
    expect(result['system.appMode']).toBe('e');
    expect(config['eeclaw.authStorage']).toBe(oldAuth);
    expect(migrateHostedMossConfig(result)).toBeNull();
  });

  it('updates both old default slots and leaves other preferences untouched', () => {
    const result = migrateHostedMossConfig({ 'system.sudoworkServerUrl': retired, 'eeclaw.serverUrl': retired, 'guid.sessionMode': 'local' })!;
    expect(result['system.sudoworkServerUrl']).toBe(FALLBACK_SUDOWORK_SERVER_BASE_URL);
    expect(result['guid.sessionMode']).toBe('local');
  });

  it.each([
    {},
    { 'eeclaw.serverUrl': 'https://private.example.com', 'system.sudoworkServerUrl': retired },
    { 'system.sudoworkServerUrl': 'http://10.0.1.206:43127' },
    { 'eeclaw.serverUrl': FALLBACK_SUDOWORK_SERVER_BASE_URL, 'system.sudoworkServerUrl': retired },
    { 'eeclaw.serverUrl': `${retired}:8443` },
    { 'eeclaw.serverUrl': 'https://sudowork-server.sudoprivacy.com.example.com' },
  ])('preserves current and custom deployments: %j', (config) => {
    expect(migrateHostedMossConfig({ ...config, 'eeclaw.authStorage': oldAuth })).toBeNull();
  });

  it.each([true, false])('preserves administrator-selected hosts (locked=%s)', (isLocked) => {
    expect(migrateHostedMossConfig({ 'eeclaw.serverUrl': retired, 'system.managedMossServerUrl': 'https://managed.example.com', 'system.mossServerUrlLocked': isLocked })).toBeNull();
  });

  it('preserves locked and privately distributed builds', () => {
    const config = { 'system.sudoworkServerUrl': retired };
    expect(migrateHostedMossConfig(config, { serverUrl: FALLBACK_SUDOWORK_SERVER_BASE_URL, isLocked: true })).toBeNull();
    expect(migrateHostedMossConfig(config, { serverUrl: 'https://private.example.com', isLocked: false })).toBeNull();
  });

  it('recognizes the public HTTP origin without broad hostname rewriting', () => {
    expect(migrateHostedMossConfig({ 'system.sudoworkServerUrl': ' http://sudowork-server.sudoprivacy.com/ ' })?.['eeclaw.serverUrl']).toBe(FALLBACK_SUDOWORK_SERVER_BASE_URL);
  });
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
