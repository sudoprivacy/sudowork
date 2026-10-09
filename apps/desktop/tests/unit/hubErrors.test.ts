/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { parseHubError, tokenMissingResponse, fetchFailedResponse, type HubError } from '@common/nexus/hubErrors';

describe('parseHubError', () => {
  it('maps {errorCode: TOKEN_MISSING} → non-retriable HubError', () => {
    const got = parseHubError({ success: false, errorCode: 'TOKEN_MISSING', msg: 'skillhub token missing' });
    expect(got).toEqual<HubError>({ code: 'TOKEN_MISSING', message: 'skillhub token missing', retriable: false });
  });

  it('maps {errorCode: FETCH_FAILED} → retriable HubError with message preserved', () => {
    const got = parseHubError({ success: false, errorCode: 'FETCH_FAILED', msg: 'ETIMEDOUT' });
    expect(got).toEqual<HubError>({ code: 'FETCH_FAILED', message: 'ETIMEDOUT', retriable: true });
  });

  it('falls through to FETCH_FAILED for unknown errorCode (forward-compat)', () => {
    // A future bridge variant adds a new errorCode but renderer hasn't
    // shipped the matching branch yet — we degrade to retriable
    // generic failure rather than silently dropping the error.
    const got = parseHubError({ success: false, errorCode: 'SOMETHING_NEW', msg: 'whatever' });
    expect(got.code).toBe('FETCH_FAILED');
    expect(got.retriable).toBe(true);
  });

  it('falls through to FETCH_FAILED when errorCode is absent (legacy bridge)', () => {
    // Pre-PR bridges only returned { success: false, msg: '...' }.
    // We continue to handle that gracefully so a mixed-version
    // build (older bridge, newer renderer) doesn't break.
    const got = parseHubError({ success: false, msg: 'legacy error' });
    expect(got.code).toBe('FETCH_FAILED');
    expect(got.message).toBe('legacy error');
    expect(got.retriable).toBe(true);
  });

  it('handles missing msg', () => {
    const got = parseHubError({ success: false, errorCode: 'TOKEN_MISSING' });
    expect(got).toEqual<HubError>({ code: 'TOKEN_MISSING', message: '', retriable: false });
  });
});

describe('tokenMissingResponse', () => {
  it('returns standard token-missing shape with method tag', () => {
    const got = tokenMissingResponse('assistantHub');
    expect(got).toEqual({ success: false, errorCode: 'TOKEN_MISSING', msg: 'skillhub token missing (assistantHub)' });
  });
});

describe('fetchFailedResponse', () => {
  it('wraps Error instances', () => {
    const got = fetchFailedResponse(new Error('ECONNREFUSED'));
    expect(got).toEqual({ success: false, errorCode: 'FETCH_FAILED', msg: 'ECONNREFUSED' });
  });

  it('coerces non-Error inputs to String()', () => {
    const got = fetchFailedResponse({ foo: 'bar' });
    expect(got.errorCode).toBe('FETCH_FAILED');
    expect(got.msg).toBe('[object Object]');
  });
});
