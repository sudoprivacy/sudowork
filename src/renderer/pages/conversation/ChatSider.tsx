/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/storage';
import { Message } from '@arco-design/web-react';
import React from 'react';
import ChatWorkspace from './workspace';

const ChatSider: React.FC<{
  conversation?: TChatConversation;
}> = ({ conversation }) => {
  const [messageApi, messageContext] = Message.useMessage({ maxCount: 1 });

  let workspaceNode: React.ReactNode = null;
  const extra = conversation?.extra as { workspace?: string; workspaceDisplayName?: string; backend?: string } | undefined;
  const workspace = extra?.workspace;

  // Show workspace for all conversation types that have workspace
  // 为所有有 workspace 的会话类型显示工作空间
  // NOTE: remote-agent type is temporarily disabled until Moss Server provides workspace management API
  // 注意：remote-agent 类型暂时禁用，等待 Moss Server 提供临时空间管理 API
  if (conversation?.type === 'acp' && workspace) {
    workspaceNode = <ChatWorkspace conversation_id={conversation.id} workspace={workspace} workspaceDisplayName={extra.workspaceDisplayName} eventPrefix='acp' backend={extra.backend} messageApi={messageApi}></ChatWorkspace>;
  } else if (conversation?.type === 'openclaw-gateway' && workspace) {
    workspaceNode = <ChatWorkspace conversation_id={conversation.id} workspace={workspace} workspaceDisplayName={extra.workspaceDisplayName} eventPrefix='openclaw-gateway' backend='openclaw-gateway' messageApi={messageApi}></ChatWorkspace>;
  }
  // remote-agent: temporarily disable workspace panel
  // // else if (conversation?.type === 'remote-agent' && workspace) {
  // //   workspaceNode = <ChatWorkspace conversation_id={conversation.id} workspace={workspace} workspaceDisplayName={extra.workspaceDisplayName} eventPrefix='acp' backend='remote-agent' messageApi={messageApi}></ChatWorkspace>;
  // // }

  return (
    <>
      {messageContext}
      {workspaceNode}
    </>
  );
};

export default ChatSider;