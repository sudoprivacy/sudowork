import { request as httpRequest } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SudographReviewHost, type ISudographReviewLaunch } from '@process/services/ontology/SudographReviewHost';
import { SudographCompilerError } from '@process/services/ontology/SudographModelClient';

const hosts: SudographReviewHost[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
});

function fixture() {
  let now = Date.now();
  let isAllowed = true;
  const authorize = vi.fn(({ workspaceId, conversationId }) => {
    if (!isAllowed || workspaceId !== 'source' || conversationId !== 'chat-1') throw new Error('Private ownership diagnostic');
  });
  const read = vi.fn(async (_workspaceId: string, request: Record<string, unknown>): Promise<unknown> => {
    if (request.operation === 'html') return `<html>${request.endpoint}</html>`;
    if (request.operation === 'export') throw new SudographCompilerError('ACCESS_DENIED', 'Private export diagnostic', 'Private credential');
    return { revision: 'r1', context_digest: 'd1' };
  });
  const host = new SudographReviewHost({ authorize, read, now: () => now });
  hosts.push(host);
  return { host, authorize, read, revoke: () => (isAllowed = false), expire: () => (now += 31 * 60_000) };
}

function cookie(launch: ISudographReviewLaunch): string {
  return `${launch.cookie.name}=${launch.cookie.value}`;
}

function post(launch: ISudographReviewLaunch, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${launch.url}v1`, { method: 'POST', headers: { Cookie: cookie(launch), 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
}

describe('Sudograph authenticated host review boundary', () => {
  it('keeps the launch identity out of the URL and requires its path-scoped cookie', async () => {
    const { host, read } = fixture();
    const launch = await host.createSession({ workspaceId: 'source', conversationId: 'chat-1' });
    expect(launch.cookie).toMatchObject({ url: launch.url, path: new URL(launch.url).pathname, httpOnly: true, sameSite: 'Strict' });
    expect(launch.url).not.toContain(launch.cookie.value);
    expect(new URL(launch.url).search).toBe('');
    expect(JSON.parse(JSON.stringify(launch))).toEqual({ url: launch.url });
    expect(structuredClone(launch)).toEqual({ url: launch.url });
    expect(Object.isFrozen(launch.cookie)).toBe(true);
    expect((await fetch(launch.url)).status).toBe(403);
    const page = await fetch(launch.url, { headers: { Cookie: cookie(launch) } });
    expect(page.status).toBe(200);
    expect(page.headers.get('cache-control')).toBe('no-store');
    expect(await page.text()).toBe(`<html>${new URL(launch.url).pathname}v1</html>`);
    expect(read).toHaveBeenCalledWith('source', { operation: 'html', endpoint: `${new URL(launch.url).pathname}v1` });
    const head = await post(launch, { view: 'source', operation: 'head' });
    expect(await head.json()).toEqual({ result: { revision: 'r1', context_digest: 'd1' } });
    expect((await fetch(launch.url, { headers: { Cookie: `${cookie(launch)}; ${cookie(launch)}` } })).status).toBe(403);
  });

  it('refuses cross-project, cross-origin and browser-selected authority before reading', async () => {
    const { host, read } = fixture();
    await expect(host.createSession({ workspaceId: 'other', conversationId: 'chat-1' })).rejects.toThrow('ownership');
    await expect(host.createSession({ workspaceId: 'source', conversationId: 'other-chat' })).rejects.toThrow('ownership');
    const launch = await host.createSession({ workspaceId: 'source', conversationId: 'chat-1' });
    for (const headers of [{ Origin: 'https://untrusted.example' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
      expect((await post(launch, { view: 'source', operation: 'head' }, headers)).status).toBe(403);
    }
    // Fetch overrides Host. Send the actual wire header for this ingress check.
    const foreignHost = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(launch.url, { headers: { Cookie: cookie(launch), Host: 'untrusted.example' } }, (response) => {
        response.resume();
        response.on('end', () => resolve(response.statusCode));
      });
      request.on('error', reject);
      request.end();
    });
    expect(foreignHost).toBe(403);
    for (const body of [
      { view: 'other', operation: 'head' },
      { view: 'source', operation: 'html', endpoint: 'https://untrusted.example' },
      { view: 'source', operation: 'head', actor: 'other' },
      { view: 'source', operation: 'apply', params: {} },
      { view: 'source', operation: 'head', store: '/private.db' },
    ])
      expect((await post(launch, body)).status).toBe(400);
    expect(read).not.toHaveBeenCalled();
  });

  it('rechecks ownership for every read and denies expired or revoked sessions', async () => {
    const f = fixture();
    const launch = await f.host.createSession({ workspaceId: 'source', conversationId: 'chat-1' });
    expect((await post(launch, { view: 'source', operation: 'head' })).status).toBe(200);
    f.revoke();
    const denied = await fetch(launch.url, { headers: { Cookie: cookie(launch) } });
    expect(denied.status).toBe(403);
    expect(await denied.text()).not.toContain('Private');
    expect(f.read).toHaveBeenCalledTimes(1);
    const other = fixture();
    const expiring = await other.host.createSession({ workspaceId: 'source', conversationId: 'chat-1' });
    other.expire();
    expect((await fetch(expiring.url, { headers: { Cookie: cookie(expiring) } })).status).toBe(403);
    expect(other.read).not.toHaveBeenCalled();
    const revocable = fixture();
    const revoked = await revocable.host.createSession({ workspaceId: 'source', conversationId: 'chat-1' });
    revoked.revoke();
    expect((await fetch(revoked.url, { headers: { Cookie: cookie(revoked) } })).status).toBe(403);
  });

  it('does not release a compiler result after revocation during a read', async () => {
    const f = fixture();
    const launch = await f.host.createSession({ workspaceId: 'source', conversationId: 'chat-1' });
    f.read.mockImplementationOnce(async () => {
      launch.revoke();
      return 'private record';
    });
    const response = await fetch(launch.url, { headers: { Cookie: cookie(launch) } });
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain('private record');
  });

  it('does not release data when the session closes during the final asynchronous authorization', async () => {
    const f = fixture();
    const launch = await f.host.createSession({ workspaceId: 'source', conversationId: 'chat-1' });
    // Initial ingress, pre-read, then the final authorization barrier.
    f.authorize.mockImplementationOnce(() => undefined);
    f.authorize.mockImplementationOnce(() => undefined);
    f.authorize.mockImplementationOnce(async () => {
      await Promise.resolve();
      launch.revoke();
    });
    const response = await fetch(launch.url, { headers: { Cookie: cookie(launch) } });
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain('<html>');
  });

  it('preserves typed version conflicts, hides diagnostics and never grants export', async () => {
    const f = fixture();
    const launch = await f.host.createSession({ workspaceId: 'source', conversationId: 'chat-1' });
    const denied = await post(launch, { view: 'source', operation: 'export' });
    expect(denied.status).toBe(403);
    expect(await denied.text()).not.toContain('Private');
    f.read.mockRejectedValueOnce(new SudographCompilerError('CONTEXT_STALE', 'secret source path', 'secret credential'));
    const stale = await post(launch, { view: 'source', operation: 'page', params: {} });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: 'CONTEXT_STALE', recovery: 'Reload the registered model and retry this page.' });
    f.read.mockRejectedValueOnce(new Error('secret source path'));
    const unavailable = await fetch(launch.url, { headers: { Cookie: cookie(launch) } });
    expect(unavailable.status).toBe(503);
    expect(await unavailable.text()).not.toContain('secret');
  });

  it('bounds JSON input and closes all sessions without leaving a listener', async () => {
    const f = fixture();
    const launch = await f.host.createSession({ workspaceId: 'source', conversationId: 'chat-1' });
    expect((await post(launch, { view: 'source', operation: 'page', params: { text: 'x'.repeat(65537) } })).status).toBe(400);
    expect((await post(launch, { view: 'source', operation: 'head' }, { 'Content-Type': 'text/plain' })).status).toBe(400);
    expect((await fetch(`${launch.url}?actor=other`, { headers: { Cookie: cookie(launch) } })).status).toBe(403);
    expect(f.read).not.toHaveBeenCalled();
    await f.host.close();
    await expect(fetch(launch.url)).rejects.toThrow();
    await expect(f.host.createSession({ workspaceId: 'source', conversationId: 'chat-1' })).rejects.toThrow('closed');
  });
});
