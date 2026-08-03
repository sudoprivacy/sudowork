/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUserConversations: vi.fn(),
  conversationChangedOn: vi.fn(),
  addEventListener: vi.fn(),
  buildGroupedHistory: vi.fn(),
}));

let conversationChangedCallback: (() => void) | null = null;
let chatHistoryRefreshCallback: (() => void) | null = null;
const removeConversationChangedListener = vi.fn();
const removeChatHistoryRefreshListener = vi.fn();

vi.mock('../../src/common', () => ({
  ipcBridge: {
    database: {
      getUserConversations: { invoke: (...args: unknown[]) => mocks.getUserConversations(...args) },
      conversationChanged: { on: (...args: unknown[]) => mocks.conversationChangedOn(...args) },
    },
  },
}));

vi.mock('react-router-dom', () => ({
  useParams: () => ({}),
}));

vi.mock('../../src/renderer/pages/cron/hooks/useCronJobs', () => ({
  useAllCronJobs: () => ({ jobs: [] }),
}));

vi.mock('../../src/renderer/pages/guid/hooks/useGuidAgentSelection', () => ({
  getRendererSessionMode: () => 'default',
}));

vi.mock('../../src/renderer/utils/emitter', () => ({
  addEventListener: (...args: unknown[]) => mocks.addEventListener(...args),
}));

vi.mock('../../src/renderer/pages/conversation/grouped-history/utils/groupingHelpers', () => ({
  buildGroupedHistory: (...args: unknown[]) => mocks.buildGroupedHistory(...args),
}));

import { useConversations } from '../../src/renderer/pages/conversation/grouped-history/hooks/useConversations';

const EMPTY_GROUPED_HISTORY = {
  pinnedTimeline: [],
  pinnedScheduled: [],
  timelineConversations: [],
  scheduledGroups: [],
};

function makeConversation(id: string, extra?: Record<string, unknown>) {
  return { id, name: id, createTime: 1, updateTime: 1, extra };
}

describe('useConversations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    conversationChangedCallback = null;
    chatHistoryRefreshCallback = null;
    mocks.getUserConversations.mockResolvedValue([]);
    mocks.buildGroupedHistory.mockReturnValue(EMPTY_GROUPED_HISTORY);
    mocks.conversationChangedOn.mockImplementation((callback: () => void) => {
      conversationChangedCallback = callback;
      return removeConversationChangedListener;
    });
    mocks.addEventListener.mockImplementation((event: string, callback: () => void) => {
      if (event === 'chat.history.refresh') chatHistoryRefreshCallback = callback;
      return removeChatHistoryRefreshListener;
    });
  });

  it('loads conversations with the current session mode', async () => {
    renderHook(() => useConversations());

    await waitFor(() => expect(mocks.getUserConversations).toHaveBeenCalledWith({ page: 0, pageSize: 1000, sessionMode: 'default' }));
  });

  it('publishes fetched conversations through grouped history', async () => {
    const conversations = [makeConversation('conv-1')];
    mocks.getUserConversations.mockResolvedValue(conversations);

    renderHook(() => useConversations());

    await waitFor(() => expect(mocks.buildGroupedHistory).toHaveBeenCalledWith(conversations, []));
  });

  it('filters only conversations explicitly marked as health checks', async () => {
    mocks.getUserConversations.mockResolvedValue([makeConversation('health', { isHealthCheck: true }), makeConversation('user-health-name')]);

    renderHook(() => useConversations());

    await waitFor(() => expect(mocks.buildGroupedHistory).toHaveBeenCalledWith([makeConversation('user-health-name')], []));
  });

  it('clears conversations when the bridge returns a non-array value', async () => {
    mocks.getUserConversations.mockResolvedValue(undefined);

    renderHook(() => useConversations());

    await waitFor(() => expect(mocks.buildGroupedHistory).toHaveBeenLastCalledWith([], []));
  });

  it('clears conversations when loading fails', async () => {
    mocks.getUserConversations.mockRejectedValue(new Error('load failed'));

    renderHook(() => useConversations());

    await waitFor(() => expect(mocks.buildGroupedHistory).toHaveBeenLastCalledWith([], []));
  });

  it('subscribes to conversationChanged on mount', async () => {
    renderHook(() => useConversations());

    await waitFor(() => expect(mocks.conversationChangedOn).toHaveBeenCalledWith(expect.any(Function)));
  });

  it('refreshes conversations when conversationChanged fires', async () => {
    renderHook(() => useConversations());
    await waitFor(() => expect(mocks.getUserConversations).toHaveBeenCalledTimes(1));

    await act(async () => {
      conversationChangedCallback?.();
    });

    expect(mocks.getUserConversations).toHaveBeenCalledTimes(2);
  });

  it('subscribes to the renderer history refresh event', async () => {
    renderHook(() => useConversations());

    await waitFor(() => expect(mocks.addEventListener).toHaveBeenCalledWith('chat.history.refresh', expect.any(Function)));
  });

  it('refreshes conversations when the renderer history event fires', async () => {
    renderHook(() => useConversations());
    await waitFor(() => expect(mocks.getUserConversations).toHaveBeenCalledTimes(1));

    await act(async () => {
      chatHistoryRefreshCallback?.();
    });

    expect(mocks.getUserConversations).toHaveBeenCalledTimes(2);
  });

  it('removes both refresh listeners on unmount', async () => {
    const { unmount } = renderHook(() => useConversations());
    await waitFor(() => expect(mocks.conversationChangedOn).toHaveBeenCalled());

    unmount();

    expect(removeConversationChangedListener).toHaveBeenCalledTimes(1);
    expect(removeChatHistoryRefreshListener).toHaveBeenCalledTimes(1);
  });
});
