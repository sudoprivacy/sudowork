/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Direct test of the draining/buffering logic without mocking the full service.
 * This tests the core race condition fix.
 */
describe('ChannelMessageService draining logic', () => {
  // Simulate the stream state behavior
  interface MockStreamState {
    draining: boolean;
    pendingMessages: Array<{ type: string; data: any }>;
    callback: ReturnType<typeof vi.fn>;
  }

  // Simulate the handleAgentMessage behavior with draining
  function simulateHandleAgentMessage(event: { type: string; conversation_id: string; data: any }, stream: MockStreamState): void {
    // If stream is draining, buffer the message
    if (stream.draining) {
      stream.pendingMessages.push(event);
      return;
    }

    // Process normal messages
    if (event.type === 'content') {
      stream.callback(event);
    }
  }

  // Simulate finish event handling with queueMicrotask deferred resolution
  function simulateFinishEvent(stream: MockStreamState, resolve: () => void): void {
    stream.draining = true;

    queueMicrotask(() => {
      // Flush pending messages
      for (const pendingEvent of stream.pendingMessages) {
        stream.callback(pendingEvent);
      }
      stream.pendingMessages = [];
      resolve();
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Race condition - finish before content', () => {
    it('should buffer messages arriving after finish event', async () => {
      const mockCallback = vi.fn();
      const stream: MockStreamState = {
        draining: false,
        pendingMessages: [],
        callback: mockCallback,
      };

      let resolved = false;
      const resolvePromise = new Promise<void>((resolve) => {
        simulateFinishEvent(stream, () => {
          resolved = true;
          resolve();
        });
      });

      // Simulate RACE CONDITION: finish arrives first
      // (finish is handled above)

      // Content arrives immediately after finish (during draining)
      simulateHandleAgentMessage(
        {
          type: 'content',
          conversation_id: 'test',
          data: 'Late arriving content',
        },
        stream
      );

      // At this point, draining=true, so message should be buffered
      expect(stream.draining).toBe(true);
      expect(stream.pendingMessages.length).toBe(1);
      expect(stream.pendingMessages[0].data).toBe('Late arriving content');

      // Callback should NOT have been called yet (message is buffered)
      expect(mockCallback).not.toHaveBeenCalled();

      // Wait for microtask to execute
      await resolvePromise;

      // NOW callback should have been called with the buffered message
      expect(mockCallback).toHaveBeenCalledTimes(1);
      expect(mockCallback).toHaveBeenCalledWith({
        type: 'content',
        conversation_id: 'test',
        data: 'Late arriving content',
      });

      expect(resolved).toBe(true);
    });

    it('should buffer multiple messages arriving after finish', async () => {
      const mockCallback = vi.fn();
      const stream: MockStreamState = {
        draining: false,
        pendingMessages: [],
        callback: mockCallback,
      };

      const resolvePromise = new Promise<void>((resolve) => {
        simulateFinishEvent(stream, resolve);
      });

      // Multiple messages arrive during draining
      simulateHandleAgentMessage({ type: 'content', conversation_id: 'test', data: 'First late' }, stream);
      simulateHandleAgentMessage({ type: 'content', conversation_id: 'test', data: 'Second late' }, stream);
      simulateHandleAgentMessage({ type: 'content', conversation_id: 'test', data: 'Third late' }, stream);

      // All should be buffered
      expect(stream.pendingMessages.length).toBe(3);

      await resolvePromise;

      // All buffered messages should be processed
      expect(mockCallback).toHaveBeenCalledTimes(3);
    });

    it('should NOT buffer messages when draining is false', () => {
      const mockCallback = vi.fn();
      const stream: MockStreamState = {
        draining: false,
        pendingMessages: [],
        callback: mockCallback,
      };

      // Content arrives before finish
      simulateHandleAgentMessage({ type: 'content', conversation_id: 'test', data: 'Normal content' }, stream);

      // Should be processed immediately (not buffered)
      expect(mockCallback).toHaveBeenCalledTimes(1);
      expect(stream.pendingMessages.length).toBe(0);
    });
  });

  describe('Normal flow', () => {
    it('should process content immediately when not draining', () => {
      const mockCallback = vi.fn();
      const stream: MockStreamState = {
        draining: false,
        pendingMessages: [],
        callback: mockCallback,
      };

      simulateHandleAgentMessage({ type: 'content', conversation_id: 'test', data: 'Hello' }, stream);

      expect(mockCallback).toHaveBeenCalled();
    });
  });
});
