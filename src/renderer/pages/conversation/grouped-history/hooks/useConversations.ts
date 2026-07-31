/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ipcBridge } from '@/common';
import type { TChatConversation } from '@/common/storage';
import { addEventListener } from '@/renderer/utils/emitter';
import { useAllCronJobs } from '@/renderer/pages/cron/hooks/useCronJobs';
import { getRendererSessionMode } from '@/renderer/pages/guid/hooks/useGuidAgentSelection';

import type { GroupedHistoryResult } from '../types';
import { buildGroupedHistory } from '../utils/groupingHelpers';

export const useConversations = () => {
  const [conversations, setConversations] = useState<TChatConversation[]>([]);
  const { id } = useParams();

  // Fetch conversations via Provider abstraction layer (works for both local and enterprise mode)
  useEffect(() => {
    const refresh = () => {
      const sessionMode = getRendererSessionMode();
      ipcBridge.database.getUserConversations
        .invoke({ page: 0, pageSize: 1000, sessionMode })
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

  const { jobs: cronJobs } = useAllCronJobs();

  const groupedHistory: GroupedHistoryResult = useMemo(() => buildGroupedHistory(conversations, cronJobs), [conversations, cronJobs]);

  const { pinnedTimeline, pinnedScheduled, timelineConversations, scheduledGroups } = groupedHistory;

  return {
    conversations,
    pinnedTimeline,
    pinnedScheduled,
    timelineConversations,
    scheduledGroups,
  };
};
