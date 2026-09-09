import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Which server the auth flow addresses.
 *
 * The point of these tests is the FIRST one: consumer-mode users — everyone who
 * signed up through the public sudowork-server and logs in with a phone code —
 * must keep reaching that same server. Routing `/api/v1/auth/*` through a
 * resolver was done so a control plane could declare its own login method; if it
 * ever changed where an existing consumer user authenticates, their SMS login
 * would silently start hitting a server that has never heard of them.
 */

const CONSUMER_SERVER = 'https://sudowork-server.sudoprivacy.com';

let appMode: 'c' | 'e' | null = null;
let configValues: Record<string, string | undefined> = {};

vi.mock('@sudowork/common/storage', () => ({
  ConfigStorage: {
    get: vi.fn(async (key: string) => configValues[key]),
    set: vi.fn(async () => undefined),
  },
}));

vi.mock('@sudowork/common/sudoworkServer', async () => {
  const actual = await vi.importActual<typeof import('@sudowork/common/sudoworkServer')>(
    '@sudowork/common/sudoworkServer'
  );
  return {
    ...actual,
    getSudoworkServerBaseUrl: vi.fn(async () => CONSUMER_SERVER),
  };
});

vi.mock('@sudowork/host-bridge/ipcBridge', () => ({ eeclaw: { setAppMode: { invoke: vi.fn() } } }));

vi.mock('@sudowork/host-bridge/eeclawMode', () => ({
  getAppMode: vi.fn(async () => appMode),
}));

const { getAuthServerBaseUrl } = await import('@sudowork/host-bridge/authServer');

beforeEach(() => {
  appMode = null;
  configValues = {};
});

describe('getAuthServerBaseUrl', () => {
  it('keeps consumer-mode users on the consumer server', async () => {
    // The regression that matters: existing phone-code users must not be
    // silently redirected to a control plane that has no account for them.
    appMode = 'c';
    configValues['eeclaw.serverUrl'] = 'https://some-control-plane.example.com';
    expect(await getAuthServerBaseUrl()).toBe(CONSUMER_SERVER);
  });

  it('keeps a user who has never chosen a mode on the consumer server', async () => {
    appMode = null;
    expect(await getAuthServerBaseUrl()).toBe(CONSUMER_SERVER);
  });

  it('uses the configured control plane in enterprise mode', async () => {
    appMode = 'e';
    configValues['eeclaw.serverUrl'] = 'https://agent.example.com';
    expect(await getAuthServerBaseUrl()).toBe('https://agent.example.com');
  });

  it('normalises the configured address', async () => {
    appMode = 'e';
    configValues['eeclaw.serverUrl'] = 'https://agent.example.com/';
    expect(await getAuthServerBaseUrl()).toBe('https://agent.example.com');
  });

  it('falls back to the consumer server when enterprise mode has no address', async () => {
    // A half-configured install degrades to the previous behaviour instead of
    // failing every auth request with an unhelpful error.
    appMode = 'e';
    expect(await getAuthServerBaseUrl()).toBe(CONSUMER_SERVER);
  });

  it('falls back when the configured address is unusable', async () => {
    appMode = 'e';
    configValues['eeclaw.serverUrl'] = 'not a url';
    expect(await getAuthServerBaseUrl()).toBe(CONSUMER_SERVER);
  });
});
