import { useHostedHistory } from '@renderer/pages/hosted-agents/useHostedHistory';
import { useExternalHistory } from '@renderer/pages/external-agents/useExternalHistory';
import { mergeExternalHistory } from '@renderer/pages/external-agents/history';
/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { useAllCronJobs } from '@renderer/pages/cron/hooks/useCronJobs';
import { useConversationHistory } from '../../context/ConversationHistoryContext';

import type { GroupedHistoryResult } from '../types';
import { buildGroupedHistory, isConversationArchived } from '../utils/groupingHelpers';

const EXPANSION_STORAGE_KEY = 'sudowork_workspace_expansion';

export const useConversations = () => {
  const { conversations, agents: myAgents } = useConversationHistory();
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

  // Track whether auto-expand has already been performed to avoid
  // re-expanding workspaces after a user manually collapses them (#1156)
  const hasAutoExpandedRef = useRef(false);

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

  const { jobs: cronJobs } = useAllCronJobs();
  const externalHistory = useExternalHistory();
  const hostedHistory = useHostedHistory();

  const activeConversations = useMemo(() => conversations.filter((conversation) => !isConversationArchived(conversation)), [conversations]);
  const archivedConversations = useMemo(() => conversations.filter(isConversationArchived).sort((a, b) => (b.extra?.archivedAt ?? b.modifyTime) - (a.extra?.archivedAt ?? a.modifyTime)), [conversations]);

  const groupedHistory: GroupedHistoryResult = useMemo(() => {
    const result = buildGroupedHistory(activeConversations, t, cronJobs, myAgents);
    return result;
  }, [activeConversations, t, cronJobs, myAgents]);

  const { pinnedTimeline, pinnedScheduled, timelineSections, scheduledGroups, agentGroups } = useMemo(() => mergeExternalHistory(groupedHistory, [...externalHistory.conversations, ...hostedHistory.conversations], t), [groupedHistory, externalHistory.conversations, hostedHistory.conversations, t]);

  // Auto-expand all workspaces on first load only (#1156)
  useEffect(() => {
    if (hasAutoExpandedRef.current) return;
    if (expandedWorkspaces.length > 0) {
      hasAutoExpandedRef.current = true;
      return;
    }
    const allWorkspaces: string[] = [];
    timelineSections.forEach((section) => {
      section.items.forEach((item) => {
        if (item.type === 'workspace' && item.workspaceGroup) {
          allWorkspaces.push(item.workspaceGroup.workspace);
        }
      });
    });
    if (allWorkspaces.length > 0) {
      setExpandedWorkspaces(allWorkspaces);
      hasAutoExpandedRef.current = true;
    }
  }, [timelineSections]);

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

  return {
    conversations,
    archivedConversations,
    externalHistoryFailed: externalHistory.isFailed,
    onRefreshExternalHistory: externalHistory.onRefresh,
    expandedWorkspaces,
    pinnedTimeline,
    pinnedScheduled,
    timelineSections,
    scheduledGroups,
    agentGroups,
    handleToggleWorkspace,
  };
};
