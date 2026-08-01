/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Dropdown, Menu, Typography } from '@arco-design/web-react';
import { History } from 'lucide-react';
import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import { usePresetAssistantInfo } from '@/renderer/hooks/usePresetAssistantInfo';
import type { TChatConversation } from '@/common/storage';
import { ipcBridge } from '@/common';
import { TaskPanelHeaderProvider } from './workspace/TaskPanelHeaderContext';
import ChatSider from './ChatSider';
import ChatLayout from './ChatLayout';
import AcpChat from './acp/AcpChat';

const _AssociatedConversation: React.FC<{ conversation_id: string }> = ({ conversation_id }) => {
  const { data } = useSWR(['getAssociateConversation', conversation_id], () => ipcBridge.conversation.getAssociateConversation.invoke({ conversation_id }));
  const navigate = useNavigate();
  const list = useMemo(() => {
    if (!data?.length) return [];
    return data.filter((conversation) => conversation.id !== conversation_id);
  }, [data, conversation_id]);
  if (!list.length) return null;
  return (
    <Dropdown
      droplist={
        <Menu
          onClickMenuItem={(key) => {
            Promise.resolve(navigate(`/conversation/${key}`)).catch((error) => {
              console.error('Navigation failed:', error);
            });
          }}
        >
          {list.map((conversation) => {
            return (
              <Menu.Item key={conversation.id}>
                <Typography.Ellipsis className={'max-w-300px'}>{conversation.name}</Typography.Ellipsis>
              </Menu.Item>
            );
          })}
        </Menu>
      }
      trigger={['click']}
    >
      <Button size='mini' icon={<History size={14} color='var(--foreground)' strokeWidth={2} strokeLinejoin='miter' strokeLinecap='square' />}></Button>
    </Dropdown>
  );
};

const ChatConversation: React.FC<{
  conversation?: TChatConversation;
}> = ({ conversation }) => {
  // Remote-agent workspaces are loaded from Moss Server, so they may not have a
  // local workspace path in conversation.extra.
  const workspaceEnabled = Boolean(conversation && (conversation.type === 'remote-agent' || conversation.extra?.workspace));

  // 使用统一的 Hook 获取预设助手信息（ACP 会话）
  // Use unified hook for preset assistant info (ACP conversations)
  const { info: presetAssistantInfo, isLoading: isLoadingPreset } = usePresetAssistantInfo(conversation);

  // Resolve agentName: prefer preset assistant name, then extra.agentName, then undefined
  // 优先使用预设助手名称，然后是 extra.agentName
  const resolvedAgentName = presetAssistantInfo?.name || (conversation?.extra as { agentName?: string })?.agentName;

  const conversationNode = useMemo(() => {
    if (!conversation) return null;
    switch (conversation.type) {
      case 'acp':
        return <AcpChat key={conversation.id} conversation_id={conversation.id} workspace={conversation.extra?.workspace} backend={conversation.extra?.backend || 'claude'} sessionMode={conversation.extra?.sessionMode} agentName={resolvedAgentName}></AcpChat>;
      case 'remote-agent': {
        // Remote-agent uses AcpChat with backend='remote-agent' (handled by conversationBridge.sendMessage)
        const remoteExtra = conversation.extra as { mossServerUrl?: string; agentName?: string };
        return <AcpChat key={conversation.id} conversation_id={conversation.id} workspace={conversation.extra?.workspace} backend={'remote-agent'} sessionMode={conversation.extra?.sessionMode} agentName={resolvedAgentName || remoteExtra.agentName || 'Moss Server'}></AcpChat>;
      }
      default:
        return null;
    }
  }, [conversation, resolvedAgentName]);

  // const modelSelector = useMemo(() => {
  //   if (!conversation) return undefined;
  //   if (conversation.type === 'acp') {
  //     const extra = conversation.extra as { backend?: string; currentModelId?: string };
  //     return <AcpModelSelector conversationId={conversation.id} backend={extra.backend} initialModelId={extra.currentModelId} />;
  //   }
  //   if (conversation.type === 'remote-agent') {
  //     const extra = conversation.extra as { currentModelId?: string };
  //     return <AcpModelSelector conversationId={conversation.id} backend='remote-agent' initialModelId={extra.currentModelId} />;
  //   }
  //   return undefined;
  // }, [conversation]);

  // 如果有预设助手信息，使用预设助手的 logo 和名称；加载中时不进入 fallback；否则使用 backend 的 logo
  // If preset assistant info exists, use preset logo/name; while loading, avoid fallback; otherwise use backend logo
  const chatLayoutProps = presetAssistantInfo
    ? {
        agentName: presetAssistantInfo.name,
        agentLogo: presetAssistantInfo.logo,
        agentLogoIsEmoji: presetAssistantInfo.isEmoji,
      }
    : isLoadingPreset
      ? {} // Still loading custom agents — avoid showing backend logo prematurely
      : {
          backend: conversation?.type === 'acp' ? conversation?.extra?.backend : conversation?.type === 'remote-agent' ? 'remote-agent' : undefined,
          agentName: (conversation?.extra as { agentName?: string })?.agentName,
        };

  return (
    <TaskPanelHeaderProvider>
      <ChatLayout title={conversation?.name} {...chatLayoutProps} sider={<ChatSider conversation={conversation} />} workspaceEnabled={workspaceEnabled}>
        {conversationNode}
      </ChatLayout>
    </TaskPanelHeaderProvider>
  );
};

export default ChatConversation;
