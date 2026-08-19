import type { Agent } from 'http';

/**
 * Resolve an HTTP(S) proxy `Agent` for a target URL from the environment, or
 * `undefined` when no proxy applies.
 *
 * Node's `http(s).get` ignores the conventional `HTTP_PROXY` / `HTTPS_PROXY` /
 * `NO_PROXY` variables unless an explicit agent is passed. Runtime downloads
 * (scode, nexus-vfs) therefore attempt a *direct* connection and fail the TLS
 * handshake behind a corporate/VPN proxy — the common case for CN users, where
 * the boot then stalls at "初始化失败". Wiring the returned agent into the
 * download requests makes them honor the same proxy the OS/browser use.
 *
 * `NO_PROXY` is respected (comma-separated hosts / `.suffix` entries; `*`
 * disables proxying entirely). Async because the proxy-agent packages are
 * ESM-only and must be dynamically imported from the CJS main process (a static
 * import compiles to `require`, which throws `ERR_PACKAGE_PATH_NOT_EXPORTED`).
 */
export async function getProxyAgent(targetUrl: string): Promise<Agent | undefined> {
  let host: string;
  let isHttps: boolean;
  try {
    const parsed = new URL(targetUrl);
    host = parsed.hostname;
    isHttps = parsed.protocol === 'https:';
  } catch {
    return undefined;
  }

  const proxyUrl = isHttps ? process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy : process.env.HTTP_PROXY || process.env.http_proxy;
  if (!proxyUrl) return undefined;

  const noProxy = process.env.NO_PROXY || process.env.no_proxy || '';
  for (const raw of noProxy.split(',')) {
    const entry = raw.trim();
    if (!entry) continue;
    if (entry === '*') return undefined;
    const bare = entry.startsWith('.') ? entry.slice(1) : entry;
    if (host === bare || host.endsWith(`.${bare}`)) return undefined;
  }

  if (isHttps) {
    const { HttpsProxyAgent } = await import('https-proxy-agent');
    return new HttpsProxyAgent(proxyUrl);
  }
  const { HttpProxyAgent } = await import('http-proxy-agent');
  return new HttpProxyAgent(proxyUrl);
}
