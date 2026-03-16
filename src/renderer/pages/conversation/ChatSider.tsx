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
  if (conversation?.type === 'gemini') {
    workspaceNode = <ChatWorkspace conversation_id={conversation.id} workspace={conversation.extra.workspace} messageApi={messageApi}></ChatWorkspace>;
  } else if (conversation?.type === 'acp' && conversation.extra?.workspace) {
    workspaceNode = <ChatWorkspace conversation_id={conversation.id} workspace={conversation.extra.workspace} eventPrefix='acp' messageApi={messageApi}></ChatWorkspace>;
  } else if (conversation?.type === 'codex' && conversation.extra?.workspace) {
    workspaceNode = <ChatWorkspace conversation_id={conversation.id} workspace={conversation.extra.workspace} eventPrefix='codex' messageApi={messageApi}></ChatWorkspace>;
  }

  if (!workspaceNode) {
    // DEBUG: 显示调试信息
    const debugInfo = {
      conversationId: conversation?.id,
      type: conversation?.type,
      extra: conversation?.extra,
      hasWorkspace: !!(conversation?.extra as { workspace?: string })?.workspace,
    };
    return (
      <div style={{ padding: '12px', fontSize: '12px', color: 'var(--color-text-3)' }}>
        <button
          type='button'
          onClick={() => {
            console.log('[ChatSider DEBUG]', debugInfo);
            alert(JSON.stringify(debugInfo, null, 2));
          }}
          style={{
            padding: '4px 8px',
            fontSize: '11px',
            cursor: 'pointer',
            border: '1px solid var(--color-border-2)',
            borderRadius: '4px',
            background: 'var(--color-fill-2)',
            color: 'var(--color-text-2)',
            width: '100%',
          }}
        >
          🔍 Debug: 点击查看面板状态
        </button>
      </div>
    );
  }

  return (
    <>
      {messageContext}
      {workspaceNode}
    </>
  );
};

export default ChatSider;
