import { describe, expect, it, vi } from 'vitest';
import { MossHttpError, isMossRuntimeUpdateRequired, upgradeMossRuntime } from '@sudowork/moss-client';

describe('controlled runtime update client', () => {
  it('accepts only the public non-retryable startup code', () => {
    const body = JSON.stringify({ startup: { code: 'RUNTIME_UPDATE_REQUIRED', isRetryable: false } });
    expect(isMossRuntimeUpdateRequired(new MossHttpError(503, body, '/resume'))).toBe(true);
    for (const error of [new Error(body), new MossHttpError(403, body, '/resume'), new MossHttpError(503, '{', '/resume'), new MossHttpError(503, body.replace('false', 'true'), '/resume')]) {
      expect(isMossRuntimeUpdateRequired(error)).toBe(false);
    }
  });

  it('makes one authenticated owner update and verifies the returned identity', async () => {
    const fetch = vi.fn().mockResolvedValue({ runtime: { ownerId: 'owner/a' } });
    const ctx = { baseUrl: 'https://owned.test', accessToken: 'user-token' };
    await upgradeMossRuntime(fetch, ctx, 'owner/a');
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      ctx.baseUrl,
      {
        method: 'POST',
        path: '/api/v1/agent-runtimes/owner%2Fa/upgrade',
        accessToken: ctx.accessToken,
        body: {},
      },
      180_000
    );
    fetch.mockResolvedValueOnce({ runtime: { ownerId: 'other' } });
    await expect(upgradeMossRuntime(fetch, ctx, 'owner/a')).rejects.toThrow('different owner');
  });
});
