import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ISudographReviewStore, IReviewInboxItem, IReviewSubscription } from '@sudowork/sudograph-runtime';
import { SudographReviewComments } from '@process/services/ontology/SudographReviewComments';

const SHARE = 'reviewspace000001';
let service: SudographReviewComments;
const services = new Set<SudographReviewComments>();

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const current of services) current.close();
  services.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function fixture(isAsyncStore = false) {
  const values = new Map<string, unknown>();
  const subscriptions = new Map<string, IReviewSubscription>();
  const inbox = new Map<string, IReviewInboxItem>();
  const order: string[] = [];
  const inputClaims = new Map<string, string>();
  const deliveryClaims = new Set<string>();
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
    claimReviewDelivery: (id: string) => {
      if (deliveryClaims.has(id)) return false;
      deliveryClaims.add(id);
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
  const store = isAsyncStore
    ? Object.fromEntries(
        Object.entries(database).map(([name, method]) => [
          name,
          async (...args: unknown[]) => {
            await Promise.resolve();
            return Reflect.apply(method, database, args);
          },
        ])
      )
    : database;
  const head = vi.fn(async () => ({ revision: 'model-revision', context_digest: 'context-digest' }));
  const authorize = vi.fn(async () => {});
  const recover = vi.fn<NonNullable<ConstructorParameters<typeof SudographReviewComments>[0]['recover']>>(async () => ({ state: 'unknown' }));
  const createService = () => {
    const current = new SudographReviewComments({
      database: store as unknown as ISudographReviewStore,
      baseUrl: 'https://provider.test',
      currentAccount: () => controls.account,
      getKey: async () => controls.key,
      setKey,
      authorize,
      head,
      recover,
      deliver,
      messageExists: () => false,
    });
    services.add(current);
    return current;
  };
  service = createService();
  return { controls, values, inbox, requests, order, deliver, fetcher, setKey, threadReplies, createService, head, recover, authorize, deliveryClaims };
}

it('refuses a host store that cannot durably reserve dispatch', () => {
  expect(() => new SudographReviewComments({ database: {} } as unknown as ConstructorParameters<typeof SudographReviewComments>[0])).toThrow('atomic durable claimReviewDelivery is required');
});

it('admits one turn when independent controllers poll the same event concurrently', async () => {
  const state = fixture(true);
  state.deliver.mockImplementation(async (_input, hooks) => {
    await hooks.onStarted();
    return { success: true };
  });
  state.recover.mockResolvedValue({ state: 'pending' });
  const other = state.createService();
  await Promise.all([service.prepare('project', 'conversation'), other.prepare('project', 'conversation')]);
  await vi.advanceTimersByTimeAsync(0);
  expect(state.deliver).toHaveBeenCalledTimes(1);
  expect([...state.inbox.values()][0].status).toBe('running');
});

it('rechecks current authorization after the asynchronous dispatch reservation', async () => {
  const state = fixture(true);
  state.authorize.mockImplementation(async () => {
    if (state.deliveryClaims.size) throw new Error('Authorization was revoked while reserving dispatch.');
  });
  await service.prepare('project', 'conversation');
  await vi.advanceTimersByTimeAsync(0);
  expect(state.deliveryClaims.size).toBe(1);
  expect(state.deliver).not.toHaveBeenCalled();
  expect([...state.inbox.values()][0].status).toBe('error');
});

it('reserves dispatch across controllers and recovers the existing turn without submitting twice', async () => {
  const state = fixture(true);
  state.deliver.mockImplementation(async (_input, hooks) => {
    await hooks.onStarted();
    return { success: true };
  });
  state.recover.mockResolvedValue({ state: 'pending' });
  await service.prepare('project', 'conversation');
  await vi.advanceTimersByTimeAsync(0);
  expect(state.deliver).toHaveBeenCalledTimes(1);
  const original = service;
  const replacement = state.createService();
  await replacement.prepare('project', 'conversation');
  await vi.advanceTimersByTimeAsync(0);
  expect(state.deliver).toHaveBeenCalledTimes(1);
  expect(state.recover).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'project', conversationId: 'conversation' }));
  expect([...state.inbox.values()][0].status).toBe('running');
  original.close();
  state.recover.mockResolvedValue({ state: 'complete', text: 'Recovered from the existing conversation.' });
  await vi.advanceTimersByTimeAsync(2000);
  expect(state.deliver).toHaveBeenCalledTimes(1);
  expect([...state.inbox.values()][0].status).toBe('delivered');
  expect(state.head).toHaveBeenCalledWith('project', 'conversation');
  expect(state.requests.find((request) => request.body?.author_role === 'agent')?.body?.content).toContain('Recovered from the existing conversation.');
});

it('does not replay an uncertain dispatch even when the host cannot find its message yet', async () => {
  const state = fixture(true);
  state.deliver.mockRejectedValueOnce(new Error('The connection closed before its outcome was known.'));
  await service.prepare('project', 'conversation');
  await vi.advanceTimersByTimeAsync(0);
  expect(state.deliver).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(2000);
  expect(state.deliver).toHaveBeenCalledTimes(1);
  expect(state.recover).toHaveBeenCalledTimes(1);
  expect([...state.inbox.values()][0].status).toBe('error');
  state.recover.mockResolvedValue({ state: 'complete', text: 'The existing input completed.' });
  await vi.advanceTimersByTimeAsync(2000);
  expect(state.deliver).toHaveBeenCalledTimes(1);
  expect([...state.inbox.values()][0].status).toBe('delivered');
});

it('defaults to private comments and never uploads graph content or records', async () => {
  const state = fixture();
  await service.prepare('project', 'conversation');
  const request = state.requests.find((item) => item.route === '/api/v1/pages')!;
  expect(request.body).toMatchObject({ viewer_scope: 'owner_and_collaborators', is_public: false, allow_comments: true, allow_data: false });
  expect(String(request.body?.html_content)).not.toContain('BUNDLE');
  expect(state.requests.filter((item) => item.route.includes('/agent-consumers/'))).toHaveLength(1);
});

it('does not send an anonymous upstream request when the current account has no key', async () => {
  const state = fixture();
  state.controls.key = '';
  await expect(service.prepare('project', 'conversation')).resolves.toBeNull();
  expect(await service.proxy({ workspaceId: 'project', conversationId: 'conversation' }, '/api/v1/me', 'GET')).toEqual({ status: 401, body: { error_code: 'INVALID_API_KEY' } });
  expect(state.requests).toHaveLength(0);
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

it('awaits remote durable storage before ACK and retains duplicate-input and reply recovery behavior', async () => {
  const state = fixture(true);
  state.controls.failAccept = true;
  await service.prepare('project', 'conversation');
  await vi.advanceTimersByTimeAsync(0);
  expect(state.order).not.toContain('ack');
  expect(state.deliver).not.toHaveBeenCalled();
  state.controls.failAccept = false;
  state.controls.failReply = true;
  await vi.advanceTimersByTimeAsync(2000);
  expect(state.order.indexOf('durable')).toBeLessThan(state.order.indexOf('ack'));
  expect(state.deliver).toHaveBeenCalledTimes(1);
  state.controls.failReply = false;
  await vi.advanceTimersByTimeAsync(2000);
  expect(state.deliver).toHaveBeenCalledTimes(1);
  expect([...state.inbox.values()][0].status).toBe('delivered');
  state.controls.events = [{ ...state.controls.events[0], id: 'same-human-input-new-event', event_type: 'comment.updated' }];
  await vi.advanceTimersByTimeAsync(2000);
  expect(state.deliver).toHaveBeenCalledTimes(1);
  expect(await service.status('project', 'conversation')).toEqual({});
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
