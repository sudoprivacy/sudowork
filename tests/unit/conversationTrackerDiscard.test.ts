/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';

const recordMock = vi.hoisted(() => vi.fn());

vi.mock('../../src/process/telemetry/TelemetryBatchReporter', () => ({
  getTelemetryReporter: () => ({ record: recordMock }),
}));

describe('ConversationTracker.discardConversation', () => {
  it('removes tracking state without emitting a telemetry record', async () => {
    const { getConversationTracker, stopConversationTracking } = await import('../../src/process/telemetry/ConversationTracker');
    const tracker = getConversationTracker();

    tracker.startConversation('conv-x', 'model-1');
    expect(tracker.getConversationState('conv-x')).toBeTruthy();

    recordMock.mockClear();
    stopConversationTracking('conv-x');

    expect(tracker.getConversationState('conv-x')).toBeUndefined();
    expect(recordMock).not.toHaveBeenCalled();
  });

  it('endConversationSuccess (the report variant) DOES emit a record', async () => {
    const { getConversationTracker, endConversationSuccess } = await import('../../src/process/telemetry/ConversationTracker');
    const tracker = getConversationTracker();

    tracker.startConversation('conv-y', 'model-1');
    recordMock.mockClear();
    endConversationSuccess('conv-y');

    expect(recordMock).toHaveBeenCalledTimes(1);
    expect(tracker.getConversationState('conv-y')).toBeUndefined();
  });
});
