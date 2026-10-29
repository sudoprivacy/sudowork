import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ exec: vi.fn(), end: vi.fn(), callback: undefined as undefined | ((error: Error | null, stdout: string) => void) }));
vi.mock('node:child_process', () => ({ execFile: fixture.exec }));

describe('retiring the installed scode service', () => {
  beforeEach(() => {
    fixture.end.mockReset();
    fixture.callback = undefined;
    fixture.exec.mockReset().mockImplementation((_executable, _args, _options, callback) => {
      fixture.callback = callback;
      const stdin = new EventEmitter();
      Object.assign(stdin, { end: fixture.end });
      return { stdin };
    });
  });

  it('submits one engine shutdown request and waits for the adapter to exit', async () => {
    const { retireScodeService } = await import('../../src/process/services/scode/retireScodeService');
    const finished = vi.fn();
    const request = retireScodeService('/owned/scode').then(finished);
    expect(fixture.end).toHaveBeenCalledExactlyOnceWith('{"id":1,"method":"service.shutdown","params":{}}\n');
    await Promise.resolve();
    expect(finished).not.toHaveBeenCalled();
    fixture.callback!(null, '{"id":1,"result":true}\n');
    await request;
    expect(finished).toHaveBeenCalledOnce();
    expect(fixture.exec).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['active agents', '{"id":1,"error":{"code":-32000,"message":"Agent runtimes are using this service"}}'],
    ['shared Box ownership', '{"id":1,"error":{"code":-32000,"message":"An existing shared Box requires its coordinated Node owner stop"}}'],
    ['an unrelated response', '{"id":2,"result":true}'],
    ['a negative acknowledgement', '{"id":1,"result":false}'],
    ['malformed output', 'not JSON'],
  ])('refuses replacement after %s', async (_name, response) => {
    const { retireScodeService } = await import('../../src/process/services/scode/retireScodeService');
    const request = retireScodeService('/owned/scode');
    const rejected = expect(request).rejects.toThrow('could not be retired');
    fixture.callback!(null, response);
    await rejected;
    expect(fixture.exec).toHaveBeenCalledTimes(1);
  });

  it('preserves a failed adapter outcome without resending shutdown', async () => {
    const { retireScodeService } = await import('../../src/process/services/scode/retireScodeService');
    const request = retireScodeService('/owned/scode');
    const rejected = expect(request).rejects.toThrow('Unable to retire');
    fixture.callback!(new Error('ETIMEDOUT'), '');
    await rejected;
    expect(fixture.exec).toHaveBeenCalledTimes(1);
  });
});
