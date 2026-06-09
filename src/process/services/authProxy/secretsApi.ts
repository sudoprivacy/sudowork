/**
 * Secrets API handler for Auth Proxy.
 *
 * Provides three CRUD endpoints (GET/PUT/DELETE) for managing secrets
 * via the Auth Proxy HTTP server, with automatic enable-state coupling.
 *
 * Skill subprocesses call these endpoints using SUDOWORK_AUTH_PROXY_BASE_URL
 * and SUDOWORK_AUTH_PROXY_TOKEN (no JWT required).
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { URL } from 'url';
import { getNexusSecretClient } from '@common/nexus/nexus-secret-client';
import { cachePut, cacheDelete } from '@common/nexus/secret-cache';
import { mainLog, mainWarn } from '@process/utils/mainLogger';
import { ProcessConfig } from '@/process/initStorage';
import {
  findConfigItemByNamespace,
  buildRuleFromRawItem,
  addRuleToCache,
  removeRuleFromCache,
} from './configItemsLoader';
import { ipcBridge } from '@/common';

// ============================================================================
// Mutex for serializing enabled-state writes
// ============================================================================

let enabledStateMutex: Promise<void> = Promise.resolve();

// ============================================================================
// Response helpers
// ============================================================================

function respond(res: ServerResponse, statusCode: number, body: Record<string, unknown>): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// ============================================================================
// Read request body with size limit
// ============================================================================

function readBody(req: IncomingMessage, maxBytes: number = 64 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('PAYLOAD_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

// ============================================================================
// Enable-state side effect
// ============================================================================

async function applyEnableSideEffect(namespace: string, intentEnable: boolean): Promise<void> {
  const doSideEffect = async () => {
    const configItem = findConfigItemByNamespace(namespace);
    if (!configItem) {
      mainLog('AuthProxy', 'Namespace not in known config items, skip enable coupling:', namespace);
      return;
    }

    const map = (ProcessConfig.getSync('settings.tenant.enabled') ?? {}) as Record<number, boolean>;
    let changed = false;

    if (intentEnable) {
      map[configItem.id] = true;
      addRuleToCache(buildRuleFromRawItem(configItem));
      changed = true;
    } else {
      // Check if all entries' secrets are gone before disabling
      try {
        const client = getNexusSecretClient();
        const activeSecrets = client.listSecrets(namespace, false);
        const hasActiveEntry = configItem.entries.some((entry) =>
          activeSecrets.some((s) => s.key === entry.config_key),
        );
        if (!hasActiveEntry) {
          map[configItem.id] = false;
          removeRuleFromCache(configItem.id);
          changed = true;
        }
      } catch (err) {
        mainWarn('AuthProxy', `listSecrets failed during DELETE side-effect for namespace=${namespace}, enabled state untouched (may need manual fix)`, err);
        return;
      }
    }

    if (changed) {
      await ProcessConfig.set('settings.tenant.enabled', map);
      ipcBridge.authProxy.enabledStateChanged.emit();
    }
  };

  const prev = enabledStateMutex;
  enabledStateMutex = prev.then(() => doSideEffect()).catch(() => {});
  await enabledStateMutex;
}

// ============================================================================
// Route handlers
// ============================================================================

async function handleList(req: IncomingMessage, res: ServerResponse, parsedUrl: URL): Promise<void> {
  try {
    const namespace = parsedUrl.searchParams.get('namespace') ?? undefined;
    const client = getNexusSecretClient();
    const secrets = client.listSecrets(namespace, false);
    const metadata = secrets.map((s) => ({
      namespace: s.namespace,
      key: s.key,
      description: s.description,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      version: s.currentVersion,
    }));
    respond(res, 200, { success: true, data: metadata });
  } catch (error) {
    respond(res, 500, { success: false, msg: error instanceof Error ? error.message : String(error) });
  }
}

async function handlePut(
  req: IncomingMessage,
  res: ServerResponse,
  namespace: string,
  key: string,
): Promise<void> {
  try {
    let body: string;
    try {
      body = await readBody(req);
    } catch (err) {
      if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
        respond(res, 413, { success: false, msg: 'Request body too large (max 64KB)' });
        return;
      }
      respond(res, 400, { success: false, msg: 'Failed to read request body' });
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      respond(res, 400, { success: false, msg: 'Invalid JSON body' });
      return;
    }

    const { value, description } = parsed as Record<string, unknown>;
    if (typeof value !== 'string') {
      respond(res, 400, { success: false, msg: 'Missing or invalid "value" field' });
      return;
    }

    const client = getNexusSecretClient();
    const result = client.putSecret(namespace, key, value, description as string | undefined);

    // PUT on a previously soft-deleted secret creates a new version but keeps deleted state.
    // restoreSecret clears deleted state, making the secret active again.
    // For non-deleted or first-create secrets, restoreSecret returns error which we ignore.
    try {
      client.restoreSecret(namespace, key);
    } catch {}

    cachePut(namespace, key, value);

    // Enable side effect: await to guarantee rulesCache is updated before 200
    await applyEnableSideEffect(namespace, true);

    respond(res, 200, { success: true, data: result });
  } catch (error) {
    respond(res, 500, { success: false, msg: error instanceof Error ? error.message : String(error) });
  }
}

async function handleDelete(
  req: IncomingMessage,
  res: ServerResponse,
  namespace: string,
  key: string,
): Promise<void> {
  try {
    const client = getNexusSecretClient();
    const result = client.deleteSecret(namespace, key);
    cacheDelete(namespace, key);

    // Enable side effect: await to guarantee rulesCache is updated before 200
    await applyEnableSideEffect(namespace, false);

    respond(res, 200, { success: true, data: result });
  } catch (error) {
    respond(res, 500, { success: false, msg: error instanceof Error ? error.message : String(error) });
  }
}

// ============================================================================
// Main entry point
// ============================================================================

export async function handleSecretsRequest(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  parsedUrl: URL,
): Promise<void> {
  try {
    const segments = pathname.split('/').filter(Boolean);
    const method = req.method ?? 'GET';

    // GET /secrets
    if (segments.length === 1 && method === 'GET') {
      return await handleList(req, res, parsedUrl);
    }

    // PUT/DELETE /secrets/:namespace/:key
    if (segments.length === 3) {
      const namespace = decodeURIComponent(segments[1]);
      const key = decodeURIComponent(segments[2]);
      if (method === 'PUT') return await handlePut(req, res, namespace, key);
      if (method === 'DELETE') return await handleDelete(req, res, namespace, key);
      respond(res, 405, { success: false, msg: 'Method not allowed' });
      return;
    }

    respond(res, 404, { success: false, msg: 'Not found' });
  } catch (error) {
    if (!res.headersSent) {
      respond(res, 500, { success: false, msg: error instanceof Error ? error.message : String(error) });
    }
  }
}
