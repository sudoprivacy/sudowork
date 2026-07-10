/**
 * Guards the sendbox keyboard gating: the new keys (Esc→interrupt, Up→dequeue) and the
 * submit-while-running rule must fire only when unambiguous, so they never hijack the
 * skill/slash popups or multi-line cursor movement.
 */
import { describe, it, expect } from 'vitest';
import { resolveSendboxKey, shouldBlockSubmit } from '@renderer/components/sendboxKeyGuards';

const keyCtx = (over: Partial<Parameters<typeof resolveSendboxKey>[1]> = {}) => ({ running: false, inputEmpty: true, queueLength: 0, canStop: true, canDequeue: true, ...over });

describe('resolveSendboxKey', () => {
  it('Esc interrupts only while running', () => {
    expect(resolveSendboxKey('Escape', keyCtx({ running: true }))).toBe('interrupt');
    expect(resolveSendboxKey('Escape', keyCtx({ running: false }))).toBe('none');
    expect(resolveSendboxKey('Escape', keyCtx({ running: true, canStop: false }))).toBe('none');
  });

  it('Up dequeues only when input empty AND queue non-empty', () => {
    expect(resolveSendboxKey('ArrowUp', keyCtx({ inputEmpty: true, queueLength: 2 }))).toBe('dequeue');
    expect(resolveSendboxKey('ArrowUp', keyCtx({ inputEmpty: false, queueLength: 2 }))).toBe('none'); // mid-edit → cursor move
    expect(resolveSendboxKey('ArrowUp', keyCtx({ inputEmpty: true, queueLength: 0 }))).toBe('none'); // nothing to dequeue
    expect(resolveSendboxKey('ArrowUp', keyCtx({ inputEmpty: true, queueLength: 2, canDequeue: false }))).toBe('none');
  });

  it('other keys are left alone', () => {
    expect(resolveSendboxKey('a', keyCtx({ running: true, queueLength: 3 }))).toBe('none');
    expect(resolveSendboxKey('Enter', keyCtx({ running: true }))).toBe('none'); // Enter handled elsewhere
  });
});

describe('shouldBlockSubmit', () => {
  it('a local send in flight blocks silently (double-submit guard) — highest priority', () => {
    expect(shouldBlockSubmit({ loading: false, localSendInFlight: true, allowSubmitWhileRunning: true })).toBe('in-flight');
    expect(shouldBlockSubmit({ loading: true, localSendInFlight: true, allowSubmitWhileRunning: false })).toBe('in-flight');
  });

  it('running + submit-while-running OFF → in-progress notice', () => {
    expect(shouldBlockSubmit({ loading: true, localSendInFlight: false, allowSubmitWhileRunning: false })).toBe('in-progress');
  });

  it('running + submit-while-running ON → allowed (goes to coordinator)', () => {
    expect(shouldBlockSubmit({ loading: true, localSendInFlight: false, allowSubmitWhileRunning: true })).toBeNull();
  });

  it('idle → allowed', () => {
    expect(shouldBlockSubmit({ loading: false, localSendInFlight: false, allowSubmitWhileRunning: false })).toBeNull();
  });
});
