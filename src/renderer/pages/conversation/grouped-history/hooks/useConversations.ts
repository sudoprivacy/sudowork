/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { TChatConversation } from '@/common/storage';
import { addEventListener } from '@/renderer/utils/emitter';
import { useAllCronJobs } from '@/renderer/pages/cron/hooks/useCronJobs';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';

import type { GroupedHistoryResult } from '../types';
import { buildGroupedHistory, filterConversations } from '../utils/groupingHelpers';

const EXPANSION_STORAGE_KEY = 'aionui_workspace_expansion';

export const useConversations = (searchQuery = '') => {
  const [conversations, setConversations] = useState<TChatConversation[]>([]);
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(EXPANSION_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        return Array.isArray(parsed) ? parsed : [];
      }
    } catch {
      // ignore
    }
    return [];
  });
  const { id } = useParams();
  const { t } = useTranslation();

  // ── Section ordering: which section is pinned to top ──
  // When active conversation changes, this is updated to the section containing it.
  type SectionType = 'scheduled' | 'pinned' | 'timeline';
  const [activeSectionType, setActiveSectionType] = useState<SectionType | null>(null);
  // For timeline type: which specific timeline label (e.g. "今天") is active.
  const [activeTimelineLabel, setActiveTimelineLabel] = useState<string | null>(null);

  // Track whether initial auto-expand has been performed (#1156)
  const hasAutoExpandedRef = useRef(false);

  useEffect(() => {
    const refresh = () => {
      ipcBridge.database.getUserConversations
        .invoke({ page: 0, pageSize: 10000 })
        .then((data) => {
          if (data && Array.isArray(data)) {
            // 只过滤显式标记的健康检测临时会话，避免误伤用户自定义同名前缀会话
            const filteredData = data.filter((conv) => (conv.extra as { isHealthCheck?: boolean } | undefined)?.isHealthCheck !== true);
            setConversations(filteredData);
          } else {
            setConversations([]);
          }
        })
        .catch((error) => {
          console.error('[WorkspaceGroupedHistory] Failed to load conversations:', error);
          setConversations([]);
        });
    };

    refresh();
    const removeLocalListener = addEventListener('chat.history.refresh', refresh);
    // 监听主进程的渠道对话变更事件（钉钉、飞书、Telegram 等渠道对话创建/更新时触发）
    const removeBridgeListener = ipcBridge.database.conversationChanged.on(() => {
      refresh();
    });

    // 低频轮询兜底：防止 WebSocket/IPC 事件丢失导致渠道对话列表不更新
    // Low-frequency polling fallback: prevent channel conversation list from not updating
    // when WebSocket/IPC events are lost
    const pollInterval = setInterval(refresh, 30_000);

    return () => {
      removeLocalListener();
      removeBridgeListener();
      clearInterval(pollInterval);
    };
  }, []);

  const { jobs: cronJobs } = useAllCronJobs();

  const groupedHistory: GroupedHistoryResult = useMemo(() => {
    const filtered = filterConversations(conversations, searchQuery);
    return buildGroupedHistory(filtered, t, cronJobs);
  }, [conversations, t, cronJobs, searchQuery]);

  const { pinnedConversations, timelineSections, scheduledGroups } = groupedHistory;

  // ── Determine which section the active conversation belongs to ──
  const findConversationSection = useCallback(() => {
    if (!id) return { sectionType: null as SectionType | null, timelineLabel: null as string | null };

    // Check pinned
    if (pinnedConversations.some((c) => c.id === id)) {
      return { sectionType: 'pinned' as SectionType, timelineLabel: null };
    }

    // Check scheduled
    for (const group of scheduledGroups) {
      if (group.conversations.some((c) => c.id === id)) {
        return { sectionType: 'scheduled' as SectionType, timelineLabel: null };
      }
    }

    // Check timeline sections
    for (const section of timelineSections) {
      const found = section.items.some((item) => {
        if (item.type === 'workspace' && item.workspaceGroup) {
          return item.workspaceGroup.conversations.some((c) => c.id === id);
        }
        if (item.type === 'conversation' && item.conversation) {
          return item.conversation.id === id;
        }
        return false;
      });
      if (found) {
        return { sectionType: 'timeline' as SectionType, timelineLabel: section.timeline };
      }
    }

    return { sectionType: null as SectionType | null, timelineLabel: null as string | null };
  }, [id, pinnedConversations, scheduledGroups, timelineSections]);

  // ── Auto-expand workspace for active conversation ──
  const findConversationWorkspace = useCallback(() => {
    if (!id) return null;
    for (const section of timelineSections) {
      for (const item of section.items) {
        if (item.type === 'workspace' && item.workspaceGroup) {
          if (item.workspaceGroup.conversations.some((c) => c.id === id)) {
            return item.workspaceGroup.workspace;
          }
        }
      }
    }
    return null;
  }, [id, timelineSections]);

  // ── Section reordering & workspace auto-expand ──
  // Unified logic: whenever the active conversation changes,
  // determine which section it belongs to and pin that section to top.
  useEffect(() => {
    const allWorkspaces: string[] = [];
    timelineSections.forEach((section) => {
      section.items.forEach((item) => {
        if (item.type === 'workspace' && item.workspaceGroup) {
          allWorkspaces.push(item.workspaceGroup.workspace);
        }
      });
    });

    const { sectionType, timelineLabel } = findConversationSection();
    const activeWs = findConversationWorkspace();

    if (!hasAutoExpandedRef.current) {
      // First load: expand all workspaces
      setExpandedWorkspaces(allWorkspaces);
      hasAutoExpandedRef.current = true;

      if (sectionType) {
        setActiveSectionType(sectionType);
        setActiveTimelineLabel(timelineLabel);
      } else {
        // No active conversation: default to "Today" section
        setActiveSectionType('timeline');
        setActiveTimelineLabel(t('conversation.history.today'));
      }
      return;
    }

    // Active conversation changed: update section ordering
    if (sectionType) {
      setActiveSectionType(sectionType);
      setActiveTimelineLabel(timelineLabel);
    }

    // Auto-expand workspace containing active conversation
    if (activeWs) {
      setExpandedWorkspaces((prev) => {
        if (prev.includes(activeWs)) return prev;
        return [activeWs, ...prev];
      });
    }
  }, [id, timelineSections, pinnedConversations.length, scheduledGroups.length, t, findConversationSection, findConversationWorkspace]);

  // Scroll active conversation into view
  useEffect(() => {
    if (!id) return;
    const rafId = requestAnimationFrame(() => {
      const element = document.getElementById('c-' + id);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
    return () => cancelAnimationFrame(rafId);
  }, [id]);

  // Persist expansion state
  useEffect(() => {
    try {
      localStorage.setItem(EXPANSION_STORAGE_KEY, JSON.stringify(expandedWorkspaces));
    } catch {
      // ignore
    }
  }, [expandedWorkspaces]);

  // Remove stale workspace entries that no longer exist in the data
  useEffect(() => {
    const currentWorkspaces = new Set<string>();
    timelineSections.forEach((section) => {
      section.items.forEach((item) => {
        if (item.type === 'workspace' && item.workspaceGroup) {
          currentWorkspaces.add(item.workspaceGroup.workspace);
        }
      });
    });
    if (currentWorkspaces.size === 0) return;
    setExpandedWorkspaces((prev) => {
      const filtered = prev.filter((ws) => currentWorkspaces.has(ws));
      return filtered.length === prev.length ? prev : filtered;
    });
  }, [timelineSections]);

  const handleToggleWorkspace = useCallback((workspace: string) => {
    setExpandedWorkspaces((prev) => {
      if (prev.includes(workspace)) {
        return prev.filter((item) => item !== workspace);
      }
      return [...prev, workspace];
    });
  }, []);

  // ── Reorder timeline sections: active section first ──
  const reorderedTimelineSections = useMemo(() => {
    if (!activeTimelineLabel) return timelineSections;

    return [...timelineSections].sort((a, b) => {
      if (a.timeline === activeTimelineLabel) return -1;
      if (b.timeline === activeTimelineLabel) return 1;
      // Maintain default order for others
      const order = [t('conversation.history.today'), t('conversation.history.yesterday'), t('conversation.history.recent7Days'), t('conversation.history.earlier')];
      return order.indexOf(a.timeline) - order.indexOf(b.timeline);
    });
  }, [timelineSections, activeTimelineLabel, t]);

  // ── Compute render order based on active section type ──
  // Pinned always renders first (if it exists).
  // Among the remaining sections, the one containing the active conversation goes first.
  const sectionRenderOrder = useMemo(() => {
    const order: SectionType[] = [];

    // 1. Pinned always first (if any pinned conversations exist)
    if (pinnedConversations.length > 0) order.push('pinned');

    // 2. Active section among the rest (scheduled or timeline)
    if (activeSectionType && activeSectionType !== 'pinned') order.push(activeSectionType);

    // 3. Remaining sections in default order
    if (activeSectionType !== 'timeline') order.push('timeline');
    if (activeSectionType !== 'scheduled') order.push('scheduled');

    return order;
  }, [activeSectionType, pinnedConversations.length]);

  return {
    conversations,
    expandedWorkspaces,
    pinnedConversations,
    timelineSections: reorderedTimelineSections,
    scheduledGroups,
    handleToggleWorkspace,
    sectionRenderOrder,
    activeTimelineLabel,
  };
};
