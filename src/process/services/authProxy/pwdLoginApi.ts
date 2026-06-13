/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Auth-Proxy handler for the `auto-login` skill's agent-facing API.
 *
 * The agent (running as a skill subprocess) already has SUDOWORK_AUTH_PROXY_BASE_URL
 * + SUDOWORK_AUTH_PROXY_TOKEN, so it reaches these endpoints the same way it reaches
 * /secrets — no new auth, no IPC-from-agent. Routes:
 *
 *   POST /pwdlogin/register  { title, url, usernameSelector, passwordSelector,
 *                              submitSelector, captchaSelector?, captchaImageSelector?,
 *                              strategy } → register a custom site (NON-secret selectors).
 *   GET  /pwdlogin/list      → list sites + whether each has a saved credential.
 *   POST /pwdlogin/start     { title } → trigger the real auto-fill login.
 *
 * NO password ever flows through here: register stores only selectors; the user
 * fills credentials in 秘钥管理 (renderer→main→Vault); start only passes a title.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { handlePwdLogin, listPwdLoginEntries, registerPwdLoginEntry, type PwdLoginEntry } from '@process/services/pwdLogin/pwdLoginService';
import { mainError } from '@process/utils/mainLogger';

function respond(res: ServerResponse, statusCode: number, body: Record<string, unknown>): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage, maxBytes = 64 * 1024): Promise<string> {
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

async function parseJsonBody(req: IncomingMessage, res: ServerResponse): Promise<Record<string, unknown> | null> {
  let raw: string;
  try {
    raw = await readBody(req);
  } catch (err) {
    respond(res, err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE' ? 413 : 400, { success: false, msg: 'bad body' });
    return null;
  }
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    respond(res, 400, { success: false, msg: 'invalid JSON' });
    return null;
  }
}

export async function handlePwdLoginRequest(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
  try {
    const method = req.method ?? 'GET';

    // GET /pwdlogin/list
    if (pathname === '/pwdlogin/list' && method === 'GET') {
      respond(res, 200, { success: true, data: await listPwdLoginEntries() });
      return;
    }

    // POST /pwdlogin/register
    if (pathname === '/pwdlogin/register' && method === 'POST') {
      const body = await parseJsonBody(req, res);
      if (!body) return;
      try {
        await registerPwdLoginEntry(body as unknown as PwdLoginEntry);
        respond(res, 200, { success: true });
      } catch (err) {
        respond(res, 400, { success: false, msg: err instanceof Error ? err.message : 'register_failed' });
      }
      return;
    }

    // POST /pwdlogin/start
    if (pathname === '/pwdlogin/start' && method === 'POST') {
      const body = await parseJsonBody(req, res);
      if (!body) return;
      const title = typeof body.title === 'string' ? body.title : '';
      if (!title) {
        respond(res, 400, { success: false, msg: 'title required' });
        return;
      }
      // Agent-initiated: pass allow_once so the trusted flow proceeds (the credential
      // itself was stored by the user; this only fills it). The result never carries
      // password bytes.
      const result = await handlePwdLogin({ title, optionId: 'allow_once' });
      respond(res, 200, { success: result.ok, data: result });
      return;
    }

    respond(res, 404, { success: false, msg: 'not found' });
  } catch (err) {
    mainError('pwdLoginApi', `request failed: ${err instanceof Error ? err.name : typeof err}`);
    if (!res.headersSent) respond(res, 500, { success: false, msg: 'internal error' });
  }
}
