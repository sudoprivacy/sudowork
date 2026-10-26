import { createHash, randomUUID } from 'node:crypto';
import type { OntologyStudioDatabase, IReviewInboxItem, IReviewSubscription } from './OntologyStudioDatabase';

interface ICommentSpace {
  shareId: string;
  ownerId: string;
  account: string;
  consumer: string;
}
interface IProviderResponse {
  status: number;
  body: Record<string, unknown> | unknown[];
}
interface ICommentThread {
  id: string;
  content: string;
  quote: string;
  highlighter_data: unknown;
  anchor_binding?: { quote: string; highlighter_data: unknown };
  replies?: Array<{ id: string; content: string; author_role: string }>;
}
interface ICommentsOptions {
  database: OntologyStudioDatabase;
  baseUrl: string;
  currentAccount: () => string;
  getKey: () => Promise<string | null>;
  setKey: (key: string | null) => Promise<void>;
  authorize: (binding: { workspaceId: string; conversationId: string }) => Promise<void>;
  head: (workspaceId: string) => Promise<{ revision: string; context_digest: string }>;
  deliver: (input: { conversationId: string; messageId: string; content: string; agentContent: string }, hooks: { onStarted: () => Promise<void>; onCompleted: (text: string, error?: string) => Promise<void> }) => Promise<{ success: boolean; msg?: string }>;
  messageExists: (conversationId: string, messageId: string) => boolean | Promise<boolean>;
}

const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const EMPTY_REVIEW = '<!doctype html><html lang="en"><meta charset="utf-8"><title>Private model review</title><p>This private space stores review comments. Model content is served by its authenticated host.</p></html>';

/** ShareOne owns comments; the existing host registry/inbox owns their routing. */
export class SudographReviewComments {
  private readonly opening = new Map<string, Promise<ICommentSpace | null>>();
  private readonly watchers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly active = new Set<string>();
  private readonly errors = new Map<string, string>();
  private readonly requests = new Set<AbortController>();
  private isClosed = false;

  constructor(private readonly options: ICommentsOptions) {
    const url = new URL(options.baseUrl);
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)))) throw new Error('Invalid deployed ShareOne origin.');
  }

  private async request(route: string, method = 'GET', body?: unknown, key?: string | null, idempotencyKey?: string): Promise<IProviderResponse> {
    if (!route.startsWith('/api/') || route.startsWith('//') || route.includes('..')) throw new Error('Invalid ShareOne route.');
    const account = this.options.currentAccount();
    const credential = key === undefined ? await this.options.getKey() : key;
    if (account !== this.options.currentAccount()) throw new Error('Review account changed.');
    if (this.isClosed) throw new Error('Review comments are closed.');
    const controller = new AbortController();
    this.requests.add(controller);
    try {
      const response = await fetch(new URL(route, this.options.baseUrl), {
        method,
        redirect: 'error',
        signal: AbortSignal.any([AbortSignal.timeout(30000), controller.signal]),
        headers: { 'Content-Type': 'application/json', ...(credential ? { 'X-API-Key': credential } : {}), ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await response.text();
      if (text.length > 8 * 1024 * 1024) throw new Error('ShareOne response exceeds the review limit.');
      if (account !== this.options.currentAccount()) throw new Error('Review account changed.');
      const result = text ? JSON.parse(text) : {};
      return { status: response.status, body: result };
    } finally {
      this.requests.delete(controller);
    }
  }

  private requireSuccess(response: IProviderResponse): Record<string, unknown> {
    if (response.status < 200 || response.status >= 300 || Array.isArray(response.body)) {
      const code = !Array.isArray(response.body) && typeof response.body.error_code === 'string' && /^[A-Z0-9_:-]+$/.test(response.body.error_code) ? response.body.error_code : 'PROVIDER_ERROR';
      throw new Error(`ShareOne request failed (${response.status}, ${code}).`);
    }
    return response.body;
  }

  async prepare(workspaceId: string, conversationId: string): Promise<ICommentSpace | null> {
    await this.options.authorize({ workspaceId, conversationId });
    const account = this.options.currentAccount();
    const operation = `${workspaceId}:${account}`;
    if (!this.opening.has(operation))
      this.opening.set(
        operation,
        this.open(workspaceId, account).finally(() => this.opening.delete(operation))
      );
    const space = await this.opening.get(operation)!;
    await this.options.authorize({ workspaceId, conversationId });
    if (account !== this.options.currentAccount()) throw new Error('Review account changed.');
    if (space) {
      const subscription = { id: digest(`${space.shareId}:${conversationId}:${account}`), workspaceId, conversationId, account, shareId: space.shareId };
      this.options.database.subscribeReview(subscription);
      if (space.account === account) this.watch(workspaceId, space);
    }
    return space;
  }

  private async open(workspaceId: string, account: string): Promise<ICommentSpace | null> {
    const key = await this.options.getKey();
    if (account !== this.options.currentAccount()) throw new Error('Review account changed.');
    if (!key) return null;
    const me = this.requireSuccess(await this.request('/api/v1/me', 'GET', undefined, key));
    let space = this.options.database.getHostValue<ICommentSpace>('review-space:' + workspaceId);
    if (!space) {
      const response = this.requireSuccess(
        await this.request(
          '/api/v1/pages',
          'POST',
          {
            filename: 'private-model-review.html',
            html_content: EMPTY_REVIEW,
            viewer_scope: 'owner_and_collaborators',
            is_public: false,
            allow_comments: true,
            allow_data: false,
            allow_sign: false,
          },
          key,
          'sudograph-review-' + digest(`${workspaceId}:${String(me.id)}`)
        )
      );
      if (['automatic_pending', 'manual_required', 'rejected'].includes(String(response.status))) {
        throw new Error(`ShareOne review space requires approval (${String(response.status)}, review ${String(response.review_id)}).`);
      }
      const settings = response.settings as Record<string, unknown> | undefined;
      if (typeof response.share_id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(response.share_id) || settings?.viewer_scope !== 'owner_and_collaborators' || settings.allow_comments !== true || settings.is_public !== false) throw new Error('ShareOne did not confirm private comments enabled.');
      let installation = this.options.database.getHostValue<string>('review-installation');
      if (!installation) {
        installation = randomUUID();
        this.options.database.setHostValue('review-installation', installation);
      }
      space = { shareId: response.share_id, ownerId: String(me.id), account, consumer: 'sg-' + digest(workspaceId + ':' + installation).slice(0, 40) };
      this.options.database.setHostValue('review-space:' + workspaceId, space);
    } else if (space.ownerId === me.id) {
      // The owner-selected integrated review policy is private, with comments on.
      const response = this.requireSuccess(await this.request(`/api/v1/pages/${space.shareId}`, 'PUT', { viewer_scope: 'owner_and_collaborators', allow_comments: true, is_public: false }, key));
      const settings = response.settings as Record<string, unknown> | undefined;
      if (settings?.viewer_scope !== 'owner_and_collaborators' || settings.allow_comments !== true) throw new Error('ShareOne review policy could not be confirmed.');
    }
    // This read enforces current ShareOne collaborator/viewer access too.
    this.requireSuccess(await this.request(`/api/v1/shares/${space.shareId}/comments/changes`));
    this.requireSuccess(await this.request(`/api/v1/agent-consumers/${space.consumer}`, 'PUT', { share_id: space.shareId, start: 'beginning' }));
    if (account !== this.options.currentAccount()) throw new Error('Review account changed.');
    return space;
  }

  async proxy(binding: { workspaceId: string; conversationId: string; revision?: string }, route: string, method: string, body?: Record<string, unknown>): Promise<IProviderResponse> {
    await this.options.authorize(binding);
    const account = this.options.currentAccount();
    if (route === '/api/v1/auth/pair-key' && method === 'POST') {
      if (typeof body?.api_key !== 'string' || body.api_key.length < 16 || body.api_key.length > 512 || /\s/.test(body.api_key)) return { status: 400, body: { error: 'PAIRING_KEY_REQUIRED' } };
      const me = await this.request('/api/v1/me', 'GET', undefined, body.api_key);
      if (me.status !== 200) return { status: me.status, body: { error: 'PAIRING_KEY_INVALID' } };
      await this.options.setKey(body.api_key);
      await this.options.authorize(binding);
      return { status: 200, body: { api_key: '__host_session__' } };
    }
    if (route === '/api/v1/auth/api-key' && method === 'GET') return { status: (await this.options.getKey()) ? 200 : 401, body: { api_key: '__host_session__' } };
    if (route === '/api/v1/auth/logout' && method === 'POST') {
      await this.options.setKey(null);
      return { status: 200, body: { ok: true } };
    }
    const pairing = /^\/api\/v1\/auth\/(login|google|email\/(send-code|verify)|phone\/(send-code|verify))$/.test(route) && method === 'POST';
    if ((route === '/api/v1/me' && method === 'GET') || pairing) {
      const response = await this.request(route, method, body, pairing ? null : undefined);
      if (pairing && response.status >= 200 && response.status < 300 && !Array.isArray(response.body) && typeof response.body.api_key === 'string') {
        if (account !== this.options.currentAccount()) throw new Error('Review account changed.');
        await this.options.setKey(response.body.api_key);
        response.body.api_key = '__host_session__';
      }
      await this.options.authorize(binding);
      return response;
    }
    const space = this.options.database.getHostValue<ICommentSpace>('review-space:' + binding.workspaceId);
    const url = new URL(route, 'http://host.invalid');
    const match = /^\/api\/v1\/shares\/([A-Za-z0-9_-]+)\/comments(?:\/(changes|summary|[A-Za-z0-9_-]+)(?:\/(status|binding))?)?$/.exec(url.pathname);
    if (!space || !match || match[1] !== space.shareId || !['GET', 'POST', 'PUT', 'DELETE'].includes(method) || body?.author_role === 'agent') return { status: 403, body: { error: 'COMMENT_SCOPE_DENIED' } };
    const payload = body ? structuredClone(body) : undefined;
    if (payload && method === 'POST' && !payload.parent_id) {
      let anchor: unknown = payload.highlighter_data;
      if (typeof anchor === 'string') {
        try {
          anchor = JSON.parse(anchor);
        } catch {
          return { status: 400, body: { error: 'COMMENT_ANCHOR_INVALID' } };
        }
      }
      if (!anchor || typeof anchor !== 'object' || Array.isArray(anchor) || !binding.revision) return { status: 400, body: { error: 'COMMENT_REVISION_REQUIRED' } };
      payload.highlighter_data = JSON.stringify({ ...anchor, review_binding: { project: binding.workspaceId, conversation: binding.conversationId, revision: binding.revision } });
    }
    const response = await this.request(route, method, payload);
    await this.options.authorize(binding);
    return response;
  }

  private watch(workspaceId: string, space: ICommentSpace): void {
    if (this.watchers.has(workspaceId) || this.isClosed) return;
    const tick = async () => {
      try {
        if (this.isClosed || this.options.currentAccount() !== space.account) return;
        const batch = this.requireSuccess(await this.request(`/api/v1/agent-consumers/${space.consumer}/poll`, 'POST', { wait_seconds: 0, limit: 50 }));
        const events = Array.isArray(batch.events) ? (batch.events as IReviewInboxItem['event'][]) : [];
        if (events.some((event) => event.share_id !== space.shareId || typeof event.id !== 'string' || typeof event.comment_id !== 'string')) throw new Error('Review event scope mismatch.');
        const subscriptions = this.options.database.reviewSubscriptions(workspaceId, space.shareId).filter((value) => value.account === space.account);
        const accepted = events.filter((event) => ['owner', 'visitor'].includes(event.actor_role) && /^comment\.(created|replied|updated)$/.test(event.event_type));
        this.options.database.acceptReviewEvents(accepted.flatMap((event) => subscriptions.map((subscription) => ({ id: digest(`${event.id}:${subscription.id}`), event, subscription, messageId: 'review-' + digest(`${event.id}:${subscription.id}`).slice(0, 40) }))));
        // The durable host inbox is committed before the provider cursor moves.
        if (batch.lease_token) this.requireSuccess(await this.request(`/api/v1/agent-consumers/${space.consumer}/ack`, 'POST', { lease_token: batch.lease_token }));
        await this.drain(space.account);
        this.errors.delete(workspaceId);
      } catch {
        this.errors.set(workspaceId, 'COMMENT_DELIVERY_UNAVAILABLE');
      } finally {
        this.watchers.delete(workspaceId);
        if (!this.isClosed && this.options.currentAccount() === space.account)
          this.watchers.set(
            workspaceId,
            setTimeout(() => {
              void tick();
            }, 2000)
          );
      }
    };
    this.watchers.set(
      workspaceId,
      setTimeout(() => {
        void tick();
      }, 0)
    );
  }

  private async drain(account: string): Promise<void> {
    for (const item of this.options.database.reviewInbox(account)) {
      if (this.active.has(item.id)) continue;
      this.active.add(item.id);
      try {
        await this.options.authorize(item.subscription);
        const result = this.options.database.getHostValue<{ text: string; error?: string }>('review-result:' + item.id);
        if (result) {
          await this.respond(item, result.text, result.error);
          this.active.delete(item.id);
          continue;
        }
        if (await this.options.messageExists(item.subscription.conversationId, item.messageId)) {
          this.options.database.finishReviewEvent(item.id, 'error', 'TURN_RECOVERY_REQUIRED');
          this.active.delete(item.id);
          continue;
        }
        const thread = await this.thread(item.subscription, item.event.parent_id || item.event.comment_id);
        const rawAnchor = thread.anchor_binding?.highlighter_data || thread.highlighter_data;
        const anchor = typeof rawAnchor === 'string' ? JSON.parse(rawAnchor) : rawAnchor;
        const target = (anchor as { review_binding?: { project?: string; conversation?: string } } | null)?.review_binding;
        if (target?.conversation && (target.conversation !== item.subscription.conversationId || target.project !== item.subscription.workspaceId)) {
          this.options.database.finishReviewEvent(item.id, 'ignored');
          this.active.delete(item.id);
          continue;
        }
        if (!target?.conversation && this.options.database.reviewSubscriptions(item.subscription.workspaceId, item.subscription.shareId).length > 1) {
          this.options.database.finishReviewEvent(item.id, 'error', 'COMMENT_ROUTING_REQUIRED');
          this.active.delete(item.id);
          continue;
        }
        const humanInput = { thread_id: thread.id, quote: thread.anchor_binding?.quote || thread.quote, anchor, content: thread.content, replies: (thread.replies || []).filter((reply) => reply.author_role !== 'agent') };
        if (!this.options.database.claimReviewInput(item.id, digest(JSON.stringify(humanInput)))) {
          this.active.delete(item.id);
          continue;
        }
        const head = await this.options.head(item.subscription.workspaceId);
        const content = JSON.stringify({
          source: 'shareone-review',
          event_id: item.event.id,
          project: item.subscription.workspaceId,
          thread_id: thread.id,
          current_revision: head.revision,
          quote: thread.anchor_binding?.quote || thread.quote,
          anchor,
          message: thread.content,
          replies: thread.replies || [],
        });
        const latest = thread.replies?.find((reply) => reply.id === item.event.comment_id)?.content || thread.content;
        const accepted = await this.options.deliver(
          { conversationId: item.subscription.conversationId, messageId: item.messageId, content: [thread.anchor_binding?.quote || thread.quote, latest].filter(Boolean).join('\n\n'), agentContent: content },
          {
            onStarted: async () => {
              await this.options.authorize(item.subscription);
              this.options.database.finishReviewEvent(item.id, 'running');
            },
            onCompleted: async (text, error) => {
              this.options.database.setHostValue('review-result:' + item.id, { text, error });
              try {
                await this.respond(item, text, error);
              } catch {
                this.options.database.finishReviewEvent(item.id, 'error', 'REPLY_PENDING');
              } finally {
                this.active.delete(item.id);
              }
            },
          }
        );
        if (!accepted.success) throw new Error('The bound conversation could not accept this review input.');
      } catch {
        this.options.database.finishReviewEvent(item.id, 'error', 'DELIVERY_PENDING');
        this.active.delete(item.id);
      }
    }
  }

  private async thread(subscription: IReviewSubscription, id: string): Promise<ICommentThread> {
    await this.options.authorize(subscription);
    const response = await this.request(`/api/v1/shares/${subscription.shareId}/comments?status=all`);
    if (response.status !== 200 || !Array.isArray(response.body)) throw new Error('Review thread unavailable.');
    const thread = (response.body as ICommentThread[]).find((value) => value.id === id);
    if (!thread) throw new Error('Review thread unavailable.');
    return thread;
  }

  private async respond(item: IReviewInboxItem, text: string, error?: string): Promise<void> {
    await this.options.authorize(item.subscription);
    const head = await this.options.head(item.subscription.workspaceId);
    const message = error ? 'The agent could not complete this review input. Please retry from the bound conversation.' : (text.trim() || 'The bound agent finished processing this comment.') + `\n\nModel revision: ${head.revision}. Please review the graph and continue in this thread.`;
    this.requireSuccess(
      await this.request(
        `/api/v1/shares/${item.subscription.shareId}/comments`,
        'POST',
        {
          parent_id: item.event.parent_id || item.event.comment_id,
          content: message.slice(0, 10000),
          author_role: 'agent',
          state: 'open-need-input',
        },
        undefined,
        'sudograph-reply-' + item.id
      )
    );
    this.options.database.finishReviewEvent(item.id, 'delivered');
  }

  status(workspaceId: string, conversationId: string) {
    return { ...this.options.database.reviewDeliverySummary(this.options.currentAccount(), workspaceId, conversationId), ...(this.errors.has(workspaceId) ? { error: this.errors.get(workspaceId) } : {}) };
  }

  close(): void {
    this.isClosed = true;
    for (const timer of this.watchers.values()) clearTimeout(timer);
    this.watchers.clear();
    for (const request of this.requests) request.abort();
    this.requests.clear();
  }
}
