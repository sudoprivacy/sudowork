import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SudographReviewHost, type ISudographReviewBinding, type ISudographReviewGrant, type ISudographReviewGrantStore, type ShareoneReviewAssets } from '@sudowork/sudograph-runtime';

const hosts: SudographReviewHost[] = [];
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  await Promise.all(
    servers.splice(0).map((server) => {
      server.closeAllConnections();
      return new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    })
  );
});

async function fixture(withComments = false) {
  const grants = new Map<string, ISudographReviewGrant>();
  const store: ISudographReviewGrantStore = {
    create: vi.fn(async (id: string, grant: ISudographReviewGrant) => {
      grants.set(id, structuredClone(grant));
    }),
    get: vi.fn(async (id: string) => {
      const value = grants.get(id);
      return value ? structuredClone(value) : undefined;
    }),
    update: vi.fn(async (id: string, expected: ISudographReviewGrant, changes: Pick<ISudographReviewGrant, 'shareId' | 'revision'>) => {
      const current = grants.get(id);
      if (!current || current.credentialHash !== expected.credentialHash || current.conversationId !== expected.conversationId) return false;
      Object.assign(current, changes);
      return true;
    }),
    delete: vi.fn(async (id: string) => {
      grants.delete(id);
    }),
  };
  let current: SudographReviewHost;
  const server = createServer((req, res) => {
    void current.handleRequest(req, res).then((handled) => {
      if (!handled) res.writeHead(404).end();
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture listener');
  const origin = `http://127.0.0.1:${address.port}`;
  let isAllowed = true;
  let authorizationRef = 'epoch-1';
  const authorize = vi.fn(async (binding: ISudographReviewBinding) => {
    if (!isAllowed || binding.authorizationRef !== authorizationRef) throw new Error('Private membership diagnostic');
    return authorizationRef;
  });
  const read = vi.fn(async (_workspace: string, request: Record<string, unknown>, binding: ISudographReviewBinding): Promise<unknown> =>
    request.operation === 'document' ? { html: '<html>Canonical document</html>', revision: 'revision-a' } : { revision: 'revision-a', conversation: binding.conversationId }
  );
  const prepare = vi.fn(async () => ({ shareId: 'private-share' }));
  const proxy = vi.fn(async (binding: ISudographReviewBinding & { revision?: string }) => ({ status: 200, body: { revision: binding.revision } }));
  const make = () => {
    const host = new SudographReviewHost({ authorize, read, embedded: { origin, grants: store }, ...(withComments ? { comments: { assets: {} as ShareoneReviewAssets, prepare, proxy, status: async () => ({ delivered: 1 }) } } : {}) });
    hosts.push(host);
    return host;
  };
  current = make();
  return {
    store,
    grants,
    make,
    read,
    authorize,
    prepare,
    proxy,
    get host() {
      return current;
    },
    use: (host: SudographReviewHost) => {
      current = host;
    },
    deny: () => {
      isAllowed = false;
    },
    advance: () => {
      authorizationRef = 'epoch-2';
    },
  };
}

describe('embedded shared Sudograph review transport', () => {
  it('uses the existing HTTP listener and survives host replacement with the same durable grant', async () => {
    const f = await fixture();
    const first = f.host;
    const launch = await first.createSession({ workspaceId: 'project', conversationId: 'conversation', authorizationRef: 'epoch-1' });
    const options = { method: 'POST', headers: { Cookie: `${launch.cookie.name}=${launch.cookie.value}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ view: 'project', operation: 'head' }) };
    expect((await fetch(launch.url + 'v1', options)).status).toBe(200);
    f.use(f.make());
    await first.close();
    expect(await (await fetch(launch.url + 'v1', options)).json()).toEqual({ result: { revision: 'revision-a', conversation: 'conversation' } });
    expect(f.read).toHaveBeenLastCalledWith('project', { operation: 'head' }, expect.objectContaining({ conversationId: 'conversation' }));
    expect(JSON.stringify([...f.grants.values()])).not.toContain(launch.cookie.value);
    expect((await fetch(new URL('/unrelated', launch.url))).status).toBe(404);
    await launch.revoke();
    expect((await fetch(launch.url + 'v1', options)).status).toBe(403);
  });

  it('retains comment connection and rendered revision across independent hosts', async () => {
    const f = await fixture(true);
    const launch = await f.host.createSession({ workspaceId: 'project', conversationId: 'conversation', authorizationRef: 'epoch-1' });
    const headers = { Cookie: `${launch.cookie.name}=${launch.cookie.value}` };
    expect(await (await fetch(launch.url + 'connection', { headers })).json()).toEqual({ state: 'ready', share_id: 'private-share' });
    expect(await (await fetch(launch.url + 'content', { headers })).text()).toBe('<html>Canonical document</html>');
    f.use(f.make());
    expect(await (await fetch(launch.url + 'connection', { headers })).json()).toEqual({ state: 'ready', share_id: 'private-share' });
    expect(f.prepare).toHaveBeenCalledTimes(1);
    expect(await (await fetch(launch.url + 'api/v1/threads', { headers })).json()).toEqual({ revision: 'revision-a' });
    expect(await (await fetch(launch.url + 'delivery', { headers })).json()).toEqual({ delivered: 1 });
  });

  it('discards results revoked by another controller while a read is in flight', async () => {
    const f = await fixture();
    const launch = await f.host.createSession({ workspaceId: 'project', conversationId: 'conversation', authorizationRef: 'epoch-1' });
    f.read.mockImplementationOnce(async () => {
      await launch.revoke();
      return 'private record';
    });
    const response = await fetch(launch.url, { headers: { Cookie: `${launch.cookie.name}=${launch.cookie.value}` } });
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain('private record');
  });

  it('fails closed on shared-store outages and rechecks current authorization after recovery', async () => {
    const f = await fixture();
    const launch = await f.host.createSession({ workspaceId: 'project', conversationId: 'conversation', authorizationRef: 'epoch-1' });
    const headers = { Cookie: `${launch.cookie.name}=${launch.cookie.value}` };
    vi.mocked(f.store.get).mockRejectedValueOnce(new Error('Private database diagnostic'));
    const unavailable = await fetch(launch.url, { headers });
    expect(unavailable.status).toBe(503);
    expect(await unavailable.text()).not.toContain('Private');
    f.deny();
    expect((await fetch(launch.url, { headers })).status).toBe(403);
    expect(f.read).not.toHaveBeenCalled();
  });

  it('requires explicit safe origins and keeps HTTPS launch credentials private and secure', async () => {
    const f = await fixture();
    for (const origin of ['http://review.example', 'https://review.example/path', 'https://user@review.example', 'https://review.example?token=x']) {
      expect(() => new SudographReviewHost({ authorize: f.authorize, read: f.read, embedded: { origin, grants: f.store } })).toThrow();
    }
    const host = new SudographReviewHost({ authorize: f.authorize, read: f.read, embedded: { origin: 'https://review.example', grants: f.store } });
    hosts.push(host);
    await expect(host.createSession({ workspaceId: 'project', conversationId: 'conversation' })).rejects.toThrow('durable authorization reference');
    const unchecked = new SudographReviewHost({ authorize: async () => {}, read: f.read, embedded: { origin: 'https://review.example', grants: f.store } });
    hosts.push(unchecked);
    await expect(unchecked.createSession({ workspaceId: 'project', conversationId: 'conversation', authorizationRef: 'epoch-1' })).rejects.toThrow('authorization reference does not match');
    const launch = await host.createSession({ workspaceId: 'project', conversationId: 'conversation', authorizationRef: 'epoch-1' });
    expect(launch.url).toMatch(/^https:\/\/review.example\/review\/[a-f0-9]{32}\/$/);
    expect(launch.cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict' });
    // The managed browser derives Secure from HTTPS and requires these exact fields.
    expect(Object.keys(launch.cookie).sort()).toEqual(['expires', 'httpOnly', 'name', 'path', 'sameSite', 'url', 'value']);
    expect(JSON.stringify(launch)).toBe(JSON.stringify({ url: launch.url }));
    expect(structuredClone(launch)).toEqual({ url: launch.url });
  });

  it('requires a new grant after the host ownership generation changes', async () => {
    const f = await fixture();
    const launch = await f.host.createSession({ workspaceId: 'project', conversationId: 'conversation', authorizationRef: 'epoch-1' });
    const headers = { Cookie: `${launch.cookie.name}=${launch.cookie.value}` };
    f.advance();
    f.use(f.make());
    expect((await fetch(launch.url, { headers })).status).toBe(403);
    expect(f.read).not.toHaveBeenCalled();
    const current = await f.host.createSession({ workspaceId: 'project', conversationId: 'conversation', authorizationRef: 'epoch-2' });
    expect((await fetch(current.url + 'v1', { method: 'POST', headers: { Cookie: `${current.cookie.name}=${current.cookie.value}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ view: 'project', operation: 'head' }) })).status).toBe(200);
  });
});
