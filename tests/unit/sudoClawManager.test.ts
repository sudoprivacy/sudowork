/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

// Mock mainLogger before importing SudoClawManager
vi.mock('@process/utils/mainLogger', () => ({
  mainLog: vi.fn(),
  mainWarn: vi.fn(),
  mainError: vi.fn(),
}));

// Create the mock event bus at module scope (will be hoisted with vi.mock)
const createMockEventBus = () => {
  const bus = new EventEmitter();
  bus.setMaxListeners(100);
  return bus;
};

// Use vi.hoisted to create the mock event bus before vi.mock hoisting
const { mockEventBus, emittedEvents } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { EventEmitter } = require('events');
  const bus = new EventEmitter();
  bus.setMaxListeners(100);

  const events: Array<{ event: string; data: unknown }> = [];
  const origEmit = bus.emit.bind(bus);
  bus.emit = (event: string, ...args: unknown[]) => {
    events.push({ event, data: args[0] });
    return origEmit(event, ...args);
  };

  return { mockEventBus: bus, emittedEvents: events };
});

vi.mock('@/channels/agent/ChannelEventBus', () => ({
  channelEventBus: {
    onApprovalPending: (handler: (...args: unknown[]) => void) => {
      mockEventBus.on('channel.approval.pending', handler);
      return () => mockEventBus.off('channel.approval.pending', handler);
    },
    onApprovalResolved: (handler: (...args: unknown[]) => void) => {
      mockEventBus.on('channel.approval.resolved', handler);
      return () => mockEventBus.off('channel.approval.resolved', handler);
    },
    emitApprovalPending: (event: unknown) => {
      mockEventBus.emit('channel.approval.pending', event);
    },
    emitApprovalResolved: (event: unknown) => {
      mockEventBus.emit('channel.approval.resolved', event);
    },
    emit: (event: string, data: unknown) => {
      mockEventBus.emit(event, data);
    },
  },
  ChannelEvents: {
    AGENT_MESSAGE: 'channel.agent.message',
    APPROVAL_PENDING: 'channel.approval.pending',
    APPROVAL_RESOLVED: 'channel.approval.resolved',
  },
}));

import { SudoClawManager, SUDOCLAW_NOTIFICATION_EVENT } from '@/process/services/sudoclaw/SudoClawManager';
import type { IApprovalPendingEvent, IApprovalResolvedEvent } from '@/channels/agent/ChannelEventBus';
import { channelEventBus } from '@/channels/agent/ChannelEventBus';

describe('SudoClawManager', () => {
  const CONV_ID = 'test-conversation-123';
  let manager: SudoClawManager;

  beforeEach(() => {
    vi.useFakeTimers();
    emittedEvents.length = 0;
    manager = new SudoClawManager({
      conversationId: CONV_ID,
      tickIntervalMs: 1000,
      approvalTimeoutMs: 5000,
    });
  });

  afterEach(() => {
    manager.dispose();
    vi.useRealTimers();
    vi.restoreAllMocks();
    mockEventBus.removeAllListeners();
  });

  describe('initialization', () => {
    it('starts in idle state', () => {
      const state = manager.getState();
      expect(state.sessionState).toBe('idle');
      expect(state.conversationId).toBe(CONV_ID);
      expect(state.pendingQuestion).toBeNull();
      expect(state.pendingRequestId).toBeNull();
      expect(state.pendingCallId).toBeNull();
    });

    it('returns an immutable state snapshot', () => {
      const state1 = manager.getState();
      const state2 = manager.getState();
      expect(state1).not.toBe(state2);
      expect(state1).toEqual(state2);
    });
  });

  describe('start / stop lifecycle', () => {
    it('transitions from idle to running on start', () => {
      manager.start();
      expect(manager.getState().sessionState).toBe('running');
    });

    it('transitions back to idle on stop', () => {
      manager.start();
      manager.stop();
      expect(manager.getState().sessionState).toBe('idle');
    });

    it('does not start if already running', () => {
      manager.start();
      manager.start(); // should warn, not crash
      expect(manager.getState().sessionState).toBe('running');
    });

    it('does not start after dispose', () => {
      manager.dispose();
      manager.start();
      expect(manager.getState().sessionState).toBe('idle');
    });
  });

  describe('tick loop', () => {
    it('calls onTick at the configured interval', async () => {
      const onTick = vi.fn();
      manager.dispose();
      manager = new SudoClawManager({
        conversationId: CONV_ID,
        tickIntervalMs: 1000,
        onTick,
      });

      manager.start();
      expect(onTick).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1000);
      expect(onTick).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1000);
      expect(onTick).toHaveBeenCalledTimes(2);
    });

    it('stops ticking after stop()', () => {
      const onTick = vi.fn();
      manager.dispose();
      manager = new SudoClawManager({
        conversationId: CONV_ID,
        tickIntervalMs: 1000,
        onTick,
      });

      manager.start();
      vi.advanceTimersByTime(1000);
      expect(onTick).toHaveBeenCalledTimes(1);

      manager.stop();
      vi.advanceTimersByTime(5000);
      expect(onTick).toHaveBeenCalledTimes(1);
    });

    it('transitions to error state on tick failure', async () => {
      const onTick = vi.fn().mockRejectedValue(new Error('tick failed'));
      manager.dispose();
      manager = new SudoClawManager({
        conversationId: CONV_ID,
        tickIntervalMs: 1000,
        onTick,
      });

      manager.start();
      await vi.advanceTimersByTimeAsync(1000);

      expect(manager.getState().sessionState).toBe('error');
    });
  });

  describe('approval-pending event handling', () => {
    it('transitions to requires_action on approval-pending for matching conversation', () => {
      manager.start();

      const pendingEvent: IApprovalPendingEvent = {
        conversationId: CONV_ID,
        requestId: 'req-1',
        callId: 'call-1',
        toolName: 'bash',
        description: 'rm -rf /',
      };

      channelEventBus.emitApprovalPending(pendingEvent);

      const state = manager.getState();
      expect(state.sessionState).toBe('requires_action');
      expect(state.pendingQuestion).toBe('Approve tool: bash?\nrm -rf /');
      expect(state.pendingRequestId).toBe('req-1');
      expect(state.pendingCallId).toBe('call-1');
    });

    it('ignores approval-pending for different conversation', () => {
      manager.start();

      const pendingEvent: IApprovalPendingEvent = {
        conversationId: 'other-conversation',
        requestId: 'req-1',
        callId: 'call-1',
        toolName: 'bash',
        description: 'rm -rf /',
      };

      channelEventBus.emitApprovalPending(pendingEvent);

      expect(manager.getState().sessionState).toBe('running');
    });

    it('ignores approval-pending when not in running state', () => {
      // Still in idle state
      const pendingEvent: IApprovalPendingEvent = {
        conversationId: CONV_ID,
        requestId: 'req-1',
        callId: 'call-1',
        toolName: 'bash',
        description: 'rm -rf /',
      };

      channelEventBus.emitApprovalPending(pendingEvent);

      expect(manager.getState().sessionState).toBe('idle');
    });

    it('pauses tick loop when approval is pending', () => {
      const onTick = vi.fn();
      manager.dispose();
      manager = new SudoClawManager({
        conversationId: CONV_ID,
        tickIntervalMs: 1000,
        onTick,
      });

      manager.start();
      vi.advanceTimersByTime(1000);
      expect(onTick).toHaveBeenCalledTimes(1);

      // Trigger approval pending
      channelEventBus.emitApprovalPending({
        conversationId: CONV_ID,
        requestId: 'req-1',
        callId: 'call-1',
        toolName: 'bash',
        description: 'test',
      });

      // Tick should not fire while in requires_action state
      vi.advanceTimersByTime(5000);
      expect(onTick).toHaveBeenCalledTimes(1);
    });

    it('emits sudoclaw-notification with action_needed urgency', () => {
      manager.start();
      emittedEvents.length = 0;

      channelEventBus.emitApprovalPending({
        conversationId: CONV_ID,
        requestId: 'req-1',
        callId: 'call-1',
        toolName: 'bash',
        description: 'dangerous command',
      });

      const notification = emittedEvents.find((e) => e.event === SUDOCLAW_NOTIFICATION_EVENT);
      expect(notification).toBeDefined();
      expect((notification?.data as Record<string, unknown>)?.urgency).toBe('action_needed');
      expect((notification?.data as Record<string, unknown>)?.sessionState).toBe('requires_action');
      expect((notification?.data as Record<string, unknown>)?.toolName).toBe('bash');
    });
  });

  describe('approval-resolved event handling', () => {
    it('transitions back to running on approval-resolved', () => {
      manager.start();

      // First, go to requires_action
      channelEventBus.emitApprovalPending({
        conversationId: CONV_ID,
        requestId: 'req-1',
        callId: 'call-1',
        toolName: 'bash',
        description: 'test',
      });
      expect(manager.getState().sessionState).toBe('requires_action');

      // Then resolve
      const resolvedEvent: IApprovalResolvedEvent = {
        conversationId: CONV_ID,
        requestId: 'req-1',
        callId: 'call-1',
        optionId: 'allow_once',
      };

      channelEventBus.emitApprovalResolved(resolvedEvent);

      const state = manager.getState();
      expect(state.sessionState).toBe('running');
      expect(state.pendingQuestion).toBeNull();
      expect(state.pendingRequestId).toBeNull();
      expect(state.pendingCallId).toBeNull();
    });

    it('resumes tick loop after approval resolved', () => {
      const onTick = vi.fn();
      manager.dispose();
      manager = new SudoClawManager({
        conversationId: CONV_ID,
        tickIntervalMs: 1000,
        onTick,
      });

      manager.start();
      vi.advanceTimersByTime(1000);
      expect(onTick).toHaveBeenCalledTimes(1);

      // Pause via approval pending
      channelEventBus.emitApprovalPending({
        conversationId: CONV_ID,
        requestId: 'req-1',
        callId: 'call-1',
        toolName: 'bash',
        description: 'test',
      });

      vi.advanceTimersByTime(3000);
      expect(onTick).toHaveBeenCalledTimes(1); // still paused

      // Resume via approval resolved
      channelEventBus.emitApprovalResolved({
        conversationId: CONV_ID,
        requestId: 'req-1',
        callId: 'call-1',
        optionId: 'allow_once',
      });

      vi.advanceTimersByTime(1000);
      expect(onTick).toHaveBeenCalledTimes(2); // ticking again
    });

    it('ignores approval-resolved for different conversation', () => {
      manager.start();

      channelEventBus.emitApprovalPending({
        conversationId: CONV_ID,
        requestId: 'req-1',
        callId: 'call-1',
        toolName: 'bash',
        description: 'test',
      });

      channelEventBus.emitApprovalResolved({
        conversationId: 'other-conversation',
        requestId: 'req-1',
        callId: 'call-1',
        optionId: 'allow_once',
      });

      // Should still be in requires_action
      expect(manager.getState().sessionState).toBe('requires_action');
    });

    it('emits notification with info urgency on resolved', () => {
      manager.start();

      channelEventBus.emitApprovalPending({
        conversationId: CONV_ID,
        requestId: 'req-1',
        callId: 'call-1',
        toolName: 'bash',
        description: 'test',
      });

      emittedEvents.length = 0;

      channelEventBus.emitApprovalResolved({
        conversationId: CONV_ID,
        requestId: 'req-1',
        callId: 'call-1',
        optionId: 'allow_once',
      });

      const notification = emittedEvents.find((e) => e.event === SUDOCLAW_NOTIFICATION_EVENT);
      expect(notification).toBeDefined();
      expect((notification?.data as Record<string, unknown>)?.urgency).toBe('info');
      expect((notification?.data as Record<string, unknown>)?.sessionState).toBe('running');
    });
  });

  describe('approval timeout (auto-deny)', () => {
    it('auto-transitions back to running after timeout', () => {
      manager.start();

      channelEventBus.emitApprovalPending({
        conversationId: CONV_ID,
        requestId: 'req-1',
        callId: 'call-1',
        toolName: 'bash',
        description: 'test',
      });

      expect(manager.getState().sessionState).toBe('requires_action');

      // Advance past the 5000ms timeout
      vi.advanceTimersByTime(5000);

      const state = manager.getState();
      expect(state.sessionState).toBe('running');
      expect(state.pendingQuestion).toBeNull();
      expect(state.pendingRequestId).toBeNull();
    });

    it('emits timeout notification with error urgency', () => {
      manager.start();

      channelEventBus.emitApprovalPending({
        conversationId: CONV_ID,
        requestId: 'req-1',
        callId: 'call-1',
        toolName: 'bash',
        description: 'test',
      });

      emittedEvents.length = 0;
      vi.advanceTimersByTime(5000);

      const notification = emittedEvents.find((e) => e.event === SUDOCLAW_NOTIFICATION_EVENT && (e.data as Record<string, unknown>)?.urgency === 'error');
      expect(notification).toBeDefined();
      expect((notification?.data as Record<string, unknown>)?.description).toContain('timed out');
    });

    it('does not auto-deny if resolved before timeout', () => {
      manager.start();

      channelEventBus.emitApprovalPending({
        conversationId: CONV_ID,
        requestId: 'req-1',
        callId: 'call-1',
        toolName: 'bash',
        description: 'test',
      });

      // Resolve before timeout
      vi.advanceTimersByTime(2000);
      channelEventBus.emitApprovalResolved({
        conversationId: CONV_ID,
        requestId: 'req-1',
        callId: 'call-1',
        optionId: 'allow_once',
      });

      expect(manager.getState().sessionState).toBe('running');

      // Advance past original timeout — should still be running
      vi.advanceTimersByTime(5000);
      expect(manager.getState().sessionState).toBe('running');
    });

    it('uses configurable timeout duration', () => {
      manager.dispose();
      manager = new SudoClawManager({
        conversationId: CONV_ID,
        tickIntervalMs: 1000,
        approvalTimeoutMs: 10_000,
      });

      manager.start();

      channelEventBus.emitApprovalPending({
        conversationId: CONV_ID,
        requestId: 'req-1',
        callId: 'call-1',
        toolName: 'bash',
        description: 'test',
      });

      // Should still be requires_action at 5s
      vi.advanceTimersByTime(5000);
      expect(manager.getState().sessionState).toBe('requires_action');

      // Should auto-deny at 10s
      vi.advanceTimersByTime(5000);
      expect(manager.getState().sessionState).toBe('running');
    });
  });

  describe('dispose', () => {
    it('cleans up all event listeners and timers', () => {
      manager.start();
      manager.dispose();

      expect(manager.getState().sessionState).toBe('idle');

      // Events should be ignored after dispose
      channelEventBus.emitApprovalPending({
        conversationId: CONV_ID,
        requestId: 'req-1',
        callId: 'call-1',
        toolName: 'bash',
        description: 'test',
      });

      expect(manager.getState().sessionState).toBe('idle');
    });

    it('is safe to call dispose multiple times', () => {
      manager.dispose();
      manager.dispose();
      expect(manager.getState().sessionState).toBe('idle');
    });
  });
});
