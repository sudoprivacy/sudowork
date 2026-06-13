/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import { app } from 'electron';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { mainError, mainLog, mainWarn } from '@process/utils/mainLogger';
import { browserPanelCdpService } from './BrowserPanelCdpService';
import { ipcBridge } from '@/common';

/**
 * Loopback HTTP bridge between the browser-panel MCP subprocess and the
 * sudowork main process.
 *
 * Why HTTP and not UNIX sockets / named pipes:
 *  - macOS Hardened Runtime + Windows pipe semantics make sockets brittle in
 *    packaged builds. Loopback HTTP works identically on all three OSes.
 *  - Kernel-allocated ephemeral port (bind to 0) means no collision across
 *    side-by-side installs or dev + prod running together.
 *  - 32-byte bearer token + non-loopback rejection blocks third-party local
 *    processes from talking to us even though the listener is reachable.
 *
 * Discovery: the listening port, the token, and the sudowork pid are written
 * atomically to `<userData>/browser-panel-mcp.json` at startup. The MCP
 * subprocess reads this file on every request and on ECONNREFUSED — that way
 * a sudowork restart (which rotates port + token) transparently recovers
 * without killing the MCP subprocess.
 */

const DISCOVERY_FILE_NAME = 'browser-panel-mcp.json';
const BROWSER_PANEL_VERSION = '0.1.0';

interface DiscoveryFilePayload {
  port: number;
  token: string;
  pid: number;
  version: string;
  startedAt: number;
}

class BrowserPanelHttpServer {
  private server: Server | null = null;
  private port = 0;
  private token = '';

  /**
   * Start the loopback HTTP server and write the discovery file.
   * Idempotent — safe to call multiple times.
   */
  async start(): Promise<{ port: number; discoveryFile: string }> {
    if (this.server) {
      return { port: this.port, discoveryFile: this.getDiscoveryFilePath() };
    }
    this.token = crypto.randomBytes(32).toString('hex');
    this.server = createServer((req, res) => {
      this.handleRequest(req, res).catch((err) => {
        mainError('BrowserPanelHttp', `unhandled request error: ${String(err)}`);
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: 'internal_error' }));
        }
      });
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error): void => {
        this.server?.off('error', onError);
        reject(err);
      };
      this.server!.once('error', onError);
      this.server!.listen(0, '127.0.0.1', () => {
        const address = this.server!.address();
        if (typeof address === 'object' && address) this.port = address.port;
        this.server!.off('error', onError);
        resolve();
      });
    });

    this.writeDiscoveryFile();
    mainLog('BrowserPanelHttp', `listening on 127.0.0.1:${this.port}`);
    return { port: this.port, discoveryFile: this.getDiscoveryFilePath() };
  }

  async stop(): Promise<void> {
    const srv = this.server;
    if (!srv) return;
    this.server = null;
    await new Promise<void>((resolve) => srv.close(() => resolve()));
    this.deleteDiscoveryFile();
  }

  getDiscoveryFilePath(): string {
    return path.join(app.getPath('userData'), DISCOVERY_FILE_NAME);
  }

  /** For tests: get the bearer token currently in use. */
  getToken(): string {
    return this.token;
  }

  /** For tests: get the listening port. 0 if not started. */
  getPort(): number {
    return this.port;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Request dispatch
  // ─────────────────────────────────────────────────────────────────────────

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // 1. Loopback enforcement — defense in depth even though listen() is bound
    //    to 127.0.0.1.
    const remoteAddr = req.socket.remoteAddress ?? '';
    if (remoteAddr !== '127.0.0.1' && remoteAddr !== '::1' && remoteAddr !== '::ffff:127.0.0.1') {
      mainWarn('BrowserPanelHttp', `rejected non-loopback connection from ${remoteAddr}`);
      res.statusCode = 403;
      res.end();
      return;
    }

    // 2. Token check.
    const auth = req.headers.authorization ?? '';
    const expected = `Bearer ${this.token}`;
    if (this.token.length === 0 || auth !== expected) {
      res.statusCode = 401;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }

    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.end();
      return;
    }

    const url = req.url ?? '';
    const body = await readJsonBody(req);

    try {
      const result = await this.dispatch(url, body);
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, data: result }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.statusCode = 200; // we return errors in-body so MCP can show them to the model
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: false, error: message }));
    }
  }

  private async dispatch(url: string, body: Record<string, unknown>): Promise<unknown> {
    switch (url) {
      case '/tab/list':
        return browserPanelCdpService.listTabs();
      case '/tab/open': {
        const { url: target, conversationId } = body as { url?: string; conversationId?: string };
        if (typeof target !== 'string' || !target) throw new Error('url required');
        // conversationId is optional: the browser-panel MCP child doesn't
        // know which chat conversation triggered the call, so it omits the
        // field. Renderer-side BrowserPanel treats undefined conversationId
        // as routing to the global bucket — preserves the pre-isolation
        // behavior for this code path.
        ipcBridge.rightPanelBrowser.open.emit({
          url: target,
          switchTab: true,
          ...(conversationId ? { conversationId } : {}),
        });
        return { ok: true };
      }
      case '/tab/navigate': {
        const id = this.resolveTabOrThrow(body.tabId);
        return browserPanelCdpService.navigate(id, {
          url: requireString(body, 'url'),
          waitUntil: body.waitUntil as 'load' | 'domcontentloaded' | 'networkidle' | undefined,
        });
      }
      case '/tab/evaluate': {
        const id = this.resolveTabOrThrow(body.tabId);
        return browserPanelCdpService.evaluateScript(id, {
          expression: requireString(body, 'expression'),
          timeoutMs: typeof body.timeoutMs === 'number' ? body.timeoutMs : undefined,
        });
      }
      case '/tab/screenshot': {
        const id = this.resolveTabOrThrow(body.tabId);
        return browserPanelCdpService.takeScreenshot(id, {
          format: body.format as 'png' | 'jpeg' | undefined,
          quality: typeof body.quality === 'number' ? body.quality : undefined,
          fullPage: typeof body.fullPage === 'boolean' ? body.fullPage : undefined,
        });
      }
      case '/tab/dom-snapshot': {
        const id = this.resolveTabOrThrow(body.tabId);
        return browserPanelCdpService.getDomSnapshot(id, {
          selector: typeof body.selector === 'string' ? body.selector : undefined,
          format: (body.format ?? 'outerHTML') as 'outerHTML' | 'innerText',
        });
      }
      case '/tab/network': {
        const id = this.resolveTabOrThrow(body.tabId);
        return browserPanelCdpService.listNetworkRequests(id, {
          filter: body.filter as Parameters<typeof browserPanelCdpService.listNetworkRequests>[1]['filter'],
          limit: typeof body.limit === 'number' ? body.limit : undefined,
        });
      }
      case '/tab/console': {
        const id = this.resolveTabOrThrow(body.tabId);
        return browserPanelCdpService.listConsoleMessages(id, {
          levels: body.levels as Parameters<typeof browserPanelCdpService.listConsoleMessages>[1]['levels'],
          limit: typeof body.limit === 'number' ? body.limit : undefined,
        });
      }
      default:
        throw new Error(`unknown route: ${url}`);
    }
  }

  private resolveTabOrThrow(rawTabId: unknown): number {
    const tabId = typeof rawTabId === 'string' ? rawTabId : undefined;
    const id = browserPanelCdpService.resolveWebContentsId(tabId);
    if (id === null) throw new Error('no active browser tab — ask the user to open one in the right-panel browser');
    return id;
  }

  private writeDiscoveryFile(): void {
    const payload: DiscoveryFilePayload = {
      port: this.port,
      token: this.token,
      pid: process.pid,
      version: BROWSER_PANEL_VERSION,
      startedAt: Date.now(),
    };
    const filePath = this.getDiscoveryFilePath();
    const tmpPath = `${filePath}.tmp.${process.pid}`;
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(tmpPath, JSON.stringify(payload), { mode: 0o600 });
      fs.renameSync(tmpPath, filePath);
    } catch (err) {
      mainWarn('BrowserPanelHttp', `failed to write discovery file ${filePath}: ${String(err)}`);
    }
  }

  private deleteDiscoveryFile(): void {
    const filePath = this.getDiscoveryFilePath();
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      // ignore — best effort
    }
  }
}

function requireString(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  if (typeof value !== 'string' || !value) throw new Error(`${key} required`);
  return value;
}

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 50 * 1024 * 1024) {
        // 50MB cap — anything larger is almost certainly an abuse / bug.
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      if (!raw) return resolve({});
      try {
        const parsed = JSON.parse(raw);
        resolve(parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {});
      } catch (err) {
        reject(new Error(`invalid JSON body: ${String(err)}`));
      }
    });
    req.on('error', reject);
  });
}

export const browserPanelHttpServer = new BrowserPanelHttpServer();
