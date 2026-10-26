import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SudographReviewComments } from '@process/services/ontology/SudographReviewComments';
import type { IReviewInboxItem, IReviewSubscription, OntologyStudioDatabase } from '@process/services/ontology/OntologyStudioDatabase';

const SHARE = 'reviewspace000001';
let service: SudographReviewComments;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  service?.close();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function fixture() {
  const values = new Map<string, unknown>();
  const subscriptions = new Map<string, IReviewSubscription>();
  const inbox = new Map<string, IReviewInboxItem>();
  const order: string[] = [];
  const inputClaims = new Map<string, string>();
  const threadReplies: Array<{ id: string; content: string; author_role: string }> = [];
  const controls = { failAccept: false, failReply: false, account: 'account-one', key: 'private-existing-key', events: [{ id: 'event-one', share_id: SHARE, comment_id: 'thread-one', parent_id: null, actor_role: 'owner', event_type: 'comment.created' }] as IReviewInboxItem['event'][] };
  const database = {
    getHostValue: (key: string) => values.get(key) ?? null,
    setHostValue: (key: string, value: unknown) => values.set(key, value),
    subscribeReview: (value: IReviewSubscription) => subscriptions.set(value.id, value),
    reviewSubscriptions: () => [...subscriptions.values()],
    acceptReviewEvents: (items: Array<{ id: string; subscription: IReviewSubscription; event: IReviewInboxItem['event']; messageId: string }>) => {
      if (controls.failAccept) throw new Error('Durable commit failed');
      for (const item of items) if (!inbox.has(item.id)) inbox.set(item.id, { ...item, status: 'pending' });
      order.push('durable');
    },
    reviewInbox: () => [...inbox.values()].filter((item) => ['pending', 'running', 'error'].includes(item.status)),
    claimReviewInput: (id: string, digest: string) => {
      const other = inputClaims.get(digest);
      if (other && other !== id) {
        inbox.get(id)!.status = 'ignored';
        return false;
      }
      inputClaims.set(digest, id);
      return true;
    },
    finishReviewEvent: (id: string, status: string) => {
      inbox.get(id)!.status = status;
    },
    reviewDeliverySummary: () => ({}),
  };
  const settings = { viewer_scope: 'owner_and_collaborators', allow_comments: true, is_public: false };
  const requests: Array<{ route: string; method: string; body: Record<string, unknown> | undefined; key: string | null }> = [];
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, options) => {
    const url = new URL(String(input));
    const route = url.pathname + url.search;
    const method = options?.method || 'GET';
    const body = options?.body ? JSON.parse(String(options.body)) : undefined;
    requests.push({ route, method, body, key: new Headers(options?.headers).get('X-API-Key') });
    let result: unknown = {};
    let status = 200;
    if (route === '/api/v1/me') result = { id: 'share-owner', username: 'owner' };
    else if (route === '/api/v1/pages' || route === '/api/v1/pages/' + SHARE) result = { share_id: SHARE, settings };
    else if (route.endsWith('/comments/changes')) result = { threads: [], cursor: 'cursor' };
    else if (route.endsWith('/poll')) result = { events: controls.events, lease_token: 'lease-token' };
    else if (route.endsWith('/ack')) {
      order.push('ack');
      result = { cursor: 1 };
    } else if (route.endsWith('/comments?status=all')) result = [{ id: 'thread-one', quote: 'Field label', content: 'Please clarify this field.', highlighter_data: { anchor_type: 'app_declared', ids: ['source/field'] }, replies: threadReplies }];
    else if (route.endsWith('/comments') && method === 'POST' && body?.author_role === 'agent') {
      result = { id: 'reply-one' };
      if (controls.failReply) status = 503;
    }
    return new Response(JSON.stringify(result), { status, headers: { 'Content-Type': 'application/json' } });
  });
  const deliver = vi.fn(async (_input, hooks) => {
    await hooks.onStarted();
    await hooks.onCompleted('The definition has been updated.');
    return { success: true };
  });
  const setKey = vi.fn(async (key: string) => {
    controls.key = key;
  });
  service = new SudographReviewComments({
    database: database as unknown as OntologyStudioDatabase,
    baseUrl: 'https://provider.test',
    currentAccount: () => controls.account,
    getKey: async () => controls.key,
    setKey,
    authorize: async () => {},
    head: async () => ({ revision: 'model-revision', context_digest: 'context-digest' }),
    deliver,
    messageExists: () => false,
  });
  return { controls, values, inbox, requests, order, deliver, fetcher, setKey, threadReplies };
}

it('defaults to private comments and never uploads graph content or records', async () => {
  const state = fixture();
  await service.prepare('project', 'conversation');
  const request = state.requests.find((item) => item.route === '/api/v1/pages')!;
  expect(request.body).toMatchObject({ viewer_scope: 'owner_and_collaborators', is_public: false, allow_comments: true, allow_data: false });
  expect(String(request.body?.html_content)).not.toContain('BUNDLE');
  expect(state.requests.filter((item) => item.route.includes('/agent-consumers/'))).toHaveLength(1);
});

it('commits events before ACK, retries an uncommitted batch, and ignores duplicate/agent events', async () => {
  const state = fixture();
  state.controls.failAccept = true;
  await service.prepare('project', 'conversation');
  await vi.advanceTimersByTimeAsync(0);
  expect(state.order).not.toContain('ack');
  expect(state.deliver).not.toHaveBeenCalled();
  state.controls.failAccept = false;
  await vi.advanceTimersByTimeAsync(2000);
  expect(state.order.indexOf('durable')).toBeLessThan(state.order.indexOf('ack'));
  expect(state.deliver).toHaveBeenCalledTimes(1);
  expect([...state.inbox.values()][0].status).toBe('delivered');
  await vi.advanceTimersByTimeAsync(2000);
  expect(state.deliver).toHaveBeenCalledTimes(1);
  state.controls.events = [{ ...state.controls.events[0], id: 'agent-reply', actor_role: 'agent' }];
  await vi.advanceTimersByTimeAsync(2000);
  expect(state.deliver).toHaveBeenCalledTimes(1);
  state.controls.events = [{ ...state.controls.events[0], id: 'human-reply', comment_id: 'reply-two', parent_id: 'thread-one', actor_role: 'visitor', event_type: 'comment.replied' }];
  state.threadReplies.push({ id: 'reply-two', content: 'I have another correction.', author_role: 'visitor' });
  await vi.advanceTimersByTimeAsync(2000);
  expect(state.deliver).toHaveBeenCalledTimes(2);
  const reply = state.requests.find((item) => item.body?.author_role === 'agent');
  expect(reply?.body).toMatchObject({ parent_id: 'thread-one', state: 'open-need-input' });
});

it('retries a failed provider reply without starting the model turn again', async () => {
  const state = fixture();
  state.controls.failReply = true;
  await service.prepare('project', 'conversation');
  await vi.advanceTimersByTimeAsync(0);
  expect(state.deliver).toHaveBeenCalledTimes(1);
  expect([...state.inbox.values()][0].status).toBe('error');
  state.controls.failReply = false;
  await vi.advanceTimersByTimeAsync(2000);
  expect(state.deliver).toHaveBeenCalledTimes(1);
  expect([...state.inbox.values()][0].status).toBe('delivered');
});

it('enforces the share, actor and observed revision at the browser write boundary', async () => {
  const state = fixture();
  await service.prepare('project', 'conversation');
  const binding = { workspaceId: 'project', conversationId: 'conversation', revision: 'served-revision' };
  expect((await service.proxy(binding, '/api/v1/shares/other/comments', 'GET')).status).toBe(403);
  expect((await service.proxy(binding, `/api/v1/shares/${SHARE}/comments`, 'POST', { author_role: 'agent' })).status).toBe(403);
  await service.proxy(binding, `/api/v1/shares/${SHARE}/comments`, 'POST', { content: 'A human comment', quote: 'A field', highlighter_data: JSON.stringify({ review_binding: { project: 'other', revision: 'forged' } }) });
  expect(JSON.parse(String(state.requests.at(-1)?.body?.highlighter_data))).toMatchObject({ review_binding: { project: 'project', revision: 'served-revision' } });
  const result = await service.proxy(binding, '/api/v1/auth/pair-key', 'POST', { api_key: 'authorized-private-key' });
  expect(state.setKey).toHaveBeenCalledWith('authorized-private-key');
  expect(JSON.stringify(result)).not.toContain('authorized-private-key');
});

it('does not release the previous account response after an account switch', async () => {
  const state = fixture();
  state.fetcher.mockImplementationOnce(async () => {
    state.controls.account = 'different-account';
    return new Response(JSON.stringify({ id: 'private-old-user' }), { status: 200 });
  });
  await expect(service.proxy({ workspaceId: 'project', conversationId: 'conversation' }, '/api/v1/me', 'GET')).rejects.toThrow('account changed');
});
