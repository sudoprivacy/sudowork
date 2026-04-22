/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

// ============================================================================
// Extracted lock patterns — mirrors ActionExecutor.handleChatMessage logic
// ============================================================================

/**
 * OLD (buggy) lock pattern: reads previousLock, awaits it, THEN sets new lock.
 * This has a TOCTOU race: two callers can read the same previousLock,
 * both await it, and both proceed concurrently after it resolves.
 */
async function acquireLockOld(
  locks: Map<string, Promise<void>>,
  conversationId: string,
  work: () => Promise<void>,
): Promise<void> {
  const previousLock = locks.get(conversationId);
  if (previousLock) {
    await previousLock;
  }

  let releaseLock!: () => void;
  const lockPromise = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  locks.set(conversationId, lockPromise);

  try {
    await work();
  } finally {
    releaseLock();
    if (locks.get(conversationId) === lockPromise) {
      locks.delete(conversationId);
    }
  }
}

/**
 * NEW (fixed) lock pattern: reads previousLock FIRST (sync), then creates and registers
 * new lock (sync), then awaits previousLock. No await between read and set, so no other
 * caller can read the stale previousLock.
 */
async function acquireLockNew(
  locks: Map<string, Promise<void>>,
  conversationId: string,
  work: () => Promise<void>,
): Promise<void> {
  // Step 1: Read previous lock (sync — no yield before step 2)
  const previousLock = locks.get(conversationId);

  // Step 2: Create and register new lock (sync — atomically before any await)
  let releaseLock!: () => void;
  const lockPromise = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  locks.set(conversationId, lockPromise);

  // Step 3: Await previous lock (yields — but our lock is already in the map)
  if (previousLock) {
    await previousLock;
  }

  try {
    await work();
  } finally {
    releaseLock();
    if (locks.get(conversationId) === lockPromise) {
      locks.delete(conversationId);
    }
  }
}

// ============================================================================
// Helpers
// ============================================================================

/** Returns a promise that resolves after `ms` milliseconds */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Tests
// ============================================================================

describe('Conversation lock TOCTOU race condition', () => {
  // -------------------------------------------------------------------------
  // OLD (buggy) pattern — proves the bug exists
  // -------------------------------------------------------------------------
  describe('OLD lock pattern (buggy)', () => {
    it('should detect concurrent execution with 3 rapid messages for the same conversation', async () => {
      const locks = new Map<string, Promise<void>>();
      let concurrentCount = 0;
      let maxConcurrent = 0;

      const handlers = [1, 2, 3].map((msgId) =>
        acquireLockOld(locks, 'conv-1', async () => {
          concurrentCount++;
          maxConcurrent = Math.max(maxConcurrent, concurrentCount);
          await delay(50);
          concurrentCount--;
        }),
      );

      await Promise.all(handlers);

      // The bug: at least 2 messages ran concurrently
      expect(maxConcurrent).toBeGreaterThan(1);
    });

    it('should allow a later message to overwrite an earlier message\'s lock', async () => {
      const locks = new Map<string, Promise<void>>();
      const lockSequence: string[] = [];

      const handlers = [1, 2, 3].map((msgId) =>
        acquireLockOld(locks, 'conv-1', async () => {
          lockSequence.push(`msg-${msgId}-entered`);
          await delay(50);
          lockSequence.push(`msg-${msgId}-exited`);
        }),
      );

      await Promise.all(handlers);

      // Race: msg-3 overwrites msg-2's lock and both run concurrently.
      // msg-3 enters before msg-2 exits — proving the lock was overwritten.
      const msg2EnterIdx = lockSequence.indexOf('msg-2-entered');
      const msg2ExitIdx = lockSequence.indexOf('msg-2-exited');
      const msg3EnterIdx = lockSequence.indexOf('msg-3-entered');

      // msg-3 must enter while msg-2 is still running (before msg-2 exits)
      expect(msg3EnterIdx).toBeGreaterThan(msg2EnterIdx);
      expect(msg3EnterIdx).toBeLessThan(msg2ExitIdx);
    });
  });

  // -------------------------------------------------------------------------
  // NEW (fixed) pattern — proves the fix works
  // -------------------------------------------------------------------------
  describe('NEW lock pattern (fixed)', () => {
    it('should enforce sequential execution with 3 rapid messages for the same conversation', async () => {
      const locks = new Map<string, Promise<void>>();
      let concurrentCount = 0;
      let maxConcurrent = 0;

      const handlers = [1, 2, 3].map((msgId) =>
        acquireLockNew(locks, 'conv-1', async () => {
          concurrentCount++;
          maxConcurrent = Math.max(maxConcurrent, concurrentCount);
          await delay(30);
          concurrentCount--;
        }),
      );

      await Promise.all(handlers);

      expect(maxConcurrent).toBe(1);
    });

    it('should deliver exactly one response per message with no duplicates', async () => {
      const locks = new Map<string, Promise<void>>();
      const responses: number[] = [];

      const handlers = [1, 2, 3].map((msgId) =>
        acquireLockNew(locks, 'conv-1', async () => {
          await delay(20);
          responses.push(msgId);
        }),
      );

      await Promise.all(handlers);

      // Exactly 3 responses, no duplicates
      expect(responses).toHaveLength(3);
      expect(new Set(responses).size).toBe(3);
    });

    it('should preserve message order — responses match send order', async () => {
      const locks = new Map<string, Promise<void>>();
      const responses: number[] = [];

      // Vary work duration to prove order is maintained regardless of processing time
      const durations = [10, 5, 15]; // message 2 is fastest, message 3 is slowest

      const handlers = [1, 2, 3].map((msgId, idx) =>
        acquireLockNew(locks, 'conv-1', async () => {
          await delay(durations[idx]);
          responses.push(msgId);
        }),
      );

      await Promise.all(handlers);

      // Order must be [1, 2, 3] regardless of processing time
      expect(responses).toEqual([1, 2, 3]);
    });

    it('should clean up locks after all messages complete', async () => {
      const locks = new Map<string, Promise<void>>();

      const handlers = [1, 2, 3].map((msgId) =>
        acquireLockNew(locks, 'conv-1', async () => {
          await delay(10);
        }),
      );

      await Promise.all(handlers);

      expect(locks.size).toBe(0);
    });

    it('should allow different conversations to process concurrently', async () => {
      const locks = new Map<string, Promise<void>>();
      let concurrentCount = 0;
      let maxConcurrent = 0;

      // 2 messages for conv-A, 2 for conv-B, all launched simultaneously
      const handlers = [
        acquireLockNew(locks, 'conv-A', async () => {
          concurrentCount++;
          maxConcurrent = Math.max(maxConcurrent, concurrentCount);
          await delay(50);
          concurrentCount--;
        }),
        acquireLockNew(locks, 'conv-B', async () => {
          concurrentCount++;
          maxConcurrent = Math.max(maxConcurrent, concurrentCount);
          await delay(50);
          concurrentCount--;
        }),
        acquireLockNew(locks, 'conv-A', async () => {
          concurrentCount++;
          maxConcurrent = Math.max(maxConcurrent, concurrentCount);
          await delay(50);
          concurrentCount--;
        }),
        acquireLockNew(locks, 'conv-B', async () => {
          concurrentCount++;
          maxConcurrent = Math.max(maxConcurrent, concurrentCount);
          await delay(50);
          concurrentCount--;
        }),
      ];

      await Promise.all(handlers);

      // Different conversations should overlap (max 2: one from A, one from B)
      expect(maxConcurrent).toBeGreaterThanOrEqual(2);
    });

    it('should not block subsequent messages when one message errors', async () => {
      const locks = new Map<string, Promise<void>>();
      const results: string[] = [];

      const handlers = [
        acquireLockNew(locks, 'conv-1', async () => {
          results.push('msg-1-start');
          await delay(10);
          throw new Error('simulated error');
        }),
        acquireLockNew(locks, 'conv-1', async () => {
          results.push('msg-2');
          await delay(10);
        }),
        acquireLockNew(locks, 'conv-1', async () => {
          results.push('msg-3');
          await delay(10);
        }),
      ];

      // All should resolve (errors are caught internally by the lock pattern)
      await Promise.allSettled(handlers);

      // msg-2 and msg-3 should still have executed
      expect(results).toContain('msg-2');
      expect(results).toContain('msg-3');
    });

    it('should acquire and release lock correctly for a single message', async () => {
      const locks = new Map<string, Promise<void>>();
      let workExecuted = false;

      await acquireLockNew(locks, 'conv-1', async () => {
        // While working, lock should exist in map
        expect(locks.has('conv-1')).toBe(true);
        workExecuted = true;
      });

      expect(workExecuted).toBe(true);
      expect(locks.has('conv-1')).toBe(false);
    });
  });
});
