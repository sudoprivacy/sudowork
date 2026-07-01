/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  getConversation: vi.fn(() => ({ success: true, data: { id: 'c', extra: {} } })),
  getConversationMessages: vi.fn(() => ({ data: [] })),
  insertMessage: vi.fn(() => ({ success: true })),
  updateMessage: vi.fn(() => ({ success: true })),
}));

vi.mock('@process/database/export', () => ({
  getDatabase: () => ({
    getConversation: h.getConversation,
    getConversationMessages: h.getConversationMessages,
    insertMessage: h.insertMessage,
    updateMessage: h.updateMessage,
    createConversation: vi.fn(() => ({ success: true })),
  }),
}));
vi.mock('@process/initStorage', () => ({ ProcessChat: { get: vi.fn(async () => []) } }));
vi.mock('@process/utils/mainLogger', () => ({ mainLog: vi.fn(), mainWarn: vi.fn(), mainError: vi.fn() }));

const message = { id: 'm1', position: 'left', content: [{ type: 'text', text: 'hi' }] } as any;

describe('message disposeConversation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.values(h).forEach((fn) => (fn as any).mockClear?.());
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('clears the pending-save timer so no flush happens after dispose', async () => {
    const { addOrUpdateMessage, disposeConversation } = await import('../../src/process/message');

    addOrUpdateMessage('c', message); // schedules a 2000ms debounce timer
    disposeConversation('c');

    await vi.advanceTimersByTimeAsync(5000);
    expect(h.getConversationMessages).not.toHaveBeenCalled();
  });

  it('control: without dispose the debounce timer fires and flushes', async () => {
    const { addOrUpdateMessage } = await import('../../src/process/message');

    addOrUpdateMessage('c2', message);
    await vi.advanceTimersByTimeAsync(2000);

    expect(h.getConversationMessages).toHaveBeenCalled();
  });
});
