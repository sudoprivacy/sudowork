/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { SWRConfig } from 'swr';

import type { TimelineSection } from '@renderer/pages/conversation/grouped-history/types';
import { externalSessionView } from '@renderer/pages/external-agents/navigation';
import type { ExternalConversationView } from '@renderer/pages/external-agents/navigation';

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

const externalHistoryState = vi.hoisted(() => ({ conversations: [] as ExternalConversationView[], isFailed: false, onRefresh: vi.fn() }));
vi.mock('@renderer/pages/external-agents/useExternalHistory', () => ({ useExternalHistory: () => externalHistoryState }));
beforeEach(() => {
  externalHistoryState.conversations = [];
});

vi.mock('@sudowork/host-bridge/ipcBridge', () => ({
  eeclaw: { getMyAgents: { invoke: async () => ({ success: true, data: [] }) } },
  cron: {
    listJobs: { invoke: async () => [] },
    listJobsByConversation: { invoke: async () => [] },
    removeJob: { invoke: async () => ({}) },
    updateJob: { invoke: async () => ({}) },
    onJobCreated: { on: () => () => {} },
    onJobUpdated: { on: () => () => {} },
    onJobRemoved: { on: () => () => {} },
  },
  database: {
    getUserConversations: { invoke: (...args: unknown[]) => mockInvoke(...args) },
    conversationChanged: { on: (...args: unknown[]) => mockConversationChangedOn(...args) },
  },
}));

vi.mock('@renderer/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'test-user' }, ready: true, status: 'authenticated' }) }));
vi.mock('@renderer/pages/guid/hooks/useGuidAgentSelection', () => ({ getRendererSessionMode: () => 'remote' }));

vi.mock('react-router-dom', () => ({
  useParams: () => ({}),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// Shared ref so the hoisted mock factory can read the latest value
const testState = { sections: [] as TimelineSection[], activeIds: [] as string[] };

vi.mock('@renderer/pages/conversation/grouped-history/utils/groupingHelpers', () => ({
  isConversationArchived: (conversation: { extra?: { archived?: boolean } }) => conversation.extra?.archived === true,
  buildGroupedHistory: (conversations: Array<{ id: string }>) => {
    testState.activeIds = conversations.map((conversation) => conversation.id);
    return {
      pinnedConversations: [],
      pinnedTimeline: [],
      pinnedScheduled: [],
      scheduledGroups: [],
      agentGroups: [],
      timelineSections: testState.sections,
    };
  },
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

vi.mock('@renderer/utils/emitter', () => ({
  addEventListener: (...args: unknown[]) => mockAddEventListener(...args),
  // `useMyAgents` subscribes here too: the agent list changes when a new agent
  // is made or a template is first used. A mock that covers only this file's
  // own use breaks the moment another hook in the tree reaches for the module.
  emitter: { on: () => {}, off: () => {}, emit: () => {} },
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
import { useConversations } from '@renderer/pages/conversation/grouped-history/hooks/useConversations';
import { ConversationHistoryProvider } from '@renderer/pages/conversation/context/ConversationHistoryContext';

function renderConversationHook() {
  const cache = new Map();
  function Wrapper({ children }: PropsWithChildren) {
    return createElement(SWRConfig, { value: { provider: () => cache, dedupingInterval: 0 } }, createElement(ConversationHistoryProvider, null, children));
  }
  return renderHook(() => useConversations(), { wrapper: Wrapper });
}

describe('useConversations - workspace expansion', () => {
  beforeEach(() => {
    storageMap.clear();
    testState.sections = [];
    testState.activeIds = [];
    mockInvoke.mockResolvedValue([]);
    conversationChangedCallback = null;
    chatHistoryRefreshCallback = null;
    mockConversationChangedOn.mockClear();
    mockAddEventListener.mockClear();
  });

  it('keeps archived conversations out of active groups and orders them by archive time', async () => {
    mockInvoke.mockResolvedValue([
      { id: 'active', modifyTime: 30, extra: { backend: 'scode' } },
      { id: 'old-archive', modifyTime: 20, extra: { backend: 'scode', archived: true, archivedAt: 10 } },
      { id: 'new-archive', modifyTime: 10, extra: { backend: 'scode', archived: true, archivedAt: 40 } },
    ]);

    const { result } = renderConversationHook();
    await act(async () => {});

    expect(mockInvoke).toHaveBeenCalledWith({ page: 0, pageSize: 10000, includeAllExecutionTargets: true });
    expect(testState.activeIds).toEqual(['active']);
    expect(result.current.archivedConversations.map((conversation) => conversation.id)).toEqual(['new-archive', 'old-archive']);
  });

  it('should auto-expand all workspaces on first load when localStorage is empty', async () => {
    testState.sections = makeWorkspaceSection(['/ws/a', '/ws/b']);

    const { result } = renderConversationHook();
    await act(async () => {});

    expect(result.current.expandedWorkspaces).toEqual(expect.arrayContaining(['/ws/a', '/ws/b']));
    expect(result.current.expandedWorkspaces).toHaveLength(2);
  });

  it('should restore expansion state from localStorage', async () => {
    storageMap.set(STORAGE_KEY, JSON.stringify(['/ws/a']));
    testState.sections = makeWorkspaceSection(['/ws/a', '/ws/b']);

    const { result } = renderConversationHook();
    await act(async () => {});

    // Should keep only the stored value, not auto-expand all
    expect(result.current.expandedWorkspaces).toEqual(['/ws/a']);
  });

  it('should toggle workspace expansion on handleToggleWorkspace', async () => {
    testState.sections = makeWorkspaceSection(['/ws/a', '/ws/b']);

    const { result } = renderConversationHook();
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

    const { result } = renderConversationHook();
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

    const { result } = renderConversationHook();
    await act(async () => {});

    expect(result.current.expandedWorkspaces).not.toContain('/ws/stale');
    expect(result.current.expandedWorkspaces).toContain('/ws/a');
  });

  it('should not re-expand workspaces after user manually collapses all (#1156)', async () => {
    testState.sections = makeWorkspaceSection(['/ws/a']);

    const { result } = renderConversationHook();
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
    renderConversationHook();
    await act(async () => {});

    expect(mockConversationChangedOn).toHaveBeenCalledTimes(1);
    expect(mockConversationChangedOn).toHaveBeenCalledWith(expect.any(Function));
  });

  it('should refresh conversations when IPC conversationChanged event fires', async () => {
    const conversations = [{ id: 'conv-1', name: 'DingTalk Chat', source: 'dingtalk', updated_at: Date.now() }];
    mockInvoke.mockResolvedValue([]);

    renderConversationHook();
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
    renderConversationHook();
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
    const { unmount } = renderConversationHook();
    await act(async () => {});

    // Should have registered a listener
    expect(conversationChangedCallback).not.toBeNull();

    // Unmount
    unmount();

    // Cleanup should have been called, removing the listener
    expect(conversationChangedCallback).toBeNull();
  });
});

it('merges external history without adding it to the shared native conversation source', async () => {
  storageMap.clear();
  testState.sections = [];
  const native = { id: 'native-session', type: 'acp', name: 'Native', createTime: Date.now(), extra: { backend: 'scode' } };
  mockInvoke.mockResolvedValue([native]);
  const external = externalSessionView({ id: 'remote-session', agent_id: 'published', agent_name: 'External', title: 'External history', created_at: Date.now(), updated_at: Date.now(), active_task_id: null });
  externalHistoryState.conversations = [external];
  const { result } = renderConversationHook();
  await act(async () => {});
  expect(result.current.conversations).toEqual([native]);
  expect(result.current.timelineSections.flatMap((section) => section.items).map((item) => item.conversation)).toContainEqual(external);
  expect(result.current.agentGroups).toEqual([]);
});
