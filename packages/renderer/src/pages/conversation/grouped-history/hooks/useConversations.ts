/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import * as ipcBridge from '@sudowork/host-bridge/ipcBridge';
import type { TChatConversation } from '@sudowork/common/storage';
import { addEventListener } from '@renderer/utils/emitter';
import { useAllCronJobs } from '@renderer/pages/cron/hooks/useCronJobs';
import { getRendererSessionMode } from '@renderer/pages/guid/hooks/useGuidAgentSelection';

import type { GroupedHistoryResult } from '../types';
import { buildGroupedHistory } from '../utils/groupingHelpers';

const EXPANSION_STORAGE_KEY = 'sudowork_workspace_expansion';

export const useConversations = () => {
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

  // Track whether auto-expand has already been performed to avoid
  // re-expanding workspaces after a user manually collapses them (#1156)
  const hasAutoExpandedRef = useRef(false);

  // Fetch conversations via Provider abstraction layer (works for both local and enterprise mode)
  useEffect(() => {
    const refresh = () => {
      const sessionMode = getRendererSessionMode();
      ipcBridge.database.getUserConversations
        .invoke({ page: 0, pageSize: 10000, sessionMode })
        .then((data) => {
          if (data && Array.isArray(data)) {
            // Filter out health check conversations / 只过滤显式标记的健康检测临时会话，避免误伤用户自定义同名前缀会话
            const filteredData = data.filter((conv) => (conv.extra as { isHealthCheck?: boolean } | undefined)?.isHealthCheck !== true);
            console.log('[useConversations] Fetched conversations:', filteredData.length);
            setConversations(filteredData);
          } else {
            setConversations([]);
          }
        })
        .catch((error) => {
          console.error('[useConversations] Failed to load conversations:', error);
          setConversations([]);
        });
    };

    refresh();
    const removeLocalListener = addEventListener('chat.history.refresh', refresh);
    // Listen for channel conversation changes (DingTalk, Feishu, Telegram, etc.) / 监听主进程的渠道对话变更事件（钉钉、飞书、Telegram 等渠道对话创建/更新时触发）
    const removeBridgeListener = ipcBridge.database.conversationChanged.on(() => {
      refresh();
    });

    // Low-frequency polling fallback: prevent conversation list from not updating
    // when WebSocket/IPC events are lost / 低频轮询兜底：防止 WebSocket/IPC 事件丢失导致会话列表不更新
    const pollInterval = setInterval(refresh, 30_000);

    return () => {
      removeLocalListener();
      removeBridgeListener();
      clearInterval(pollInterval);
    };
  }, []);

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

  const groupedHistory: GroupedHistoryResult = useMemo(() => {
    const result = buildGroupedHistory(conversations, t, cronJobs);
    return result;
  }, [conversations, t, cronJobs]);

  const { pinnedTimeline, pinnedScheduled, timelineSections, scheduledGroups } = groupedHistory;

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
    expandedWorkspaces,
    pinnedTimeline,
    pinnedScheduled,
    timelineSections,
    scheduledGroups,
    handleToggleWorkspace,
  };
};
