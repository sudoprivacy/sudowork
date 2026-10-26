import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IHostPageNavigation } from '../browserPanel/LocalBrowserWorker';
import { SudographCompilerError } from './SudographModelClient';

interface IReviewBinding {
  workspaceId: string;
  conversationId: string;
}

interface IReviewSession extends IReviewBinding {
  prefix: string;
  cookieName: string;
  credentialHash: Buffer;
  expiresAt: number;
}

export interface ISudographReviewHostOptions {
  authorize: (binding: IReviewBinding) => void | Promise<void>;
  read: (workspaceId: string, request: Record<string, unknown>) => Promise<unknown>;
  now?: () => number;
}

/** Private browser-host handoff. Never return this object through IPC or MCP. */
export interface ISudographReviewLaunch extends IHostPageNavigation {
  revoke: () => void;
}

/** Desktop OS-profile scope. Cloud ingress must use its existing tenant authority. */
export class SudographReviewHost {
  private readonly sessions = new Map<string, IReviewSession>();
  private server: Server | undefined;
  private startup: Promise<string> | undefined;
  private origin = '';
  private isClosed = false;

  constructor(private readonly options: ISudographReviewHostOptions) {}

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  /** Called after host ownership checks, then installed by the trusted browser host. */
  async createSession(binding: IReviewBinding): Promise<ISudographReviewLaunch> {
    if (this.isClosed) throw new Error('Review host is closed.');
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(binding.workspaceId) || !binding.conversationId || binding.conversationId.length > 256) throw new Error('Invalid review binding.');
    await this.options.authorize(binding);
    if (this.isClosed) throw new Error('Review host is closed.');
    this.startup ??= this.start().catch((error) => {
      this.startup = undefined;
      throw error;
    });
    const origin = await this.startup;
    if (this.isClosed) throw new Error('Review host is closed.');
    for (const [id, session] of this.sessions) if (session.expiresAt <= this.now()) this.sessions.delete(id);
    if (this.sessions.size >= 128) throw new Error('Close existing review sessions before opening another.');
    const id = randomBytes(16).toString('hex');
    const credential = randomBytes(32).toString('hex');
    const prefix = `/review/${id}`;
    const cookieName = `sudograph_review_${id}`;
    const expiresAt = this.now() + 30 * 60_000;
    this.sessions.set(id, { ...binding, prefix, cookieName, credentialHash: createHash('sha256').update(credential).digest(), expiresAt });
    // Ordinary JSON, structured-clone, logging and bridge redaction must not
    // serialize the credential. Only the trusted browser host reads it explicitly.
    return Object.freeze(
      Object.defineProperties(
        { url: `${origin}${prefix}/` },
        {
          cookie: { value: Object.freeze({ name: cookieName, value: credential, url: `${origin}${prefix}/`, path: `${prefix}/`, httpOnly: true, sameSite: 'Strict', expires: Math.floor(expiresAt / 1000) }) },
          revoke: { value: () => this.sessions.delete(id) },
        }
      )
    ) as ISudographReviewLaunch;
  }

  private async start(): Promise<string> {
    const server = createServer((request, response) => {
      void this.respond(request, response).catch(() => this.reply(response, 503, { error: 'VIEW_UNAVAILABLE' }));
    });
    this.server = server;
    server.requestTimeout = 10_000;
    server.headersTimeout = 10_000;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Review host is unavailable.');
    this.origin = `http://127.0.0.1:${address.port}`;
    return this.origin;
  }

  private async respond(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const match = /^\/review\/([a-f0-9]{32})\/(v1)?$/.exec(request.url || '');
    const session = match && this.sessions.get(match[1]);
    const cookies = (request.headers.cookie || '').split(';').map((item) => item.trim());
    const credentials = session ? cookies.filter((item) => item.startsWith(`${session.cookieName}=`)).map((item) => item.slice(session.cookieName.length + 1)) : [];
    if (
      this.isClosed ||
      request.headers.host !== new URL(this.origin).host ||
      (request.headers.origin && request.headers.origin !== this.origin) ||
      request.headers['sec-fetch-site'] === 'cross-site' ||
      !session ||
      session.expiresAt <= this.now() ||
      credentials.length !== 1 ||
      !/^[a-f0-9]{64}$/.test(credentials[0]) ||
      !timingSafeEqual(session.credentialHash, createHash('sha256').update(credentials[0]).digest())
    ) {
      this.reply(response, 403, { error: 'ACCESS_DENIED' });
      return;
    }
    try {
      await this.options.authorize(session);
    } catch {
      this.reply(response, 403, { error: 'ACCESS_DENIED' });
      return;
    }
    let input: Record<string, unknown>;
    if (!match![2] && request.method === 'GET') {
      input = { operation: 'html', endpoint: `${session.prefix}/v1` };
    } else if (match![2] === 'v1' && request.method === 'POST') {
      try {
        if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') throw new Error('Invalid content type');
        const chunks: Buffer[] = [];
        let bytes = 0;
        for await (const chunk of request) {
          bytes += chunk.length;
          if (bytes > 65536) throw new Error('Invalid request size');
          chunks.push(Buffer.from(chunk));
        }
        const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid request');
        input = body as Record<string, unknown>;
        if (Object.keys(input).some((key) => !['view', 'operation', 'params'].includes(key)) || input.view !== session.workspaceId || typeof input.operation !== 'string' || !['head', 'graph', 'context', 'page', 'export'].includes(input.operation)) throw new Error('Invalid operation');
        if ('params' in input && (!input.params || typeof input.params !== 'object' || Array.isArray(input.params))) throw new Error('Invalid params');
        input = { operation: input.operation, ...('params' in input ? { params: input.params } : {}) };
      } catch {
        this.reply(response, 400, { error: 'READ_CONTRACT' });
        return;
      }
    } else {
      this.reply(response, 405, { error: 'READ_CONTRACT' });
      return;
    }
    try {
      try {
        await this.options.authorize(session);
      } catch {
        this.reply(response, 403, { error: 'ACCESS_DENIED' });
        return;
      }
      const result = await this.options.read(session.workspaceId, input);
      try {
        await this.options.authorize(session);
      } catch {
        this.reply(response, 403, { error: 'ACCESS_DENIED' });
        return;
      }
      // A close/revoke while the compiler was working must not release its result.
      if (session.expiresAt <= this.now() || this.sessions.get(match![1]) !== session) {
        this.reply(response, 403, { error: 'ACCESS_DENIED' });
        return;
      }
      this.reply(response, 200, input.operation === 'html' ? result : { result }, input.operation === 'html');
    } catch (error) {
      if (error instanceof SudographCompilerError) {
        const status = error.code === 'ACCESS_DENIED' ? 403 : ['CONTEXT_STALE', 'REVISION_UNKNOWN', 'SOURCE_SCHEMA_CHANGED'].includes(error.code) ? 409 : ['READ_CONTRACT', 'TARGET_UNKNOWN', 'CONTEXT_TARGET_UNKNOWN'].includes(error.code) ? 400 : 503;
        this.reply(response, status, { error: error.code, recovery: status === 409 ? 'Reload the registered model and retry this page.' : 'Use the host review entry or ask its operator.' });
      } else this.reply(response, 503, { error: 'VIEW_UNAVAILABLE' });
    }
  }

  private reply(response: ServerResponse, status: number, result: unknown, isHtml = false): void {
    if (response.destroyed || response.writableEnded) return;
    const body = isHtml && typeof result === 'string' ? result : JSON.stringify(result);
    response.writeHead(status, { 'Content-Type': isHtml ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Content-Length': Buffer.byteLength(body) });
    response.end(body);
  }

  async close(): Promise<void> {
    this.isClosed = true;
    this.sessions.clear();
    await this.startup?.catch((): undefined => undefined);
    if (this.server?.listening) {
      this.server.closeIdleConnections();
      await new Promise<void>((resolve, reject) => this.server!.close((error) => (error ? reject(error) : resolve())));
    }
  }
}
