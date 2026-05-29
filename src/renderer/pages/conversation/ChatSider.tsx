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

  // Local conversations use local workspaces; remote-agent reads its workspace
  // from the Moss session API and may not have a local workspace path.
  if (conversation?.type === 'acp' && workspace) {
    workspaceNode = <ChatWorkspace conversation_id={conversation.id} workspace={workspace} workspaceDisplayName={extra.workspaceDisplayName} eventPrefix='acp' backend={extra.backend} messageApi={messageApi}></ChatWorkspace>;
  } else if (conversation?.type === 'openclaw-gateway' && workspace) {
    workspaceNode = <ChatWorkspace conversation_id={conversation.id} workspace={workspace} workspaceDisplayName={extra.workspaceDisplayName} eventPrefix='openclaw-gateway' backend='openclaw-gateway' messageApi={messageApi}></ChatWorkspace>;
  } else if (conversation?.type === 'remote-agent') {
    workspaceNode = <ChatWorkspace conversation_id={conversation.id} workspace={workspace || conversation.id} workspaceDisplayName={extra?.workspaceDisplayName} eventPrefix='remote-agent' backend='remote-agent' dataSource='moss-session' readonly messageApi={messageApi}></ChatWorkspace>;
  }

  return (
    <>
      {messageContext}
      {workspaceNode}
    </>
  );
};

export default ChatSider;
