import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import { BrowserSessionActionSchema, BrowserSessionReplySchema, BrowserFileSchema, type BrowserSessionAction, type BrowserSessionReply } from '@sudowork/contracts/browser-session';
import type { LocalAgentToolControl } from './LocalAgentToolControl';
import { LocalBrowserWorker } from './LocalBrowserWorker';

interface ILocalBrowserSessionsOptions {
  root: string;
  runtime: () => Promise<string>;
  tools: () => unknown[];
  control: LocalAgentToolControl;
  onReturn: (conversationId: string, note: string | undefined, epoch: number) => Promise<void>;
  env?: NodeJS.ProcessEnv;
  chromeArgs?: string[];
}

/** Desktop host policy around the same public worker used by cloud sessions. */
export class LocalBrowserSessions {
  private readonly workers = new Map<string, Promise<LocalBrowserWorker>>();
  private readonly tokens = new Map<string, string>();
  private readonly conversations = new Map<string, string>();
  private server: Server | undefined;
  private serverStartup: Promise<number> | undefined;

  constructor(private readonly options: ILocalBrowserSessionsOptions) {}

  private worker(conversationId: string): Promise<LocalBrowserWorker> {
    if (!conversationId || conversationId.length > 256) throw new Error('Invalid local browser conversation');
    let pending = this.workers.get(conversationId);
    if (pending) {
      const existing = pending;
      return existing.then((worker) => {
        if (!worker.isDisconnected) return worker;
        if (this.workers.get(conversationId) === existing) this.workers.delete(conversationId);
        // Restart only the dead host process. The public worker restores its
        // stopped journal and never reconnects personal Chrome implicitly.
        return this.worker(conversationId);
      });
    }
    if (!pending) {
      pending = (async () => {
        const profile = createHash('sha256').update(conversationId).digest('hex');
        const worker = new LocalBrowserWorker({
          root: path.join(this.options.root, profile),
          python: await this.options.runtime(),
          binding: { orgId: 'local', userId: `desktop-profile-${profile}`, sessionId: conversationId },
          env: this.options.env,
          chromeArgs: this.options.chromeArgs,
          existingExtensionRoot: path.join(this.options.root, 'personal-profile-leases'),
        });
        await worker.start();
        return worker;
      })().catch((error) => {
        if (this.workers.get(conversationId) === pending) this.workers.delete(conversationId);
        throw error;
      });
      this.workers.set(conversationId, pending);
    }
    return pending;
  }

  private async state(worker: LocalBrowserWorker): Promise<BrowserSessionReply> {
    return BrowserSessionReplySchema.parse(await worker.invoke({ kind: 'state' }));
  }

  private decorate(conversationId: string, reply: BrowserSessionReply): BrowserSessionReply {
    reply = { ...reply, session: { ...reply.session, capabilities: { ...reply.session.capabilities, conversationControl: true } } };
    const host = this.options.control.status();
    if (host.state === 'ai') return reply;
    if (host.owner !== conversationId) return { ...reply, session: { ...reply.session, state: 'error', isController: false, isHumanControlHeld: true, error: 'browser_control_held_by_another_conversation' } };
    return { ...reply, session: { ...reply.session, state: host.state === 'human' || reply.session.state === 'stopped' ? reply.session.state : host.state, error: host.error || reply.session.error } };
  }

  /** An ordinary authenticated chat send resumes the existing lease once. */
  async prepareUserMessage(conversationId: string): Promise<number> {
    const host = this.options.control.status();
    if (host.state === 'ai') return this.options.control.assertCanPrompt(host.epoch);
    if (host.owner !== conversationId || !['human', 'error'].includes(host.state)) throw new Error('Browser control transfer is in progress or belongs to another conversation');
    const worker = await this.worker(conversationId);
    const { session } = await this.state(worker);
    await this.invoke(conversationId, { kind: 'return', controlEpoch: session.controlEpoch, targetEpoch: session.targetEpoch }, true);
    return this.options.control.assertCanPrompt(host.epoch);
  }

  /** The normal Stop path acquires only an already allocated browser. */
  async interruptConversation(conversationId: string): Promise<boolean> {
    if (!this.workers.has(conversationId)) return false;
    const { session } = await this.state(await this.worker(conversationId));
    if (session.state === 'stopped' || (session.state === 'human' && session.isController)) return false;
    await this.invoke(conversationId, { kind: 'take', controlEpoch: session.controlEpoch, targetEpoch: session.targetEpoch });
    return true;
  }

  async invoke(conversationId: string, value: BrowserSessionAction, isConversationContinuation = false): Promise<BrowserSessionReply> {
    const action = BrowserSessionActionSchema.parse(value);
    if (action.kind === 'state' && !this.workers.has(conversationId)) {
      if (!conversationId || conversationId.length > 256) throw new Error('Invalid local browser conversation');
      return this.decorate(conversationId, {
        session: {
          browserSessionId: 'unallocated',
          profileId: `unallocated-${createHash('sha256').update(conversationId).digest('hex')}`,
          state: 'stopped',
          controlEpoch: 0,
          targetEpoch: 0,
          isController: false,
          isHumanControlHeld: false,
          isHeadless: true,
          transport: 'cdp',
          capabilities: { lifecycle: true, fileTransfer: true, existingExtension: true, pageView: true, windowView: false, persistentProfile: true },
          activeTargetId: null,
          tabs: [],
          error: null,
        },
      });
    }
    const worker = await this.worker(conversationId);
    let reply: BrowserSessionReply | undefined;
    if (action.kind === 'take' || action.kind === 'start' || action.kind === 'connect-existing-extension' || action.kind === 'disconnect-existing-extension') {
      const before = await this.state(worker);
      if ((action.kind === 'take' || action.kind === 'disconnect-existing-extension') && (before.session.controlEpoch !== action.controlEpoch || before.session.targetEpoch !== action.targetEpoch)) throw new Error('stale_browser_operation');
      const acquireBrowser = async () => {
        reply = BrowserSessionReplySchema.parse(await worker.invoke(action));
        if (!reply.session.isController) throw new Error('Browser did not acknowledge human control');
      };
      const host = this.options.control.status();
      if (action.kind !== 'take' && host.state === 'human' && host.owner === conversationId) await acquireBrowser();
      else await this.options.control.take(conversationId, acquireBrowser);
    } else if (action.kind === 'return') {
      const before = await this.state(worker);
      if (before.session.controlEpoch !== action.controlEpoch || before.session.targetEpoch !== action.targetEpoch) throw new Error('stale_browser_operation');
      const host = this.options.control.status();
      const returned = await this.options.control.giveBack(conversationId, host.epoch, async () => {
        if (before.session.state === 'ai') {
          // A previous return may have succeeded at the browser and lost an
          // engine acknowledgement. Observe again; never replay that return.
          const observed = (await worker.mcp({ jsonrpc: '2.0', id: 'return-observation', method: 'tools/call', params: { name: 'browser_observe', arguments: {} } })) as { result?: { isError?: boolean } };
          if (!observed.result || observed.result.isError) throw new Error('The browser could not confirm a fresh observation');
          reply = await this.state(worker);
        } else reply = BrowserSessionReplySchema.parse(await worker.invoke(action));
      });
      // One new continuation turn, after both observation and engine admission
      // are acknowledged. A lost notification is reported instead of replayed.
      if (!isConversationContinuation) await this.options.onReturn(conversationId, action.note, returned.epoch);
    } else {
      if (['input', 'navigate', 'back', 'forward', 'reload', 'new-tab', 'select-tab', 'close-tab', 'upload-files', 'stop', 'restart', 'disconnect-existing-extension'].includes(action.kind)) {
        const host = this.options.control.status();
        if (host.owner !== conversationId || host.state !== 'human') throw new Error('Browser takeover has not been acknowledged by the local agents');
      }
      reply = BrowserSessionReplySchema.parse(await worker.invoke(action));
    }
    return this.decorate(conversationId, reply!);
  }

  async upload(conversationId: string, input: { name: string; data: Uint8Array; controlEpoch: number; targetEpoch: number }) {
    const host = this.options.control.status();
    if (host.owner !== conversationId || host.state !== 'human') throw new Error('Browser control is not owned by this conversation');
    const worker = await this.worker(conversationId);
    const result = (await worker.upload(input)) as { file: unknown };
    return BrowserFileSchema.parse(result.file);
  }

  async download(conversationId: string, fileId: string) {
    return (await this.worker(conversationId)).download(fileId);
  }

  async mcpConfig(conversationId: string) {
    let token = this.conversations.get(conversationId);
    if (!token) {
      token = randomBytes(32).toString('hex');
      this.conversations.set(conversationId, token);
      this.tokens.set(token, conversationId);
    }
    this.serverStartup ??= this.startServer();
    const port = await this.serverStartup;
    return { name: 'sudowork-browser', type: 'http' as const, url: `http://127.0.0.1:${port}/mcp`, headers: [{ name: 'Authorization', value: `Bearer ${token}` }] };
  }

  private async startServer(): Promise<number> {
    this.server = createServer((request, response) => {
      void this.onMcpRequest(request, response).catch(() => {
        if (!response.headersSent) response.writeHead(500, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: 'local_browser_request_failed' }));
      });
    });
    return new Promise<number>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(0, '127.0.0.1', () => {
        const address = this.server!.address();
        if (!address || typeof address === 'string') reject(new Error('Local browser bridge could not listen'));
        else resolve(address.port);
      });
    });
  }

  private async onMcpRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const token = request.headers.authorization?.replace(/^Bearer /, '');
    const conversationId = token && this.tokens.get(token);
    if (request.headers.origin || !conversationId || request.url !== '/mcp') {
      response.writeHead(403).end();
      return;
    }
    if (request.method !== 'POST') {
      response.writeHead(405).end();
      return;
    }
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 256 * 1024) {
        response.writeHead(413).end();
        return;
      }
      chunks.push(Buffer.from(chunk));
    }
    const message = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { id?: string | number; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } };
    if (message.id === undefined) {
      response.writeHead(202).end();
      return;
    }
    let result: unknown;
    if (message.method === 'initialize') result = { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'sudowork-browser', version: '1.0.0' } };
    else if (message.method === 'ping') result = {};
    else if (message.method === 'tools/list')
      result = {
        tools: this.options.tools().map((value) => {
          const tool = value as { name: string; description: string; inputSchema: { properties: Record<string, Record<string, unknown>> } };
          if (tool.name !== 'browser_launch') return tool;
          return {
            ...tool,
            description:
              "Start the browser shared with the user. Choose headless/headful from the task and pass it explicitly; headless still supports a page viewer. Desktop launches standalone Chrome through CDP. For the user's existing Chrome/profile, ask them to select Connect my Chrome in the Browser panel; browser_launch does not attach a personal profile or change its launch mode. When human help is needed, use your native question/options or ordinary conversation. The user uses the existing conversation interrupt and sends a normal message when ready. There are no required browser takeover/return buttons. Host acknowledgements and browser leases still apply: while browser_control_held_by_user is reported, wait and do not bypass it through another tool, shell or browser. After continuation, call browser_observe and discard old coordinates and queued inputs. Never request passwords, cookies or verification codes in chat.",
            inputSchema: { ...tool.inputSchema, properties: { ...tool.inputSchema.properties, transport: { ...tool.inputSchema.properties.transport, enum: ['cdp'], default: 'cdp' } } },
          };
        }),
      };
    else if (message.method === 'tools/call') {
      if (message.params?.name === 'browser_launch' && message.params.arguments?.transport === 'extension') {
        response.writeHead(200, { 'Content-Type': 'application/json' }).end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            result: {
              isError: true,
              content: [{ type: 'text', text: 'Desktop extension mode requires the user to explicitly select Connect my Chrome in the Browser panel. Ask through your native conversation; after the user sends a normal message to continue, call browser_observe on that same connected session.' }],
            },
          })
        );
        return;
      }
      try {
        const epoch = this.options.control.assertCanPrompt();
        const worker = await this.worker(conversationId);
        // Downloading dependencies or starting Python never authorizes a tool
        // after its caller disconnected or a human took over in the meantime.
        if (response.destroyed) return;
        this.options.control.assertCanPrompt(epoch);
        // The public worker defaults to the cloud policy. Desktop owns this
        // launch default while preserving an explicit compatibility choice.
        if (message.params?.name === 'browser_launch' && message.params.arguments?.transport === undefined) message.params.arguments = { ...message.params.arguments, transport: 'cdp' };
        const forwarded = await worker.mcp(message);
        response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(forwarded));
        return;
      } catch {
        result = { isError: true, content: [{ type: 'text', text: this.options.control.status().state !== 'ai' ? 'browser_control_held_by_user' : 'local_browser_unavailable' }] };
      }
    } else {
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } }));
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
  }

  async close(): Promise<void> {
    // Personal Chrome can outlive the app; stop all agent tools before
    // releasing the connection so a still-running agent cannot race it.
    for (const conversationId of [...this.workers.keys()]) {
      const reply = await this.state(await this.worker(conversationId));
      const host = this.options.control.status();
      if (reply.session.personalExtension && (host.state === 'ai' || (host.state === 'error' && host.owner === conversationId))) await this.options.control.take(conversationId, async () => {});
    }
    const results = await Promise.allSettled([...this.workers.values()].map(async (pending) => (await pending).close()));
    this.tokens.clear();
    this.conversations.clear();
    if (this.server) {
      this.server.closeIdleConnections();
      await new Promise<void>((resolve, reject) => this.server!.close((error) => (error ? reject(error) : resolve())));
    }
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failures.length)
      throw new AggregateError(
        failures.map((result) => result.reason),
        'Some local browser workers did not confirm shutdown'
      );
  }
}
