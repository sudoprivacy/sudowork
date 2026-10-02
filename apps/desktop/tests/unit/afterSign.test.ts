import { createRequire } from 'node:module';
import type * as childProcessTypes from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { notarize } = vi.hoisted(() => ({ notarize: vi.fn() }));
vi.mock('@electron/notarize', () => ({ notarize }));

const childProcess = createRequire(import.meta.url)('child_process') as typeof childProcessTypes;
const context = {
  electronPlatformName: 'darwin',
  appOutDir: '/tmp/test-build',
  packager: { appInfo: { productFilename: 'Sudowork', id: 'com.sudowork.app' } },
};

describe('macOS notarization deadline', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    notarize.mockReset();
    vi.spyOn(childProcess, 'execSync').mockReturnValue(Buffer.from(''));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('appleId', 'test@example.com');
    vi.stubEnv('appleIdPassword', 'test-password');
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('lets the build exit immediately after successful notarization', async () => {
    notarize.mockResolvedValue(undefined);
    const { default: afterSign } = await import('../../scripts/afterSign.js');

    await afterSign(context);

    expect(notarize).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('propagates a rejected agreement without leaving a deadline behind', async () => {
    const error = new Error('HTTP status code: 403. A required agreement is missing or has expired.');
    notarize.mockRejectedValue(error);
    const { default: afterSign } = await import('../../scripts/afterSign.js');

    await expect(afterSign(context)).rejects.toBe(error);

    expect(notarize).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears a failed attempt before waiting to retry a network error', async () => {
    notarize.mockRejectedValueOnce(new Error('NSURLErrorDomain')).mockResolvedValue(undefined);
    const { default: afterSign } = await import('../../scripts/afterSign.js');

    const result = afterSign(context);
    await vi.advanceTimersByTimeAsync(0);

    expect(notarize).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(30000);
    await result;

    expect(notarize).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('still times out stalled attempts and stops after the retry limit', async () => {
    notarize.mockImplementation(() => new Promise(() => {}));
    const { default: afterSign } = await import('../../scripts/afterSign.js');

    const result = afterSign(context);
    const rejection = expect(result).rejects.toThrow('Notarization timed out after 30 minutes');
    await vi.advanceTimersByTimeAsync(1800000 - 1);

    expect(notarize).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(1);

    await vi.runAllTimersAsync();
    await rejection;

    expect(notarize).toHaveBeenCalledTimes(5);
    expect(vi.getTimerCount()).toBe(0);
  });
});
