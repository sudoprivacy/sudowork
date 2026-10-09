/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import type { IncomingMessage } from 'http';

describe('sudoclawHealth', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts the live payload only when ok=true and status=live', async () => {
    const { isSudoclawHealthPayload } = await import('@/process/services/sudoclaw/sudoclawHealth');
    expect(isSudoclawHealthPayload({ ok: true, status: 'live' })).toBe(true);
    expect(isSudoclawHealthPayload({ ok: true, status: 'ready' })).toBe(false);
    expect(isSudoclawHealthPayload({ ok: false, status: 'live' })).toBe(false);
    expect(isSudoclawHealthPayload({ status: 'live' })).toBe(false);
  });

  it('validates both http status and json payload', async () => {
    // Helper to create a mock http.IncomingMessage
    function createMockResponse(statusCode: number, body: string) {
      const res = new EventEmitter() as EventEmitter & Partial<IncomingMessage>;
      res.statusCode = statusCode;
      res.setEncoding = vi.fn().mockReturnThis();
      return res;
    }

    const responses = [
      { statusCode: 200, body: JSON.stringify({ ok: true, status: 'live' }) },
      { statusCode: 200, body: JSON.stringify({ ok: true, status: 'ready' }) },
      { statusCode: 500, body: JSON.stringify({ ok: true, status: 'live' }) },
    ];

    let callIndex = 0;
    vi.doMock('node:http', () => ({
      get: vi.fn((_opts: unknown, cb: (res: EventEmitter) => void) => {
        const { statusCode, body } = responses[callIndex++];
        const res = createMockResponse(statusCode, body);
        // Simulate async response
        process.nextTick(() => {
          cb(res);
          process.nextTick(() => {
            res.emit('data', body);
            res.emit('end');
          });
        });
        const req = new EventEmitter();
        return req;
      }),
    }));

    const { checkSudoclawHealth } = await import('@/process/services/sudoclaw/sudoclawHealth');

    await expect(checkSudoclawHealth('127.0.0.1', 17863)).resolves.toBe(true);
    await expect(checkSudoclawHealth('127.0.0.1', 17863)).resolves.toBe(false);
    await expect(checkSudoclawHealth('127.0.0.1', 17863)).resolves.toBe(false);
  });
});
