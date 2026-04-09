/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

describe('SudoclawNetworkResilience', () => {
  beforeEach(() => {
    vi.resetModules();

    vi.doMock('@process/utils/mainLogger', () => ({
      mainLog: vi.fn(),
      mainWarn: vi.fn(),
      mainError: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('classifyError', () => {
    it('classifies network transient errors as retryable', async () => {
      const { classifyError } = await import('@/process/services/sudoclaw/SudoclawNetworkResilience');

      expect(classifyError(new Error('ECONNREFUSED'))).toMatchObject({ category: 'network_transient', retryable: true });
      expect(classifyError(new Error('ETIMEDOUT'))).toMatchObject({ category: 'network_transient', retryable: true });
      expect(classifyError(new Error('socket hang up'))).toMatchObject({ category: 'network_transient', retryable: true });
      expect(classifyError(new Error('fetch failed'))).toMatchObject({ category: 'network_transient', retryable: true });
    });

    it('classifies rate limit errors with retry hint', async () => {
      const { classifyError } = await import('@/process/services/sudoclaw/SudoclawNetworkResilience');

      const result = classifyError(new Error('429 Too Many Requests'));
      expect(result.category).toBe('rate_limited');
      expect(result.retryable).toBe(true);
      expect(result.retryAfterMs).toBeDefined();
    });

    it('classifies auth errors as non-retryable', async () => {
      const { classifyError } = await import('@/process/services/sudoclaw/SudoclawNetworkResilience');

      expect(classifyError(new Error('401 Unauthorized'))).toMatchObject({ category: 'auth_error', retryable: false });
      expect(classifyError(new Error('403 Forbidden'))).toMatchObject({ category: 'auth_error', retryable: false });
      expect(classifyError(new Error('Invalid API key'))).toMatchObject({ category: 'auth_error', retryable: false });
    });

    it('classifies model errors as retryable', async () => {
      const { classifyError } = await import('@/process/services/sudoclaw/SudoclawNetworkResilience');

      expect(classifyError(new Error('Model overloaded'))).toMatchObject({ category: 'model_error', retryable: true });
      expect(classifyError(new Error('503 Service Unavailable'))).toMatchObject({ category: 'model_error', retryable: true });
    });

    it('classifies unknown errors as retryable', async () => {
      const { classifyError } = await import('@/process/services/sudoclaw/SudoclawNetworkResilience');

      expect(classifyError(new Error('Some weird error'))).toMatchObject({ category: 'unknown', retryable: true });
    });
  });

  describe('SudoclawNetworkResilience', () => {
    it('starts in connected state', async () => {
      const { SudoclawNetworkResilience } = await import('@/process/services/sudoclaw/SudoclawNetworkResilience');
      const resilience = new SudoclawNetworkResilience();

      expect(resilience.getState()).toBe('connected');
      expect(resilience.getFailureCount()).toBe(0);

      resilience.destroy();
    });

    it('transitions to degraded on retryable failure', async () => {
      const { SudoclawNetworkResilience } = await import('@/process/services/sudoclaw/SudoclawNetworkResilience');
      const resilience = new SudoclawNetworkResilience();

      const events: { type: string; state: string }[] = [];
      resilience.onEvent((evt) => events.push(evt));

      resilience.configure(
        async () => false,
        async () => {},
      );

      resilience.reportFailure(new Error('ECONNREFUSED'));

      expect(resilience.getState()).toBe('degraded');
      expect(resilience.getFailureCount()).toBe(1);
      expect(events.some((e) => e.type === 'state_change')).toBe(true);

      resilience.destroy();
    });

    it('transitions to disconnected on non-retryable failure', async () => {
      const { SudoclawNetworkResilience } = await import('@/process/services/sudoclaw/SudoclawNetworkResilience');
      const resilience = new SudoclawNetworkResilience();

      resilience.reportFailure(new Error('401 Unauthorized'));

      expect(resilience.getState()).toBe('disconnected');

      resilience.destroy();
    });

    it('restores connected state on reportSuccess', async () => {
      const { SudoclawNetworkResilience } = await import('@/process/services/sudoclaw/SudoclawNetworkResilience');
      const resilience = new SudoclawNetworkResilience();

      resilience.reportFailure(new Error('ECONNREFUSED'));
      expect(resilience.getState()).toBe('degraded');

      resilience.reportSuccess();
      expect(resilience.getState()).toBe('connected');
      expect(resilience.getFailureCount()).toBe(0);

      resilience.destroy();
    });

    it('tracks consecutive failure count', async () => {
      const { SudoclawNetworkResilience } = await import('@/process/services/sudoclaw/SudoclawNetworkResilience');
      const resilience = new SudoclawNetworkResilience();

      resilience.configure(
        async () => false,
        async () => { throw new Error('fail'); },
      );

      resilience.reportFailure(new Error('ECONNREFUSED'));
      resilience.reportFailure(new Error('ECONNREFUSED'));
      resilience.reportFailure(new Error('ECONNREFUSED'));

      expect(resilience.getFailureCount()).toBe(3);

      resilience.destroy();
    });

    it('emits retry_succeeded when connection restored', async () => {
      const { SudoclawNetworkResilience } = await import('@/process/services/sudoclaw/SudoclawNetworkResilience');
      const resilience = new SudoclawNetworkResilience();

      const events: { type: string }[] = [];
      resilience.onEvent((evt) => events.push(evt));

      resilience.reportFailure(new Error('ECONNREFUSED'));
      resilience.reportSuccess();

      expect(events.some((e) => e.type === 'retry_succeeded')).toBe(true);

      resilience.destroy();
    });

    it('destroy cleans up state', async () => {
      const { SudoclawNetworkResilience } = await import('@/process/services/sudoclaw/SudoclawNetworkResilience');
      const resilience = new SudoclawNetworkResilience();

      resilience.reportFailure(new Error('ECONNREFUSED'));
      resilience.destroy();

      expect(resilience.getState()).toBe('connected');
      expect(resilience.getFailureCount()).toBe(0);
    });
  });
});
