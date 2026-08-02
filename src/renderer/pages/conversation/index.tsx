/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Spin } from '@arco-design/web-react';
import React, { useCallback, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import useSWR from 'swr';
import { shouldSyncWorkspaceSkills } from '@/common/utils/workspaceSkillSync';
import { ipcBridge } from '@/common';
import { usePreviewContext } from '@/renderer/pages/conversation/preview';
import { addEventListener, emitter } from '@/renderer/utils/emitter';
import { useAppMode } from '@/renderer/hooks/useAppMode';
import ChatConversation from './ChatConversation';
import { useConversationTabs } from './context/ConversationTabsContext';

const ChatConversationIndex: React.FC = () => {
  const { id } = useParams();
  const { isEnterprise } = useAppMode();
  const { closePreview } = usePreviewContext();
  const { openTab } = useConversationTabs();
  const previousConversationIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!id) return;

    // 切换会话时自动关闭预览面板，避免跨会话残留
    // Close preview on every conversation change, including initial mount
    // (component may remount via React Router, resetting the ref to undefined)
    if (previousConversationIdRef.current !== id) {
      closePreview();
    }

    previousConversationIdRef.current = id;
  }, [id, closePreview]);

  const { data, isLoading, mutate } = useSWR(`conversation/${id}`, () => {
    return ipcBridge.conversation.get.invoke({ id });
  });
  const conversationDataRef = useRef<typeof data>(undefined);

  useEffect(() => {
    conversationDataRef.current = data;
  }, [data]);

  const syncRemoteMessages = useCallback(async () => {
    if (!id) return;

    const conversation = conversationDataRef.current;
    if (!conversation || conversation.type !== 'remote-agent') return;

    const extra = conversation.extra as { mossSessionId?: string; mossSessionPending?: boolean } | undefined;
    if (!extra?.mossSessionId || extra?.mossSessionPending) return;

    try {
      const result = await ipcBridge.conversation.syncMessages.invoke({ conversation_id: id });
      if (result.success && result.data) {
        if (result.data.syncedCount > 0) {
          console.log(`[ConversationSync] Synced ${result.data.syncedCount} messages from Moss Server`);
          emitter.emit('conversation.messages.refresh', id);
        }
        if (result.data.syncedCount > 0 || result.data.nameUpdated) {
          // Refresh sidebar and conversation data / 刷新侧边栏和会话数据
          emitter.emit('chat.history.refresh');
          void mutate();
        }
      }
    } catch (err) {
      console.warn('[ConversationSync] Failed to sync messages from Moss Server:', err);
    }
  }, [id, mutate]);

  // 监听会话历史刷新事件，同步刷新当前会话数据（解决重命名后标题不更新的问题）
  // Listen to history refresh event to sync current conversation data (fixes rename title not updating)
  useEffect(() => {
    if (!id) return;
    return addEventListener('chat.history.refresh', () => {
      void mutate();
    });
  }, [id, mutate]);

  // Enterprise mode: sync messages from Moss Server when clicking a history conversation
  // 企业模式：点击历史会话时从 Moss Server 同步消息到本地数据库
  useEffect(() => {
    void syncRemoteMessages();
  }, [data?.id, data?.type, syncRemoteMessages]);

  useEffect(() => {
    if (!id) return;

    return addEventListener('conversation.remote.sync', (conversationId) => {
      if (conversationId === id) {
        void syncRemoteMessages();
      }
    });
  }, [id, syncRemoteMessages]);

  useEffect(() => {
    if (!id) return;

    const handleSkillsChanged = () => {
      if (!data || !shouldSyncWorkspaceSkills(data)) {
        return;
      }

      void ipcBridge.conversation.syncWorkspaceSkills
        .invoke({ conversation_id: data.id })
        .then(() => {
          void mutate();
          emitter.emit(isEnterprise && data.type === 'remote-agent' ? 'remote-agent.workspace.refresh' : 'acp.workspace.refresh');
        })
        .catch((error) => {
          console.warn('Failed to sync workspace skills after skills.changed:', error);
        });
    };

    const removeSkillHubChanged = ipcBridge.skillHub.changed.on(() => {
      emitter.emit('skills.changed');
    });
    const removeSkillsChanged = addEventListener('skills.changed', handleSkillsChanged);

    return () => {
      removeSkillHubChanged();
      removeSkillsChanged();
    };
  }, [id, data, isEnterprise, mutate]);

  // 当会话数据加载完成后，自动打开 tab
  // Automatically open tab when conversation data is loaded
  useEffect(() => {
    if (data) {
      openTab(data);
      if (shouldSyncWorkspaceSkills(data)) {
        void ipcBridge.conversation.syncWorkspaceSkills.invoke({ conversation_id: data.id }).catch((error) => {
          console.warn('Failed to sync workspace skills:', error);
        });
      }
    }
  }, [data, openTab]);

  // Re-bind the conversation to its Dify enhancement orchestrator each time
  // the conversation page mounts. The main process holds bindings only in
  // memory, so a process restart (or app relaunch) clears them; rebinding on
  // page mount guarantees the orchestrator is warm before the user types.
  // This is a no-op for non-enhanced assistants (resolveSudohubAssistantId
  // returns null) and for missing tokens.
  useEffect(() => {
    if (!data?.id) return;
    const extra = data.extra as { presetAssistantId?: string; customAgentId?: string } | undefined;
    const assistantHint = extra?.presetAssistantId || extra?.customAgentId;
    if (!assistantHint) return;
    void (async () => {
      try {
        const { bindAssistantSession } = await import('@/renderer/shared/dify/sessionBinding');
        await bindAssistantSession({
          conversationId: data.id,
          presetAssistantIdOrName: assistantHint,
        });
      } catch (err) {
        console.warn('[Dify] rebind on conversation mount failed:', err);
      }
    })();
  }, [data?.id, data?.extra]);

  if (isLoading) {
    return (
      <div className='flex flex-1 items-center justify-center'>
        <Spin loading />
      </div>
    );
  }
  return <ChatConversation conversation={data}></ChatConversation>;
};

export default ChatConversationIndex;
