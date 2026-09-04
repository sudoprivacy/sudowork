/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IFileSendData, IResponseMessage, TMessage } from './chatTypes.js';
import { uuid } from './utils.js';

// The pure message/confirmation type surface (TMessage and its whole union tree,
// IConfirmation, AcpQuestionData, CodexToolCallUpdate, …) lives in @sudowork/common
// so main and the renderer share one definition. Re-exported here alongside the
// message transform/compose runtime, which stays app-side.
export * from '@sudowork/common/chatTypes';

/**
 * 安全的路径拼接函数，兼容Windows和Mac
 * @param basePath 基础路径
 * @param relativePath 相对路径
 * @returns 拼接后的绝对路径
 */
export const joinPath = (basePath: string, relativePath: string): string => {
  // 标准化路径分隔符为 /
  const normalizePath = (path: string) => path.replace(/\\/g, '/');

  const base = normalizePath(basePath);
  const relative = normalizePath(relativePath);

  // 去掉base路径末尾的斜杠
  const cleanBase = base.replace(/\/+$/, '');

  // 处理相对路径中的 ./ 和 ../
  const parts = relative.split('/');
  const resultParts = [];

  for (const part of parts) {
    if (part === '.' || part === '') {
      continue; // 跳过 . 和空字符串
    } else if (part === '..') {
      // 处理上级目录
      if (resultParts.length > 0) {
        resultParts.pop(); // 移除最后一个部分
      }
    } else {
      resultParts.push(part);
    }
  }

  // 拼接路径
  const result = cleanBase + '/' + resultParts.join('/');

  // 确保路径格式正确
  return result.replace(/\/+/g, '/'); // 将多个连续的斜杠替换为单个
};

/**
 * @description 将后端返回的消息转换为前端消息
 * */
export const transformMessage = (message: IResponseMessage): TMessage => {
  switch (message.type) {
    case 'error': {
      return {
        id: uuid(),
        type: 'tips',
        msg_id: message.msg_id,
        // Position: 'left' to show AI avatar on the left side (consistent with assistant messages)
        // Position: 'left' 以在左侧显示 AI 头像（与 assistant 消息保持一致）
        position: 'left',
        conversation_id: message.conversation_id,
        content: {
          content: message.data as string,
          type: 'error',
        },
      };
    }
    case 'content':
    case 'user_content': {
      const data = message.data;
      const isRichData = typeof data === 'object' && data !== null && 'content' in data;
      return {
        id: uuid(),
        type: 'text',
        msg_id: message.msg_id,
        position: message.type === 'content' ? 'left' : 'right',
        conversation_id: message.conversation_id,
        content: isRichData
          ? {
              content: (data as any).content,
              ...((data as any).cronMeta ? { cronMeta: (data as any).cronMeta } : {}),
              ...((data as any).skills ? { skills: (data as any).skills } : {}),
              ...((data as any).tokenUsage ? { tokenUsage: (data as any).tokenUsage } : {}),
            }
          : { content: data as string },
      };
    }
    case 'tool_call': {
      return {
        id: uuid(),
        type: 'tool_call',
        msg_id: message.msg_id,
        conversation_id: message.conversation_id,
        position: 'left',
        content: message.data as any,
      };
    }
    case 'tool_group': {
      return {
        type: 'tool_group',
        id: uuid(),
        msg_id: message.msg_id,
        conversation_id: message.conversation_id,
        content: message.data as any,
      };
    }
    case 'agent_status': {
      return {
        id: uuid(),
        type: 'agent_status',
        msg_id: message.msg_id,
        position: 'center',
        conversation_id: message.conversation_id,
        content: message.data as any,
      };
    }
    case 'acp_permission': {
      return {
        id: uuid(),
        type: 'acp_permission',
        msg_id: message.msg_id,
        position: 'left',
        conversation_id: message.conversation_id,
        content: message.data as any,
      };
    }
    case 'acp_question': {
      return {
        id: uuid(),
        type: 'acp_question',
        msg_id: message.msg_id,
        position: 'left',
        conversation_id: message.conversation_id,
        content: {
          ...(message.data as Record<string, unknown>),
          conversationId: (message.data as { conversationId?: string }).conversationId || message.conversation_id,
        } as any,
      };
    }
    case 'acp_tool_call': {
      return {
        id: uuid(),
        type: 'acp_tool_call',
        msg_id: message.msg_id,
        position: 'left',
        conversation_id: message.conversation_id,
        content: message.data as any,
      };
    }
    case 'codex_permission': {
      return {
        id: uuid(),
        type: 'codex_permission',
        msg_id: message.msg_id,
        position: 'left',
        conversation_id: message.conversation_id,
        content: message.data as any,
      };
    }
    case 'codex_tool_call': {
      return {
        id: uuid(),
        type: 'codex_tool_call',
        msg_id: message.msg_id,
        position: 'left',
        conversation_id: message.conversation_id,
        content: message.data as any,
      };
    }
    case 'plan': {
      return {
        id: uuid(),
        type: 'plan',
        msg_id: message.msg_id,
        position: 'left',
        conversation_id: message.conversation_id,
        content: message.data as any,
      };
    }
    case 'file_send': {
      return {
        id: uuid(),
        type: 'file_send',
        msg_id: message.msg_id,
        position: 'left',
        conversation_id: message.conversation_id,
        content: message.data as IFileSendData,
      };
    }
    case 'tips': {
      const data = message.data as { type?: string; content: string };
      return {
        id: uuid(),
        type: 'tips',
        msg_id: message.msg_id,
        position: 'center',
        conversation_id: message.conversation_id,
        content: {
          content: data.content,
          type: (data.type || 'warning') as 'error' | 'success' | 'warning',
        },
      };
    }
    case 'thought': {
      const data = message.data as { subject?: string; description?: string } | null;
      if (!data?.description?.trim()) break;
      return {
        id: uuid(),
        type: 'thought',
        msg_id: message.msg_id,
        position: 'left',
        conversation_id: message.conversation_id,
        content: {
          subject: data.subject || '',
          description: data.description,
        },
      };
    }
    // Disabled: available_commands messages are too noisy and distracting in the chat UI
    case 'available_commands':
      break;
    case 'start':
    case 'finish':
    case 'system': // Cron system responses, ignored
    case 'acp_model_info': // Model info updates, handled by AcpModelSelector
    case 'codex_model_info': // Codex model info updates, handled by AcpModelSelector
    case 'acp_context_usage': // Context usage updates, handled by AcpSendBox
    case 'request_trace': // Request trace events, logged to F12 console (not persisted)
      break;
    default: {
      throw new Error(`Unsupported message type '${message.type}'. All non-standard message types should be pre-processed by respective AgentManagers.`);
    }
  }
};

/**
 * @description 将消息合并到消息列表中
 * */
export const composeMessage = (message: TMessage | undefined, list: TMessage[] | undefined, messageHandler: (type: 'update' | 'insert', message: TMessage) => void = () => {}): TMessage[] => {
  if (!message) return list || [];
  if (!list?.length) {
    messageHandler('insert', message);
    return [message];
  }
  const last = list[list.length - 1];

  const updateMessage = (index: number, message: TMessage, change = true) => {
    message.id = list[index].id;
    list[index] = message;
    if (change) messageHandler('update', message);
    return list.slice();
  };
  const pushMessage = (message: TMessage) => {
    list.push(message);
    messageHandler('insert', message);
    return list.slice();
  };

  if (message.type === 'tool_group') {
    const remainingToolsMap = new Map(message.content.map((t) => [t.callId, t] as const));
    if (remainingToolsMap.size === 0) return list;

    const updatesToReport: TMessage[] = [];

    const updatedList = list.map((existingMessage) => {
      if (existingMessage.type !== 'tool_group') return existingMessage;
      if (!existingMessage.content.length) return existingMessage;

      let didMergeIntoThisMessage = false;
      const newContent = existingMessage.content.map((tool) => {
        const newToolData = remainingToolsMap.get(tool.callId);
        if (!newToolData) return tool;
        didMergeIntoThisMessage = true;
        remainingToolsMap.delete(tool.callId);
        // Create new object instead of mutating original
        return { ...tool, ...newToolData };
      });

      if (!didMergeIntoThisMessage) return existingMessage;
      const updatedMessage = { ...existingMessage, content: newContent } as TMessage;
      updatesToReport.push(updatedMessage);
      return updatedMessage;
    });

    const didUpdateExisting = updatesToReport.length > 0;
    for (const updatedMessage of updatesToReport) {
      messageHandler('update', updatedMessage);
    }

    const baseList = didUpdateExisting ? updatedList : list;

    // If there are new tool calls, append them as a new tool_group message (without mutating inputs)
    if (remainingToolsMap.size > 0) {
      const newTools = Array.from(remainingToolsMap.values());
      const insertMessage = { ...message, content: newTools } as TMessage;
      messageHandler('insert', insertMessage);
      return baseList.concat(insertMessage);
    }
    // No new tools appended; return a new list only if something was updated
    return didUpdateExisting ? baseList : list;
  }

  // Handle Gemini tool_call message merging
  if (message.type === 'tool_call') {
    for (let i = 0, len = list.length; i < len; i++) {
      const msg = list[i];
      if (msg.type === 'tool_call' && msg.content.callId === message.content.callId) {
        // Create new object instead of mutating original
        return updateMessage(i, { ...msg, content: { ...msg.content, ...message.content } });
      }
    }
    // If no existing tool call found, add new one
    return pushMessage(message);
  }

  // Handle tips message merging by msg_id so transient status prompts can be updated in place
  if (message.type === 'tips' && message.msg_id) {
    for (let i = 0, len = list.length; i < len; i++) {
      const msg = list[i];
      if (msg.type === 'tips' && msg.msg_id === message.msg_id) {
        return updateMessage(i, { ...msg, ...message, content: { ...msg.content, ...message.content } });
      }
    }
    return pushMessage(message);
  }

  // Thought emissions carry the full accumulated reasoning text for a block,
  // so merge by msg_id replacing content in place (not appending)
  if (message.type === 'thought' && message.msg_id) {
    for (let i = 0, len = list.length; i < len; i++) {
      const msg = list[i];
      if (msg.type === 'thought' && msg.msg_id === message.msg_id) {
        return updateMessage(i, { ...msg, ...message, content: message.content });
      }
    }
    return pushMessage(message);
  }

  // Handle codex_tool_call message merging
  if (message.type === 'codex_tool_call') {
    for (let i = 0, len = list.length; i < len; i++) {
      const msg = list[i];
      if (msg.type === 'codex_tool_call' && msg.content.toolCallId === message.content.toolCallId) {
        // Create new object instead of mutating original
        const merged = { ...msg.content, ...message.content };
        return updateMessage(i, { ...msg, content: merged });
      }
    }
    // If no existing tool call found, add new one
    return pushMessage(message);
  }

  // Handle acp_question message merging by msg_id so cancel/timeout updates patch the original card
  if (message.type === 'acp_question' && message.msg_id) {
    for (let i = 0, len = list.length; i < len; i++) {
      const msg = list[i];
      if (msg.type === 'acp_question' && msg.msg_id === message.msg_id) {
        const merged = { ...msg.content, ...message.content };
        return updateMessage(i, { ...msg, content: merged });
      }
    }
    return pushMessage(message);
  }

  // Handle acp_tool_call message merging (same logic as codex_tool_call)
  if (message.type === 'acp_tool_call') {
    for (let i = 0, len = list.length; i < len; i++) {
      const msg = list[i];
      if (msg.type === 'acp_tool_call' && msg.content.update?.toolCallId === message.content.update?.toolCallId) {
        // Preserve previously streamed fields inside `update` so a completion
        // packet that only contains status/content does not wipe rawInput/title.
        const merged = {
          ...msg.content,
          ...message.content,
          update: {
            ...msg.content.update,
            ...message.content.update,
            rawInput: message.content.update?.rawInput ?? msg.content.update?.rawInput,
            content: message.content.update?.content ?? msg.content.update?.content,
          },
        };
        return updateMessage(i, { ...msg, content: merged });
      }
    }
    // If no existing tool call found, add new one
    return pushMessage(message);
  }

  if (message.type === 'plan') {
    for (let i = 0, len = list.length; i < len; i++) {
      const msg = list[i];
      if (msg.type === 'plan' && msg.content.sessionId === message.content.sessionId) {
        // Create new object instead of mutating original
        const merged = { ...msg.content, ...message.content };
        return updateMessage(i, { ...msg, content: merged });
      }
    }
    return pushMessage(message);
    // If no existing plan found, add new one
  }

  if (last.msg_id !== message.msg_id || last.type !== message.type) {
    return pushMessage(message);
  }
  if (message.type === 'text' && last.type === 'text') {
    message.content = {
      ...last.content,
      ...message.content,
      content: last.content.content + message.content.content,
    };
  }
  return updateMessage(list.length - 1, Object.assign({}, last, message));
};

export const handleImageGenerationWithWorkspace = (message: TMessage, workspace: string): TMessage => {
  // 只处理text类型的消息
  if (message.type !== 'text') {
    return message;
  }

  // 深拷贝消息以避免修改原始对象
  const processedMessage = {
    ...message,
    content: {
      ...message.content,
      content: message.content.content.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, imagePath) => {
        // 如果是绝对路径、http链接或data URL，保持不变（但需要处理Windows路径的反斜杠）
        if (imagePath.startsWith('http') || imagePath.startsWith('data:') || imagePath.startsWith('file:')) {
          return match;
        }
        // Windows 绝对路径：标准化反斜杠为正斜杠
        // 同时去除 Windows 扩展长度路径前缀 \\?\
        if (/^[A-Za-z]:/.test(imagePath) || imagePath.startsWith('\\')) {
          const cleanPath = imagePath.replace(/^\\\\\?\\/, '');
          const normalizedPath = cleanPath.replace(/\\/g, '/');
          return `![${alt}](${normalizedPath})`;
        }
        // Unix 绝对路径，保持不变
        if (imagePath.startsWith('/')) {
          return match;
        }
        // 如果是相对路径，与workspace拼接
        const absolutePath = joinPath(workspace, imagePath);
        return `![${alt}](${encodeURI(absolutePath)})`;
      }),
    },
  };

  return processedMessage;
};
