/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure keyboard-guard decisions for the sendbox. Extracted so the gating logic —
 * which shares one onKeyDown with the skill/slash popups and multi-line cursor
 * movement — is unit-testable without mounting the component. The guards ensure a
 * new key only fires when unambiguous and never hijacks an existing key.
 * See docs/plans/2026-07-01-conversation-interrupt-and-queue.html §3.4.
 */

export type SendboxKeyAction = 'interrupt' | 'dequeue' | 'none';

/**
 * Decide what a non-popup key does (callers handle popups first). Esc interrupts only
 * while a turn is running; Up dequeues only when the input is empty AND the queue is
 * non-empty — otherwise Up is left to normal cursor/history movement.
 */
export function resolveSendboxKey(key: string, ctx: { running: boolean; inputEmpty: boolean; queueLength: number; canStop: boolean; canDequeue: boolean }): SendboxKeyAction {
  if (key === 'Escape' && ctx.running && ctx.canStop) return 'interrupt';
  if (key === 'ArrowUp' && ctx.inputEmpty && ctx.queueLength > 0 && ctx.canDequeue) return 'dequeue';
  return 'none';
}

/**
 * Whether a submit should be blocked while a turn may be running.
 *  - 'in-flight': a local send is already dispatching (avoid double-submit; silent).
 *  - 'in-progress': a turn is running and submit-while-running is off (show the notice).
 *  - null: allow — proceeds to the coordinator, which queues or interrupts.
 */
export function shouldBlockSubmit(ctx: { loading: boolean; localSendInFlight: boolean; allowSubmitWhileRunning: boolean }): 'in-flight' | 'in-progress' | null {
  if (ctx.localSendInFlight) return 'in-flight';
  if (ctx.loading && !ctx.allowSubmitWhileRunning) return 'in-progress';
  return null;
}
