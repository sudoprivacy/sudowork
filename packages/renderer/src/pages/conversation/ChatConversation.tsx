/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Dropdown, Menu, Tooltip, Typography } from '@arco-design/web-react';
import { History } from '@icon-park/react';
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import { uuid } from '@sudowork/common/utils';
import type { TChatConversation } from '@sudowork/common/storage';
import { resolveConversationExecutionTarget } from '@sudowork/common/mossExecution';
import { isPersonalAgentRef } from '@sudowork/common/personalAgents';
import * as ipcBridge from '@sudowork/host-bridge/ipcBridge';
import AgentStatusDot from '@renderer/components/AgentStatusBanner';
import AcpModelSelector from '@renderer/components/AcpModelSelector';
import { usePresetAssistantInfo } from '@renderer/hooks/usePresetAssistantInfo';
import addChatIcon from '@renderer/assets/add-chat.svg';
import { emitter } from '../../utils/emitter';
import { TaskPanelHeaderProvider } from './workspace/TaskPanelHeaderContext';
import ChatSider from './ChatSider';
import ChatLayout from './ChatLayout';
import AcpChat from './acp/AcpChat';
import { useConversationHistory } from './context/ConversationHistoryContext';
import { getConversationAgentName, getConversationAgentRef } from './utils/agentIdentity';

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
      <Button size='mini' icon={<History theme='filled' size='14' fill={'var(--foreground)'} strokeWidth={2} strokeLinejoin='miter' strokeLinecap='square' />}></Button>
    </Dropdown>
  );
};

const _AddNewConversation: React.FC<{ conversation: TChatConversation }> = ({ conversation }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  if (!conversation.extra?.workspace) return null;
  return (
    <Tooltip content={t('conversation.workspace.createNewConversation')}>
      <Button
        size='mini'
        icon={<img src={addChatIcon} alt='Add chat' className='w-14px h-14px block m-auto' />}
        onClick={async () => {
          const id = uuid();
          // Fetch latest conversation from DB to ensure sessionMode is current
          const latest = await ipcBridge.conversation.get.invoke({ id: conversation.id }).catch((): null => null);
          const source = latest || conversation;
          ipcBridge.conversation.createWithConversation
            .invoke({
              conversation: {
                ...source,
                id,
                createTime: Date.now(),
                modifyTime: Date.now(),
                // Clear ACP session fields to prevent new conversation from inheriting old session context
                extra: source.type === 'acp' ? { ...source.extra, acpSessionId: undefined, acpSessionUpdatedAt: undefined } : source.extra,
              } as TChatConversation,
            })
            .then(() => {
              Promise.resolve(navigate(`/conversation/${id}`)).catch((error) => {
                console.error('Navigation failed:', error);
              });
              emitter.emit('chat.history.refresh');
            })
            .catch((error) => {
              console.error('Failed to create conversation:', error);
            });
        }}
      />
    </Tooltip>
  );
};

function ChatConversation({ conversation, conversationId = conversation?.id, children }: IChatConversationProps) {
  const { t } = useTranslation();
  const { agents } = useConversationHistory();
  // Remote-agent workspaces are loaded from Moss Server, so they may not have a
  // local workspace path in conversation.extra.
  const workspaceEnabled = Boolean(conversation && (conversation.type === 'remote-agent' || conversation.extra?.workspace));

  // 使用统一的 Hook 获取预设助手信息（ACP 会话）
  // Use unified hook for preset assistant info (ACP conversations)
  const { info: presetAssistantInfo } = usePresetAssistantInfo(conversation);

  const resolvedAgentName = useMemo(() => {
    if (presetAssistantInfo?.name) return presetAssistantInfo.name;
    if (!conversation) return undefined;
    const listedReferences = new Set(agents.map((agent) => agent.ref));
    const reference = getConversationAgentRef(conversation, listedReferences);
    const fallback = reference && isPersonalAgentRef(reference) ? t('conversation.sidebar.myAgent') : '';
    return getConversationAgentName(conversation, agents, fallback) || undefined;
  }, [agents, conversation, presetAssistantInfo?.name, t]);

  const conversationNode = useMemo(() => {
    if (!conversation) return null;
    switch (conversation.type) {
      case 'acp':
        return <AcpChat key={conversation.id} conversation_id={conversation.id} workspace={conversation.extra?.workspace} backend={conversation.extra?.backend || 'claude'} sessionMode={conversation.extra?.sessionMode} agentName={resolvedAgentName}></AcpChat>;
      case 'remote-agent': {
        // Remote-agent uses AcpChat with backend='remote-agent' (handled by conversationBridge.sendMessage)
        const permissionMode = conversation.extra?.dangerouslySkipPermissions === true || conversation.extra?.sessionMode === 'yolo' ? 'yolo' : 'default';
        return <AcpChat key={conversation.id} conversation_id={conversation.id} workspace={conversation.extra?.workspace} backend={'remote-agent'} sessionMode={permissionMode} agentName={resolvedAgentName || 'Moss Server'}></AcpChat>;
      }
      default:
        return null;
    }
  }, [conversation, resolvedAgentName]);

  const modelSelector = useMemo(() => {
    if (!conversation) return undefined;
    if (conversation.type === 'acp') {
      const extra = conversation.extra as { backend?: string; currentModelId?: string };
      return <AcpModelSelector conversationId={conversation.id} backend={extra.backend} initialModelId={extra.currentModelId} labelPrefix={t('conversation.header.model')} />;
    }
    if (conversation.type === 'remote-agent') {
      const extra = conversation.extra as { currentModelId?: string };
      return <AcpModelSelector conversationId={conversation.id} backend='remote-agent' initialModelId={extra.currentModelId} labelPrefix={t('conversation.header.model')} />;
    }
    return undefined;
  }, [conversation, t]);

  const executionTarget = conversation ? resolveConversationExecutionTarget(conversation) : undefined;
  const headerExtraNode = <div className='flex items-center gap-8px'>{conversation && <AgentStatusDot conversation_id={conversation.id} conversationType={conversation.type} showLabel />}</div>;

  return (
    <TaskPanelHeaderProvider>
      <ChatLayout title={conversation?.name} headerLeft={modelSelector} headerExtra={headerExtraNode} sider={<ChatSider conversation={conversation} />} workspaceEnabled={workspaceEnabled} conversationId={conversationId} executionTarget={executionTarget}>
        {children ?? conversationNode}
      </ChatLayout>
    </TaskPanelHeaderProvider>
  );
}

interface IChatConversationProps {
  conversation?: TChatConversation;
  conversationId?: string;
  children?: React.ReactNode;
}

export default ChatConversation;
