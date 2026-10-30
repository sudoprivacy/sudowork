/// <reference types="node" preserve="true" />
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { SudographCompilerError } from './SudographModelClient.js';
import type { ShareoneReviewAssets } from './ShareoneReviewAssets.js';

export interface ISudographReviewBinding {
  workspaceId: string;
  conversationId: string;
  /** Opaque host-owned ownership/generation reference, not a model revision. */
  authorizationRef?: string;
}

export interface ISudographReviewGrant extends ISudographReviewBinding {
  prefix: string;
  cookieName: string;
  credentialHash: string;
  expiresAt: number;
  shareId?: string | null;
  revision?: string;
}

/** Host-owned durable grants. Never store the raw launch credential. */
export interface ISudographReviewGrantStore {
  /** Atomically insert a new ID, prune expired grants and enforce host capacity. */
  create(id: string, grant: ISudographReviewGrant): void | Promise<void>;
  get(id: string): ISudographReviewGrant | undefined | Promise<ISudographReviewGrant | undefined>;
  /** Compare immutable grant identity before changing comment/render metadata. */
  update(id: string, expected: ISudographReviewGrant, changes: Pick<ISudographReviewGrant, 'shareId' | 'revision'>): boolean | Promise<boolean>;
  delete(id: string): void | Promise<void>;
}

export interface ISudographReviewHostOptions {
  authorize: (binding: ISudographReviewBinding) => void | string | Promise<void | string>;
  read: (workspaceId: string, request: Record<string, unknown>, binding: ISudographReviewBinding) => Promise<unknown>;
  now?: () => number;
  /** Mount handleRequest on the existing host. Public origins require HTTPS. */
  embedded?: { origin: string; grants: ISudographReviewGrantStore };
  comments?: {
    assets: ShareoneReviewAssets;
    prepare: (binding: ISudographReviewBinding) => Promise<{ shareId: string } | null>;
    proxy: (binding: ISudographReviewBinding & { revision?: string }, route: string, method: string, body?: Record<string, unknown>) => Promise<{ status: number; body: unknown }>;
    status: (binding: ISudographReviewBinding) => unknown;
  };
}

/** Private browser-host handoff. Never return this object through IPC or MCP. */
export interface ISudographReviewLaunch {
  url: string;
  cookie: {
    name: string;
    value: string;
    url: string;
    path: string;
    httpOnly: true;
    sameSite: 'Strict';
    expires: number;
  };
  revoke: () => void | Promise<void>;
}

/** Execution-local transport. Each host supplies its current authorization and comment providers. */
export class SudographReviewHost {
  private readonly sessions = new Map<string, ISudographReviewGrant>();
  private readonly grants: ISudographReviewGrantStore;
  private server: Server | undefined;
  private startup: Promise<string> | undefined;
  private origin = '';
  private isClosed = false;

  constructor(private readonly options: ISudographReviewHostOptions) {
    if (options.embedded) {
      const origin = new URL(options.embedded.origin);
      if (origin.origin !== options.embedded.origin || origin.username || origin.password || (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(origin.hostname)))) throw new Error('Review ingress requires an HTTPS origin or explicit loopback origin.');
      this.origin = origin.origin;
    }
    this.grants = options.embedded?.grants ?? {
      create: (id, grant) => {
        for (const [key, current] of this.sessions) if (current.expiresAt <= this.now()) this.sessions.delete(key);
        if (this.sessions.size >= 128 || this.sessions.has(id)) throw new Error('Close existing review sessions before opening another.');
        this.sessions.set(id, { ...grant });
      },
      get: (id) => this.sessions.get(id),
      update: (id, expected, changes) => {
        const current = this.sessions.get(id);
        if (!current || !sameGrant(current, expected)) return false;
        Object.assign(current, changes);
        return true;
      },
      delete: (id) => {
        this.sessions.delete(id);
      },
    };
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private async authorize(binding: ISudographReviewBinding): Promise<void> {
    const current = await this.options.authorize(binding);
    if (this.options.embedded && (!binding.authorizationRef || current !== binding.authorizationRef)) throw new Error('Current review authorization reference does not match.');
  }

  /** Called after host ownership checks, then installed by the trusted browser host. */
  async createSession(binding: ISudographReviewBinding): Promise<ISudographReviewLaunch> {
    binding = {
      workspaceId: binding.workspaceId,
      conversationId: binding.conversationId,
      ...(binding.authorizationRef === undefined ? {} : { authorizationRef: binding.authorizationRef }),
    };
    if (this.isClosed) throw new Error('Review host is closed.');
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(binding.workspaceId) || !binding.conversationId || binding.conversationId.length > 256) throw new Error('Invalid review binding.');
    if (this.options.embedded && !binding.authorizationRef) throw new Error('Embedded review requires a durable authorization reference.');
    if (binding.authorizationRef !== undefined && !/^[a-zA-Z0-9:_-]{1,256}$/.test(binding.authorizationRef)) throw new Error('Invalid review authorization reference.');
    await this.authorize(binding);
    if (this.isClosed) throw new Error('Review host is closed.');
    this.startup ??= (this.options.embedded ? Promise.resolve(this.origin) : this.start()).catch((error) => {
      this.startup = undefined;
      throw error;
    });
    const origin = await this.startup;
    if (this.isClosed) throw new Error('Review host is closed.');
    const id = randomBytes(16).toString('hex');
    const credential = randomBytes(32).toString('hex');
    const prefix = `/review/${id}`;
    const cookieName = `sudograph_review_${id}`;
    const expiresAt = this.now() + 30 * 60_000;
    await this.grants.create(id, {
      ...binding,
      prefix,
      cookieName,
      credentialHash: createHash('sha256').update(credential).digest('hex'),
      expiresAt,
    });
    if (this.isClosed) {
      await this.grants.delete(id);
      throw new Error('Review host is closed.');
    }
    // Ordinary JSON, structured-clone, logging and bridge redaction must not
    // serialize the credential. Only the trusted browser host reads it explicitly.
    return Object.freeze(
      Object.defineProperties(
        { url: `${origin}${prefix}/` },
        {
          cookie: {
            value: Object.freeze({
              name: cookieName,
              value: credential,
              url: `${origin}${prefix}/`,
              path: `${prefix}/`,
              httpOnly: true,
              sameSite: 'Strict',
              expires: Math.floor(expiresAt / 1000),
            }),
          },
          revoke: { value: () => this.grants.delete(id) },
        }
      )
    ) as ISudographReviewLaunch;
  }

  private async start(): Promise<string> {
    const server = createServer((request, response) => {
      void this.handleRequest(request, response).then((handled) => {
        if (!handled) this.reply(response, 404, { error: 'VIEW_UNAVAILABLE' });
      });
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

  /** Existing HTTP servers delegate this route; no listener or proxy is created in embedded mode. */
  async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    if (!/^\/review(?:\/|$)/.test(request.url || '')) return false;
    try {
      await this.respond(request, response);
    } catch {
      this.reply(response, 503, { error: 'VIEW_UNAVAILABLE' });
    }
    return true;
  }

  private async current(id: string, session: ISudographReviewGrant): Promise<boolean> {
    const current = await this.grants.get(id);
    return !this.isClosed && !!current && current.expiresAt > this.now() && sameGrant(current, session);
  }

  private async respond(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const match = /^\/review\/([a-f0-9]{32})\/(.*)$/.exec(request.url || '');
    const session = match && (await this.grants.get(match[1]));
    const cookies = (request.headers.cookie || '').split(';').map((item) => item.trim());
    const credentials = session ? cookies.filter((item) => item.startsWith(`${session.cookieName}=`)).map((item) => item.slice(session.cookieName.length + 1)) : [];
    if (
      this.isClosed ||
      request.headers.host !== new URL(this.origin).host ||
      (request.headers.origin && request.headers.origin !== this.origin) ||
      request.headers['sec-fetch-site'] === 'cross-site' ||
      !session ||
      session.prefix !== `/review/${match![1]}` ||
      session.cookieName !== `sudograph_review_${match![1]}` ||
      !/^[a-f0-9]{64}$/.test(session.credentialHash) ||
      (!this.options.comments && !['', 'v1'].includes(match?.[2] || '')) ||
      session.expiresAt <= this.now() ||
      credentials.length !== 1 ||
      !/^[a-f0-9]{64}$/.test(credentials[0]) ||
      !timingSafeEqual(Buffer.from(session.credentialHash, 'hex'), createHash('sha256').update(credentials[0]).digest())
    ) {
      this.reply(response, 403, { error: 'ACCESS_DENIED' });
      return;
    }
    try {
      await this.authorize(session);
    } catch {
      this.reply(response, 403, { error: 'ACCESS_DENIED' });
      return;
    }
    if (this.options.comments && match![2] !== 'v1') {
      await this.respondComments(request, response, session, match![2], match![1]);
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
        input = {
          operation: input.operation,
          ...('params' in input ? { params: input.params } : {}),
        };
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
        await this.authorize(session);
      } catch {
        this.reply(response, 403, { error: 'ACCESS_DENIED' });
        return;
      }
      const result = await this.options.read(session.workspaceId, input, session);
      try {
        await this.authorize(session);
      } catch {
        this.reply(response, 403, { error: 'ACCESS_DENIED' });
        return;
      }
      // A close/revoke while the compiler was working must not release its result.
      if (!(await this.current(match![1], session))) {
        this.reply(response, 403, { error: 'ACCESS_DENIED' });
        return;
      }
      this.reply(response, 200, input.operation === 'html' ? result : { result }, input.operation === 'html');
    } catch (error) {
      if (error instanceof SudographCompilerError) {
        const status = error.code === 'ACCESS_DENIED' ? 403 : ['CONTEXT_STALE', 'REVISION_UNKNOWN', 'SOURCE_SCHEMA_CHANGED'].includes(error.code) ? 409 : ['READ_CONTRACT', 'TARGET_UNKNOWN', 'CONTEXT_TARGET_UNKNOWN'].includes(error.code) ? 400 : 503;
        this.reply(response, status, {
          error: error.code,
          recovery: status === 409 ? 'Reload the registered model and retry this page.' : 'Use the host review entry or ask its operator.',
        });
      } else this.reply(response, 503, { error: 'VIEW_UNAVAILABLE' });
    }
  }

  private async respondComments(request: IncomingMessage, response: ServerResponse, session: ISudographReviewGrant, route: string, id: string): Promise<void> {
    const provider = this.options.comments!;
    const send = async (status: number, result: unknown, html = false) => {
      try {
        await this.authorize(session);
      } catch {
        this.reply(response, 403, { error: 'ACCESS_DENIED' });
        return;
      }
      if (!(await this.current(id, session))) {
        this.reply(response, 403, { error: 'ACCESS_DENIED' });
        return;
      }
      this.reply(response, status, result, html);
    };
    if (request.method === 'GET' && route.startsWith('assets/')) {
      const asset = provider.assets.get(route.slice('assets/'.length));
      if (!asset) return send(404, { error: 'ASSET_UNAVAILABLE' });
      await this.authorize(session);
      if (!(await this.current(id, session))) return this.reply(response, 403, { error: 'ACCESS_DENIED' });
      response.writeHead(200, {
        'Content-Type': asset.contentType,
        'Content-Length': asset.body.length,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      response.end(asset.body);
      return;
    }
    if (request.method === 'GET' && route === '') {
      const head = (await this.options.read(session.workspaceId, { operation: 'head' }, session)) as { revision: string };
      return send(
        200,
        provider.assets.shell(session.prefix, {
          share_id: session.shareId || '',
          filename: 'Model review',
          content_kind: 'html',
          allow_comments: true,
          rawUrl: `${session.prefix}/content`,
          api_base: session.prefix,
          host_read_endpoint: `${session.prefix}/v1`,
          revision_url: `${session.prefix}/head`,
          revision: head.revision,
          delivery_url: `${session.prefix}/delivery`,
          connection_url: `${session.prefix}/connection`,
          site_url: 'https://shareone.vip',
          publish_url: 'https://shareone.vip',
        }),
        true
      );
    }
    if (request.method === 'GET' && route === 'connection') {
      try {
        if (!session.shareId) {
          session.shareId = (await provider.prepare(session))?.shareId || null;
          if (
            !(await this.grants.update(id, session, {
              shareId: session.shareId,
            }))
          )
            return send(403, { error: 'ACCESS_DENIED' });
        }
        return send(200, session.shareId ? { state: 'ready', share_id: session.shareId } : { state: 'account_required' });
      } catch {
        // Failure to read an existing credential is not proof that none exists.
        return send(503, {
          state: 'unavailable',
          error: 'REVIEW_CONNECTION_UNAVAILABLE',
        });
      }
    }
    if (request.method === 'GET' && route === 'content') {
      const document = (await this.options.read(session.workspaceId, { operation: 'document', endpoint: `${session.prefix}/v1` }, session)) as { html: string; revision: string };
      if (!document?.html || !document.revision) return send(503, { error: 'MODEL_DOCUMENT_UNAVAILABLE' });
      session.revision = document.revision;
      if (!(await this.grants.update(id, session, { revision: session.revision }))) return send(403, { error: 'ACCESS_DENIED' });
      return send(200, document.html, true);
    }
    if (request.method === 'GET' && route === 'head') return send(200, await this.options.read(session.workspaceId, { operation: 'head' }, session));
    if (request.method === 'GET' && route === 'delivery') return send(200, await provider.status(session));
    if (route.startsWith('api/v1/')) {
      let body: Record<string, unknown> | undefined;
      if (['POST', 'PUT', 'DELETE'].includes(request.method || '')) {
        try {
          if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json' && request.method !== 'DELETE') throw new Error('Content type');
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of request) {
            size += chunk.length;
            if (size > 1024 * 1024) throw new Error('Size');
            chunks.push(Buffer.from(chunk));
          }
          if (size) {
            const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Body');
            body = value as Record<string, unknown>;
          }
        } catch {
          return send(400, { error: 'COMMENT_CONTRACT' });
        }
      }
      const result = await provider.proxy(session, '/' + route, request.method || 'GET', body);
      return send(result.status, result.body);
    }
    return send(404, { error: 'VIEW_UNAVAILABLE' });
  }

  private reply(response: ServerResponse, status: number, result: unknown, isHtml = false): void {
    if (response.destroyed || response.writableEnded) return;
    const body = isHtml && typeof result === 'string' ? result : JSON.stringify(result);
    response.writeHead(status, {
      'Content-Type': isHtml ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'Content-Length': Buffer.byteLength(body),
    });
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

/** Mutable comment/render metadata is not grant identity. */
function sameGrant(left: ISudographReviewGrant, right: ISudographReviewGrant): boolean {
  return (
    left.workspaceId === right.workspaceId && left.conversationId === right.conversationId && left.authorizationRef === right.authorizationRef && left.prefix === right.prefix && left.cookieName === right.cookieName && left.credentialHash === right.credentialHash && left.expiresAt === right.expiresAt
  );
}
