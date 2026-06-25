/**
 * Auth Proxy Server - local HTTP proxy that injects secrets into upstream requests.
 *
 * - Listens on 127.0.0.1 only (no external access)
 * - Requires proxy token for authentication
 * - Injects secrets based on Config Items rules or explicit headers
 * - Streams requests/responses through to upstream
 */

import http from 'http';
import https from 'https';
import type { IncomingMessage, ServerResponse } from 'http';
import { URL } from 'url';
import { mainLog } from '@process/utils/mainLogger';
import { injectAuth, injectMultiAuth } from './authInjectors';
import { validateRemoteUrl } from './ssrfGuard';
import { findRuleForUrl, getRules } from './configItemsLoader';
import { parseSecretKeys, parseSecretMap } from './secretHeaderParser';
import { handleSecretsRequest } from './secretsApi';
import { handlePwdLoginRequest } from './pwdLoginApi';
import { resolveSecret } from '@/common/nexus/secret-cache';
import type { AuthProxyRule } from '@/common/types/authProxy';

// ============================================================================
// Types
// ============================================================================

interface ProxyRequestInfo {
  token: string | null;
  remoteUrl: string | null;
  secretNamespace: string | null;
  secretKey: string[] | null;
  secretMap: Record<string, string> | null;
  authScheme: string | null;
  authHeader: string | null;
  authPrefix: string | null;
}

// ============================================================================
// Headers to strip before forwarding
// ============================================================================

const CONTROL_HEADERS = ['authorization', 'x-secret-namespace', 'x-secret-key', 'x-secret-map', 'x-auth-scheme', 'x-auth-header', 'x-auth-prefix', 'x-remote-url', 'host', 'connection'];

const UPSTREAM_TIMEOUT_MS = 30_000;

// ============================================================================
// Auth Proxy Server
// ============================================================================

export class AuthProxyServer {
  private server: http.Server | null = null;
  private tokenRegistry = new Map<string, number>();
  private port: number | null = null;
  private minimatchFn: (str: string, pattern: string) => boolean;

  constructor(minimatchFn: (str: string, pattern: string) => boolean) {
    this.minimatchFn = minimatchFn;
  }

  // --------------------------------------------------------------------------
  // Token management
  // --------------------------------------------------------------------------

  registerToken(token: string, pid: number): void {
    this.tokenRegistry.set(token, pid);
  }

  revokeToken(token: string): void {
    this.tokenRegistry.delete(token);
  }

  isValidToken(token: string): boolean {
    return this.tokenRegistry.has(token);
  }

  // --------------------------------------------------------------------------
  // Server lifecycle
  // --------------------------------------------------------------------------

  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handleRequest(req, res));

      // Bind to 127.0.0.1 only - no external access
      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server!.address();
        if (typeof addr === 'object' && addr) {
          this.port = addr.port;
          mainLog('AuthProxy', `Listening on 127.0.0.1:${this.port}`);
          resolve(this.port);
        } else {
          reject(new Error('Failed to get server address'));
        }
      });

      this.server.on('error', (err) => {
        mainLog('AuthProxy', `Server error:`, err);
        reject(err);
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    return new Promise((resolve) => {
      this.server!.closeAllConnections?.();
      this.server!.close(() => {
        this.server = null;
        this.port = null;
        mainLog('AuthProxy', 'Stopped');
        resolve();
      });
    });
  }

  getPort(): number | null {
    return this.port;
  }

  // --------------------------------------------------------------------------
  // Request handling
  // --------------------------------------------------------------------------

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Health check endpoint (no auth required)
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', port: this.port }));
      return;
    }

    // Secrets CRUD endpoints (token-authenticated)
    const parsedUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
    const pathname = parsedUrl.pathname;

    if (pathname === '/secrets' || pathname.startsWith('/secrets/')) {
      const info = this.parseRequestInfo(req);
      if (!info.token || !this.isValidToken(info.token)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid or missing proxy token' }));
        return;
      }
      await handleSecretsRequest(req, res, pathname, parsedUrl);
      return;
    }

    // auto-login skill API (token-authenticated like /secrets). No password flows here.
    if (pathname === '/pwdlogin' || pathname.startsWith('/pwdlogin/')) {
      const info = this.parseRequestInfo(req);
      if (!info.token || !this.isValidToken(info.token)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid or missing proxy token' }));
        return;
      }
      await handlePwdLoginRequest(req, res, pathname);
      return;
    }

    // Only handle /proxy
    if (req.url !== '/proxy') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    try {
      // 1. Extract and validate proxy token
      const info = this.parseRequestInfo(req);
      if (!info.token || !this.isValidToken(info.token)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid or missing proxy token' }));
        return;
      }

      // 2. Validate remote URL
      if (!info.remoteUrl) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing X-Remote-URL header' }));
        return;
      }

      const urlValidation = await validateRemoteUrl(info.remoteUrl);
      if (!urlValidation.valid) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `SSRF blocked: ${urlValidation.error}` }));
        return;
      }

      // 3. Determine secret source and inject auth
      const authResult = await this.resolveAndInjectAuth(info);
      if (authResult.error) {
        const statusCode = authResult.statusCode ?? 502;
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: authResult.error }));
        return;
      }

      // 4. Build upstream headers
      const upstreamHeaders = this.buildUpstreamHeaders(req, authResult.headers);

      // 5. Merge query params (for scheme=query) into target URL
      let targetUrl = info.remoteUrl!;
      if (authResult.url) {
        const separator = targetUrl.includes('?') ? '&' : '?';
        targetUrl = `${targetUrl}${separator}${authResult.url}`;
      }

      // 6. Stream proxy request
      await this.proxyRequest(targetUrl, req, res, upstreamHeaders);
    } catch (error) {
      mainLog('AuthProxy', `Request error:`, error);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal proxy error' }));
      }
    }
  }

  // --------------------------------------------------------------------------
  // Auth resolution
  // --------------------------------------------------------------------------

  private async resolveAndInjectAuth(info: ProxyRequestInfo): Promise<{ headers: Record<string, string>; url?: string; error?: string; statusCode?: number }> {
    let secretValue: string;
    let scheme: string | null;
    let bearerPrefix: string | null;
    let rule: AuthProxyRule | null = null;

    // Priority 1: Explicit X-Secret-Namespace + X-Secret-Key (supports multiple keys)
    if (info.secretNamespace && info.secretKey && info.secretKey.length > 0) {
      const keys = info.secretKey;

      // bearer/basic are single-value schemes: only the first key can be injected.
      // Application layer controls this by passing a single key when it needs them.
      if (keys.length === 1 || info.authScheme === 'bearer' || info.authScheme === 'basic') {
        secretValue = resolveSecret(info.secretNamespace, keys[0], '');
        scheme = info.authScheme;
        bearerPrefix = null;
        if (!secretValue) {
          return { headers: {}, error: `Secret not found: ${info.secretNamespace}/${keys[0]}` };
        }
        const prefix = info.authPrefix ?? bearerPrefix ?? 'Bearer';
        return injectAuth({
          scheme: scheme ?? 'bearer',
          secret: secretValue,
          headerName: info.authHeader,
          prefix,
        });
      }

      // Multiple keys with header/query scheme: aggregate via injectMultiAuth.
      // Uses X-Secret-Map (vaultKey -> upstreamName) if provided; falls back to vaultKey.
      const effectiveScheme = info.authScheme ?? 'header';
      const entries: Array<{ configKey: string; secret: string }> = [];
      for (const k of keys) {
        const secret = resolveSecret(info.secretNamespace, k, '');
        if (!secret) {
          mainLog('AuthProxy', `Missing secret for ${info.secretNamespace}/${k}, skipping`);
          continue;
        }
        entries.push({ configKey: k, secret });
      }
      if (entries.length === 0) {
        return { headers: {}, error: `No secrets found for namespace "${info.secretNamespace}"` };
      }
      return injectMultiAuth(effectiveScheme, entries, info.secretMap ?? undefined);
    }

    // Priority 2: URL pattern matching
    rule = findRuleForUrl(info.remoteUrl!, this.minimatchFn);
    if (!rule) {
      return { headers: {}, error: 'No matching secret found. Provide X-Secret-Namespace + X-Secret-Key, or configure a URL pattern rule.' };
    }

    // Determine scheme: request headers can override server config
    scheme = info.authScheme ?? rule.scheme;
    bearerPrefix = rule.bearerPrefix;

    // Single-entry schemes (bearer/basic)
    if ((scheme === 'bearer' || scheme === 'basic') && rule.entries.length >= 1) {
      const entry = rule.entries[0];
      secretValue = resolveSecret(rule.secretNamespace, entry.configKey, '');
    } else if (scheme === 'header' || scheme === 'query') {
      // Multi-entry schemes
      return this.resolveMultiEntryAuth(rule, scheme);
    } else {
      // scheme is null or unknown, try single entry
      if (rule.entries.length >= 1) {
        secretValue = resolveSecret(rule.secretNamespace, rule.entries[0].configKey, '');
        scheme = 'bearer';
      } else {
        return { headers: {}, error: `Config item "${rule.name}" has no entries with secret values` };
      }
    }

    if (!secretValue) {
      const missingKey = rule ? rule.entries[0]?.configKey : undefined;
      return { headers: {}, error: `Secret not found: ${rule ? rule.secretNamespace : info.secretNamespace}/${missingKey ?? ''}` };
    }

    // Inject auth
    const prefix = info.authPrefix ?? bearerPrefix ?? 'Bearer';
    return injectAuth({
      scheme: scheme ?? 'bearer',
      secret: secretValue,
      headerName: info.authHeader,
      prefix,
    });
  }

  private resolveMultiEntryAuth(rule: AuthProxyRule, scheme: string): { headers: Record<string, string>; url?: string; error?: string; statusCode?: number } {
    const entries: Array<{ configKey: string; secret: string }> = [];

    for (const entry of rule.entries) {
      const secret = resolveSecret(rule.secretNamespace, entry.configKey, '');
      if (!secret) {
        // For header/query: skip missing entries with warning
        mainLog('AuthProxy', `Missing secret for ${rule.secretNamespace}/${entry.configKey}, skipping`);
        continue;
      }
      entries.push({ configKey: entry.configKey, secret });
    }

    if (entries.length === 0) {
      return { headers: {}, error: `No secrets found for config item "${rule.name}"` };
    }

    return injectMultiAuth(scheme, entries);
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private parseRequestInfo(req: IncomingMessage): ProxyRequestInfo {
    const token = extractBearerToken(req.headers.authorization);
    return {
      token,
      remoteUrl: req.headers['x-remote-url'] as string | null,
      secretNamespace: req.headers['x-secret-namespace'] as string | null,
      secretKey: parseSecretKeys(req),
      secretMap: parseSecretMap(req.headers['x-secret-map'] as string | null),
      authScheme: req.headers['x-auth-scheme'] as string | null,
      authHeader: req.headers['x-auth-header'] as string | null,
      authPrefix: req.headers['x-auth-prefix'] as string | null,
    };
  }

  private buildUpstreamHeaders(req: IncomingMessage, authHeaders: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {};

    // Copy original headers, excluding control headers
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value !== 'string') continue;
      if (CONTROL_HEADERS.includes(key.toLowerCase())) continue;
      headers[key] = value;
    }

    // Merge auth headers (may override upstream auth)
    Object.assign(headers, authHeaders);

    // Set Host to the target host
    const remoteUrl = req.headers['x-remote-url'] as string | null;
    if (remoteUrl) {
      try {
        const parsed = new URL(remoteUrl);
        headers['host'] = parsed.host;
      } catch {
        // Ignore invalid URL
      }
    }

    return headers;
  }

  private proxyRequest(targetUrl: string, req: IncomingMessage, res: ServerResponse, headers: Record<string, string>): Promise<void> {
    return new Promise((resolve) => {
      const parsed = new URL(targetUrl);

      const options: http.RequestOptions = {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: req.method,
        headers,
        timeout: UPSTREAM_TIMEOUT_MS,
      };

      const isHttps = parsed.protocol === 'https:';
      const requestModule = isHttps ? https : http;

      const upstream = requestModule.request(options, (upstreamRes: http.IncomingMessage) => {
        // Forward status code and headers
        const upstreamHeaders: Record<string, string> = {};
        for (const [key, value] of Object.entries(upstreamRes.headers)) {
          if (typeof value !== 'string') continue;
          if (key.toLowerCase() === 'transfer-encoding') continue;
          upstreamHeaders[key] = value;
        }
        res.writeHead(upstreamRes.statusCode!, upstreamHeaders);

        // Stream response body
        upstreamRes.pipe(res);
        upstreamRes.on('end', resolve);
      });

      upstream.on('error', (err: Error) => {
        mainLog('AuthProxy', `Upstream error:`, err.message);
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Upstream request failed: ${err.message}` }));
        }
        resolve();
      });

      upstream.on('timeout', () => {
        upstream.destroy();
        if (!res.headersSent) {
          res.writeHead(504, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Upstream request timed out' }));
        }
        resolve();
      });

      // Stream request body to upstream
      req.pipe(upstream);
    });
  }
}

// ============================================================================
// Utilities
// ============================================================================

function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}
