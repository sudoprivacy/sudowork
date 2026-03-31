/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi, afterEach } from 'vitest';
import { checkSudoclawHealth, isSudoclawHealthPayload } from '@/process/services/sudoclaw/sudoclawHealth';

describe('sudoclawHealth', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts the live payload only when ok=true and status=live', () => {
    expect(isSudoclawHealthPayload({ ok: true, status: 'live' })).toBe(true);
    expect(isSudoclawHealthPayload({ ok: true, status: 'ready' })).toBe(false);
    expect(isSudoclawHealthPayload({ ok: false, status: 'live' })).toBe(false);
    expect(isSudoclawHealthPayload({ status: 'live' })).toBe(false);
  });

  it('validates both http status and json payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ ok: true, status: 'live' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ ok: true, status: 'ready' }),
        })
        .mockResolvedValueOnce({
          ok: false,
          json: async () => ({ ok: true, status: 'live' }),
        })
    );

    await expect(checkSudoclawHealth('127.0.0.1', 17863)).resolves.toBe(true);
    await expect(checkSudoclawHealth('127.0.0.1', 17863)).resolves.toBe(false);
    await expect(checkSudoclawHealth('127.0.0.1', 17863)).resolves.toBe(false);
  });
});
