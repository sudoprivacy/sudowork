import { ipcBridge } from '@/common';
import { shouldSyncWorkspaceSkills } from '@/common/utils/workspaceSkillSync';
import { Spin } from '@arco-design/web-react';
import React, { useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import useSWR from 'swr';
import ChatConversation from './ChatConversation';
import { usePreviewContext } from '@/renderer/pages/conversation/preview';
import { useConversationTabs } from './context/ConversationTabsContext';
import { addEventListener, emitter } from '@/renderer/utils/emitter';

const ChatConversationIndex: React.FC = () => {
  const { id } = useParams();
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
    if (!data || data.type !== 'remote-agent') return;
    const extra = data.extra as { mossSessionId?: string; mossSessionPending?: boolean } | undefined;
    if (!extra?.mossSessionId || extra?.mossSessionPending) return;

    ipcBridge.conversation.syncMessages
      .invoke({ conversation_id: id! })
      .then((result) => {
        if (result.success && result.data) {
          if (result.data.syncedCount > 0) {
            console.log(`[ConversationSync] Synced ${result.data.syncedCount} messages from Moss Server`);
          }
          if (result.data.syncedCount > 0 || result.data.nameUpdated) {
            // Refresh sidebar and conversation data / 刷新侧边栏和会话数据
            emitter.emit('chat.history.refresh');
            void mutate();
          }
        }
      })
      .catch((err) => {
        console.warn('[ConversationSync] Failed to sync messages from Moss Server:', err);
      });
  }, [data?.id, data?.type]);

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
          emitter.emit(data.type === 'openclaw-gateway' ? 'openclaw-gateway.workspace.refresh' : 'acp.workspace.refresh');
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
  }, [id, data, mutate]);

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

  if (isLoading) return <Spin loading></Spin>;
  return <ChatConversation conversation={data}></ChatConversation>;
};

export default ChatConversationIndex;
