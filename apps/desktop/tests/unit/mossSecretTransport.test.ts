import { afterEach, expect, it, vi } from 'vitest';
import { MossSecretClient } from '@sudowork/common/nexus/moss-secret-client';

afterEach(() => vi.restoreAllMocks());

it('uses the host transport for credential reads and keeps keys out of URLs', async () => {
  const fallback = vi.spyOn(globalThis, 'fetch');
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ success: true, data: { value: 'stored-key' } })));
  const client = new MossSecretClient('https://moss.example', 'login-token', 'user-a', fetcher);
  await expect(client.getSecret('user:user-a:shareone', 'X-API-Key')).resolves.toBe('stored-key');
  expect(fallback).not.toHaveBeenCalled();
  expect(fetcher.mock.calls[0][0]).toBe('https://moss.example/api/v1/me/secrets/user%3Auser-a%3Ashareone/X-API-Key');
  expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({ Authorization: 'Bearer login-token' });
});

it.each([401, 403, 502, 503])('does not accept a failed HTTP response as a missing credential (%i)', async (status) => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status }));
  const client = new MossSecretClient('https://moss.example', 'login-token', 'user-a', fetcher);
  await expect(client.getSecret('user:user-a:shareone', 'X-API-Key')).rejects.toThrow(String(status));
});

it('keeps confirmed absence distinct from transport failure', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response('{}', { status: 404 }))
    .mockRejectedValueOnce(new TypeError('fetch failed'));
  const client = new MossSecretClient('https://moss.example', 'login-token', 'user-a', fetcher);
  await expect(client.getSecret('user:user-a:shareone', 'X-API-Key')).resolves.toBeNull();
  await expect(client.getSecret('user:user-a:shareone', 'X-API-Key')).rejects.toThrow('fetch failed');
});
