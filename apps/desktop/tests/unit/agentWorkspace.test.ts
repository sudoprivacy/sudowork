import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareWebAgentWorkspace, resetWebAgentWorkspace } from '@sudowork/host-bridge/agentWorkspace';

describe('shared Agent workspace organization handoff', () => {
  beforeEach(() => {
    resetWebAgentWorkspace();
    vi.stubGlobal('window', { location: { hash: '#/conversation/session-1?org_id=org-2' }, history: { state: null } });
  });
  afterEach(() => {
    resetWebAgentWorkspace();
    vi.unstubAllGlobals();
  });

  it('deduplicates concurrent private-data startup and verifies once per workspace', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{"ok":true}'));
    vi.stubGlobal('fetch', fetch);
    await Promise.all([prepareWebAgentWorkspace(), prepareWebAgentWorkspace()]);
    await prepareWebAgentWorkspace();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/auth/agent-workspace');
    expect(JSON.parse(fetch.mock.calls[0]?.[1].body)).toEqual({ sessionId: 'session-1', orgId: 'org-2' });
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ credentials: 'include', method: 'POST' });
  });

  it('retries the preserved handoff after a fresh login', async () => {
    vi.stubGlobal('window', { location: { hash: '#/login' }, history: { state: { usr: { returnTo: '/conversation/session-1?org_id=org-2' } } } });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValue(new Response('{"ok":true}'));
    vi.stubGlobal('fetch', fetch);
    await prepareWebAgentWorkspace();
    resetWebAgentWorkspace();
    await prepareWebAgentWorkspace();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not cache a denied workspace or load it as another organization', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 403 }));
    vi.stubGlobal('fetch', fetch);
    await expect(prepareWebAgentWorkspace()).rejects.toThrow('rejected');
    await expect(prepareWebAgentWorkspace()).rejects.toThrow('rejected');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each(['#/guid', '#/conversation/session-1', '#/conversation/session-1?org_id=org-2&token=secret'])('ignores unrelated and unsafe targets: %s', async (hash) => {
    vi.stubGlobal('window', { location: { hash }, history: { state: { usr: { returnTo: '/conversation/session-1?org_id=org-2' } } } });
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await prepareWebAgentWorkspace();
    expect(fetch).not.toHaveBeenCalled();
  });
});
