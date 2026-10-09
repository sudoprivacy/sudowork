import { afterEach, describe, expect, it } from 'vitest';
import { getProxyAgent } from '../../src/process/utils/proxyAgent';

const PROXY_ENV = ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy'];

function clearProxyEnv(): void {
  for (const key of PROXY_ENV) delete process.env[key];
}

describe('getProxyAgent', () => {
  afterEach(clearProxyEnv);

  it('returns undefined when no proxy env is set', async () => {
    clearProxyEnv();
    expect(await getProxyAgent('https://github.com/x')).toBeUndefined();
  });

  it('returns an agent for an https target when HTTPS_PROXY is set', async () => {
    clearProxyEnv();
    process.env.HTTPS_PROXY = 'http://127.0.0.1:7897';
    const agent = await getProxyAgent(
      'https://github.com/sudoprivacy/sudocode/releases/download/v0.1.24/scode-windows-x64.zip',
    );
    expect(agent).toBeDefined();
  });

  it('falls back to HTTP_PROXY for an https target when HTTPS_PROXY is absent', async () => {
    clearProxyEnv();
    process.env.HTTP_PROXY = 'http://127.0.0.1:7897';
    expect(await getProxyAgent('https://github.com/x')).toBeDefined();
  });

  it('returns an agent for an http target when HTTP_PROXY is set', async () => {
    clearProxyEnv();
    process.env.HTTP_PROXY = 'http://127.0.0.1:7897';
    expect(await getProxyAgent('http://example.com/x')).toBeDefined();
  });

  it('respects NO_PROXY exact-host and .suffix entries', async () => {
    clearProxyEnv();
    process.env.HTTPS_PROXY = 'http://127.0.0.1:7897';
    process.env.NO_PROXY = 'github.com,.internal';
    expect(await getProxyAgent('https://github.com/x')).toBeUndefined();
    expect(await getProxyAgent('https://api.internal/x')).toBeUndefined();
    // A host outside NO_PROXY still gets the proxy.
    expect(await getProxyAgent('https://objects.githubusercontent.com/x')).toBeDefined();
  });

  it('respects NO_PROXY="*" as disable-all', async () => {
    clearProxyEnv();
    process.env.HTTPS_PROXY = 'http://127.0.0.1:7897';
    process.env.NO_PROXY = '*';
    expect(await getProxyAgent('https://github.com/x')).toBeUndefined();
  });

  it('returns undefined for a malformed URL', async () => {
    clearProxyEnv();
    process.env.HTTPS_PROXY = 'http://127.0.0.1:7897';
    expect(await getProxyAgent('not a url')).toBeUndefined();
  });
});
