/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import type { TimelineSection } from '../../src/renderer/pages/conversation/grouped-history/types';

// ── localStorage mock ────────────────────────────────────────────────────────

const storageMap = new Map<string, string>();
const localStorageMock = {
  getItem: vi.fn((key: string) => storageMap.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => storageMap.set(key, value)),
  removeItem: vi.fn((key: string) => storageMap.delete(key)),
  clear: vi.fn(() => storageMap.clear()),
  get length() {
    return storageMap.size;
  },
  key: vi.fn((_index: number) => null),
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true, configurable: true });

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockInvoke = vi.fn().mockResolvedValue([]);

// Track IPC listener registrations for conversationChanged
let conversationChangedCallback: ((...args: unknown[]) => void) | null = null;
const mockConversationChangedOn = vi.fn((cb: (...args: unknown[]) => void) => {
  conversationChangedCallback = cb;
  return () => {
    conversationChangedCallback = null;
  };
});

vi.mock('../../src/common', () => ({
  ipcBridge: {
    database: {
      getUserConversations: { invoke: (...args: unknown[]) => mockInvoke(...args) },
      conversationChanged: { on: (...args: unknown[]) => mockConversationChangedOn(...args) },
    },
  },
}));

vi.mock('react-router-dom', () => ({
  useParams: () => ({}),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// Shared ref so the hoisted mock factory can read the latest value
const testState = { sections: [] as TimelineSection[] };

vi.mock('../../src/renderer/pages/conversation/grouped-history/utils/groupingHelpers', () => ({
  buildGroupedHistory: () => ({
    pinnedConversations: [],
    timelineSections: testState.sections,
  }),
}));

// Track renderer event listener registrations
let chatHistoryRefreshCallback: ((...args: unknown[]) => void) | null = null;
const mockAddEventListener = vi.fn((event: string, cb: (...args: unknown[]) => void) => {
  if (event === 'chat.history.refresh') {
    chatHistoryRefreshCallback = cb;
  }
  return () => {
    if (event === 'chat.history.refresh') {
      chatHistoryRefreshCallback = null;
    }
  };
});

vi.mock('../../src/renderer/utils/emitter', () => ({
  addEventListener: (...args: unknown[]) => mockAddEventListener(...args),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'sudowork_workspace_expansion';

const makeWorkspaceSection = (workspaces: string[]): TimelineSection[] => [
  {
    timeline: 'conversation.history.today',
    items: workspaces.map((ws) => ({
      type: 'workspace' as const,
      time: Date.now(),
      workspaceGroup: {
        workspace: ws,
        displayName: ws.split('/').pop()!,
        conversations: [],
      },
    })),
  },
];

// ── Tests ────────────────────────────────────────────────────────────────────

// Import the hook statically since mocks are hoisted
import { useConversations } from '../../src/renderer/pages/conversation/grouped-history/hooks/useConversations';

describe('useConversations - workspace expansion', () => {
  beforeEach(() => {
    storageMap.clear();
    testState.sections = [];
    mockInvoke.mockResolvedValue([]);
    conversationChangedCallback = null;
    chatHistoryRefreshCallback = null;
    mockConversationChangedOn.mockClear();
    mockAddEventListener.mockClear();
  });

  it('should auto-expand all workspaces on first load when localStorage is empty', async () => {
    testState.sections = makeWorkspaceSection(['/ws/a', '/ws/b']);

    const { result } = renderHook(() => useConversations());
    await act(async () => {});

    expect(result.current.expandedWorkspaces).toEqual(expect.arrayContaining(['/ws/a', '/ws/b']));
    expect(result.current.expandedWorkspaces).toHaveLength(2);
  });

  it('should restore expansion state from localStorage', async () => {
    storageMap.set(STORAGE_KEY, JSON.stringify(['/ws/a']));
    testState.sections = makeWorkspaceSection(['/ws/a', '/ws/b']);

    const { result } = renderHook(() => useConversations());
    await act(async () => {});

    // Should keep only the stored value, not auto-expand all
    expect(result.current.expandedWorkspaces).toEqual(['/ws/a']);
  });

  it('should toggle workspace expansion on handleToggleWorkspace', async () => {
    testState.sections = makeWorkspaceSection(['/ws/a', '/ws/b']);

    const { result } = renderHook(() => useConversations());
    await act(async () => {});
    expect(result.current.expandedWorkspaces).toContain('/ws/a');

    // Collapse /ws/a
    act(() => {
      result.current.handleToggleWorkspace('/ws/a');
    });
    expect(result.current.expandedWorkspaces).not.toContain('/ws/a');
    expect(result.current.expandedWorkspaces).toContain('/ws/b');

    // Expand /ws/a again
    act(() => {
      result.current.handleToggleWorkspace('/ws/a');
    });
    expect(result.current.expandedWorkspaces).toContain('/ws/a');
  });

  it('should persist expansion state to localStorage', async () => {
    testState.sections = makeWorkspaceSection(['/ws/a', '/ws/b']);

    const { result } = renderHook(() => useConversations());
    await act(async () => {});

    act(() => {
      result.current.handleToggleWorkspace('/ws/a');
    });

    const stored = JSON.parse(storageMap.get(STORAGE_KEY)!);
    expect(stored).toEqual(['/ws/b']);
  });

  it('should remove stale workspace entries from expandedWorkspaces', async () => {
    // localStorage has a workspace that no longer exists in data
    storageMap.set(STORAGE_KEY, JSON.stringify(['/ws/a', '/ws/stale']));
    testState.sections = makeWorkspaceSection(['/ws/a', '/ws/b']);

    const { result } = renderHook(() => useConversations());
    await act(async () => {});

    expect(result.current.expandedWorkspaces).not.toContain('/ws/stale');
    expect(result.current.expandedWorkspaces).toContain('/ws/a');
  });

  it('should not re-expand workspaces after user manually collapses all (#1156)', async () => {
    testState.sections = makeWorkspaceSection(['/ws/a']);

    const { result } = renderHook(() => useConversations());
    await act(async () => {});
    expect(result.current.expandedWorkspaces).toEqual(['/ws/a']);

    // User collapses the only workspace
    act(() => {
      result.current.handleToggleWorkspace('/ws/a');
    });

    // Should stay collapsed, not re-expand
    expect(result.current.expandedWorkspaces).toEqual([]);
  });
});

describe('useConversations - IPC channel conversation refresh', () => {
  beforeEach(() => {
    storageMap.clear();
    testState.sections = [];
    mockInvoke.mockClear();
    mockInvoke.mockResolvedValue([]);
    conversationChangedCallback = null;
    chatHistoryRefreshCallback = null;
    mockConversationChangedOn.mockClear();
    mockAddEventListener.mockClear();
  });

  it('should subscribe to conversationChanged IPC event on mount', async () => {
    renderHook(() => useConversations());
    await act(async () => {});

    expect(mockConversationChangedOn).toHaveBeenCalledTimes(1);
    expect(mockConversationChangedOn).toHaveBeenCalledWith(expect.any(Function));
  });

  it('should refresh conversations when IPC conversationChanged event fires', async () => {
    const conversations = [{ id: 'conv-1', name: 'DingTalk Chat', source: 'dingtalk', updated_at: Date.now() }];
    mockInvoke.mockResolvedValue([]);

    renderHook(() => useConversations());
    await act(async () => {});

    // Initial load
    expect(mockInvoke).toHaveBeenCalledTimes(1);

    // Simulate IPC event from main process (channel conversation created)
    mockInvoke.mockResolvedValue(conversations);
    await act(async () => {
      conversationChangedCallback?.({ conversationId: 'conv-1', source: 'dingtalk', action: 'created' });
    });

    // Should have called invoke again to refresh
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it('should still respond to chat.history.refresh renderer event', async () => {
    renderHook(() => useConversations());
    await act(async () => {});

    expect(mockAddEventListener).toHaveBeenCalledWith('chat.history.refresh', expect.any(Function));

    // Initial load
    expect(mockInvoke).toHaveBeenCalledTimes(1);

    // Simulate renderer event
    await act(async () => {
      chatHistoryRefreshCallback?.();
    });

    // Should have called invoke again to refresh
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it('should unsubscribe from IPC event on unmount', async () => {
    const { unmount } = renderHook(() => useConversations());
    await act(async () => {});

    // Should have registered a listener
    expect(conversationChangedCallback).not.toBeNull();

    // Unmount
    unmount();

    // Cleanup should have been called, removing the listener
    expect(conversationChangedCallback).toBeNull();
  });
});
