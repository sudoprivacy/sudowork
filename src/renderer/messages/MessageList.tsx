/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CodexToolCallUpdate, IMessageAcpToolCall, IMessageToolGroup, TMessage } from '@/common/chatLib';
import { useConversationContextSafe } from '@/renderer/context/ConversationContext';
import { iconColors } from '@/renderer/theme/colors';
import { CHAT_MESSAGE_JUMP_EVENT, type ChatMessageJumpDetail } from '@/renderer/utils/chatMinimapEvents';
import { Image, Message } from '@arco-design/web-react';
import { Down } from '@icon-park/react';
import MessageAcpPermission from '@renderer/messages/acp/MessageAcpPermission';
import MessageAcpToolCall from '@renderer/messages/acp/MessageAcpToolCall';
import MessageAgentStatus from '@renderer/messages/MessageAgentStatus';
import classNames from 'classnames';
import React, { createContext, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Virtuoso } from 'react-virtuoso';
import { uuid } from '../utils/common';
import HOC from '../utils/HOC';
import MessageCodexToolCall from './codex/MessageCodexToolCall';
import type { FileChangeInfo } from './codex/MessageFileChanges';
import MessageFileChanges, { parseDiff } from './codex/MessageFileChanges';
import { useMessageList } from './hooks';
import MessagePlan from './MessagePlan';
import MessageTips from './MessageTips';
import MessageToolCall from './MessageToolCall';
import MessageToolGroup from './MessageToolGroup';
import MessageToolGroupSummary from './MessageToolGroupSummary';
import MessageText from './MessagetText';
import TurnActions from './TurnActions';
import type { WriteFileResult } from './types';
import { useAutoScroll } from './useAutoScroll';
import ContextMenu, { type ContextMenuItem } from '@/renderer/components/ContextMenu';
import { copyText } from '@/renderer/utils/clipboard';
import { IconCopy } from '@arco-design/web-react/icon';
import { stripThinkTags, hasThinkTags } from '../utils/thinkTagFilter';
import { NEXUS_FILES_MARKER } from '@/common/constants';

type TurnDiffContent = Extract<CodexToolCallUpdate, { subtype: 'turn_diff' }>;

type IMessageVO =
  | TMessage
  | { type: 'file_summary'; id: string; diffs: FileChangeInfo[] }
  | {
      type: 'tool_summary';
      id: string;
      messages: Array<IMessageToolGroup | IMessageAcpToolCall>;
    }
  | { type: 'turn_actions'; id: string; turnTexts: string[]; conversationId?: string };

// Image preview context
export const ImagePreviewContext = createContext<{ inPreviewGroup: boolean }>({ inPreviewGroup: false });

const MessageItem: React.FC<{ message: TMessage }> = React.memo(
  HOC((props) => {
    const { message } = props as { message: TMessage };
    return (
      <div
        data-message-id={message.id}
        className={classNames('min-w-0 flex items-start message-item [&>div]:max-w-full px-8px m-t-10px max-w-full md:max-w-780px mx-auto', message.type, {
          'justify-center': message.position === 'center',
          'justify-end': message.position === 'right',
          'justify-start': message.position === 'left',
        })}
      >
        {props.children}
      </div>
    );
  })(({ message }) => {
    const { t } = useTranslation();
    switch (message.type) {
      case 'text':
        return <MessageText message={message}></MessageText>;
      case 'tips':
        return <MessageTips message={message}></MessageTips>;
      case 'tool_call':
        return <MessageToolCall message={message}></MessageToolCall>;
      case 'tool_group':
        return <MessageToolGroup message={message}></MessageToolGroup>;
      case 'agent_status':
        return <MessageAgentStatus message={message}></MessageAgentStatus>;
      case 'acp_permission':
        return <MessageAcpPermission message={message}></MessageAcpPermission>;
      case 'acp_tool_call':
        return <MessageAcpToolCall message={message}></MessageAcpToolCall>;
      case 'codex_permission':
        // Permission UI is now handled by ConversationChatConfirm component
        return null;
      case 'codex_tool_call':
        return <MessageCodexToolCall message={message}></MessageCodexToolCall>;
      case 'plan':
        return <MessagePlan message={message}></MessagePlan>;
      case 'available_commands':
        return null;
      default:
        return <div>{t('messages.unknownMessageType', { type: (message as any).type })}</div>;
    }
  }),
  (prev, next) => prev.message.id === next.message.id && prev.message.content === next.message.content && prev.message.position === next.message.position && prev.message.type === next.message.type
);

const MessageList: React.FC<{ className?: string }> = () => {
  const list = useMessageList();
  const conversationContext = useConversationContextSafe();
  const { t } = useTranslation();
  const [contextMenu, setContextMenu] = React.useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  // Track expanded/collapsed state for each tool_summary by id
  // 保存每个 tool_summary 的展开/折叠状态
  const [toolSummaryStates, setToolSummaryStates] = React.useState<Record<string, boolean>>({});

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const selection = window.getSelection()?.toString();
    const items: ContextMenuItem[] = [];

    if (selection && selection.trim()) {
      items.push({
        label: t('common.copySelection', { defaultValue: 'Copy Selection' }),
        icon: <IconCopy />,
        onClick: () => {
          copyText(selection)
            .then(() => {
              Message.success(t('common.copySuccess'));
            })
            .catch(() => {
              Message.error(t('common.copyFailed'));
            });
        },
      });
    } else {
      // Find nearest message
      let target = e.target as HTMLElement;
      let messageId: string | null = null;
      while (target && target !== e.currentTarget) {
        messageId = target.getAttribute('data-message-id');
        if (messageId) break;
        target = target.parentElement as HTMLElement;
      }

      if (messageId) {
        const messageObj = list.find((m) => m.id === messageId);
        if (messageObj) {
          items.push({
            label: t('common.copyMessage', { defaultValue: 'Copy Message' }),
            icon: <IconCopy />,
            onClick: () => {
              // Extract content from message based on its type
              let textToCopy = '';
              if (messageObj.type === 'text') {
                textToCopy = messageObj.content.content;
              } else {
                // For other types, maybe stringify content
                textToCopy = JSON.stringify(messageObj.content, null, 2);
              }
              copyText(textToCopy)
                .then(() => {
                  Message.success(t('common.copySuccess'));
                })
                .catch(() => {
                  Message.error(t('common.copyFailed'));
                });
            },
          });
        }
      }
    }

    if (items.length > 0) {
      setContextMenu({ x: e.clientX, y: e.clientY, items });
    }
  };

  // Pre-process message list to group Codex turn_diff messages and add turn-level copy actions
  const processedList = useMemo(() => {
    const result: Array<IMessageVO> = [];
    let diffsChanges: FileChangeInfo[] = [];
    let toolList: Array<IMessageToolGroup | IMessageAcpToolCall> = [];
    let turnTexts: string[] = [];
    let lastAiTextId = '';

    const flushTurnActions = () => {
      if (turnTexts.length > 0) {
        result.push({ type: 'turn_actions', id: `turn-actions-${lastAiTextId}`, turnTexts, conversationId: conversationContext?.conversationId });
        turnTexts = [];
        lastAiTextId = '';
      }
    };

    const pushFileDffChanges = (changes: FileChangeInfo) => {
      if (!diffsChanges.length) {
        result.push({ type: 'file_summary', id: `summary-${uuid()}`, diffs: diffsChanges });
      }
      diffsChanges.push(changes);
      toolList = [];
    };
    const pushToolList = (message: IMessageToolGroup | IMessageAcpToolCall) => {
      if (!toolList.length) {
        // Generate unique id for tool_summary using first message's id
        const firstMsg = message;
        const summaryId = firstMsg.type === 'tool_group' ? firstMsg.content[0]?.callId : firstMsg.content.update?.toolCallId || `tool-${uuid()}`;
        result.push({ type: 'tool_summary', id: `tool-summary-${summaryId}`, messages: toolList });
      }
      toolList.push(message);
      diffsChanges = [];
    };

    for (let i = 0, len = list.length; i < len; i++) {
      const message = list[i];
      // Skip available_commands messages
      if (message.type === 'available_commands') continue;
      // Hide agent_status badges from chat — shown via AgentStatusBanner instead
      if (message.type === 'agent_status') continue;
      // Hide gateway-disconnected tips from chat
      if (message.type === 'tips' && typeof message.content?.content === 'string' && message.content.content.startsWith('Gateway disconnected:')) continue;

      // Flush turn actions before a user message
      if (message.position === 'right') {
        flushTurnActions();
      }

      // Collect AI text content for turn-level copy
      if (message.type === 'text' && message.position === 'left') {
        const rawContent = message.content.content;
        if (typeof rawContent === 'string' && rawContent.trim()) {
          let cleaned = hasThinkTags(rawContent) ? stripThinkTags(rawContent) : rawContent;
          const markerIdx = cleaned.indexOf(NEXUS_FILES_MARKER);
          if (markerIdx !== -1) cleaned = cleaned.slice(0, markerIdx).trimEnd();
          cleaned = cleaned.replace(/!\[[^\]]*\]\(([^)]+)\)/g, '$1');
          if (cleaned.trim()) {
            turnTexts.push(cleaned);
            lastAiTextId = message.id;
          }
        }
      }

      if (message.type === 'codex_tool_call' && message.content.subtype === 'turn_diff') {
        pushFileDffChanges(parseDiff((message.content as TurnDiffContent).data.unified_diff));
        continue;
      }
      if (message.type === 'tool_group') {
        if (message.content.length === 1) {
          const writeFileResults = message.content.filter((item) => item.name === 'WriteFile' && item.resultDisplay && typeof item.resultDisplay === 'object' && 'fileDiff' in item.resultDisplay).map((item) => item.resultDisplay as WriteFileResult);
          if (writeFileResults.length && writeFileResults[0].fileDiff) {
            pushFileDffChanges(parseDiff(writeFileResults[0].fileDiff, writeFileResults[0].fileName));
            continue;
          }
        }
        pushToolList(message);
        continue;
      }
      if (message.type === 'acp_tool_call') {
        pushToolList(message);
        continue;
      }
      toolList = [];
      diffsChanges = [];
      result.push(message);
    }
    // Flush any remaining turn actions at the end
    flushTurnActions();
    return result;
  }, [list]);

  // Use auto-scroll hook
  const { virtuosoRef, handleScroll, handleAtBottomStateChange, handleFollowOutput, showScrollButton, scrollToBottom, hideScrollButton } = useAutoScroll({
    messages: list,
    itemCount: processedList.length,
  });

  useEffect(() => {
    const handleMessageJump = (event: Event) => {
      const detail = (event as CustomEvent<ChatMessageJumpDetail>).detail;
      if (!detail || !detail.conversationId) return;
      if (!conversationContext?.conversationId || detail.conversationId !== conversationContext.conversationId) return;

      const targetIndex = processedList.findIndex((item) => {
        if ((item as { type?: string }).type === 'file_summary' || (item as { type?: string }).type === 'tool_summary' || (item as { type?: string }).type === 'turn_actions') {
          return false;
        }
        const message = item as TMessage;
        if (detail.messageId && message.id === detail.messageId) return true;
        if (detail.msgId && message.msg_id === detail.msgId) return true;
        return false;
      });
      if (targetIndex < 0) return;

      hideScrollButton();
      requestAnimationFrame(() => {
        virtuosoRef.current?.scrollToIndex({
          index: targetIndex,
          align: detail.align || 'start',
          behavior: detail.behavior || 'smooth',
        });
      });
    };

    window.addEventListener(CHAT_MESSAGE_JUMP_EVENT, handleMessageJump);
    return () => {
      window.removeEventListener(CHAT_MESSAGE_JUMP_EVENT, handleMessageJump);
    };
  }, [conversationContext?.conversationId, hideScrollButton, processedList, virtuosoRef]);

  // Click scroll button
  const handleScrollButtonClick = () => {
    hideScrollButton();
    scrollToBottom('smooth');
  };

  const renderItem = (_index: number, item: (typeof processedList)[0]) => {
    if ('type' in item && ['file_summary', 'tool_summary'].includes(item.type)) {
      return (
        <div key={item.id} data-message-id={item.id} className={'min-w-0 message-item px-8px m-t-10px max-w-full md:max-w-780px mx-auto ' + item.type}>
          {item.type === 'file_summary' && <MessageFileChanges diffsChanges={item.diffs} />}
          {item.type === 'tool_summary' && (
            <MessageToolGroupSummary
              messages={item.messages}
              summaryId={item.id}
              isExpanded={toolSummaryStates[item.id] ?? false}
              onToggle={(id) => {
                setToolSummaryStates((prev) => ({ ...prev, [id]: !prev[id] }));
              }}
            />
          )}
        </div>
      );
    }
    if ('type' in item && item.type === 'turn_actions') {
      return (
        <div key={item.id} className='group min-w-0 message-item px-8px max-w-full md:max-w-780px mx-auto'>
          <TurnActions turnTexts={(item as Extract<IMessageVO, { type: 'turn_actions' }>).turnTexts} conversationId={(item as Extract<IMessageVO, { type: 'turn_actions' }>).conversationId} />
        </div>
      );
    }
    return <MessageItem message={item as TMessage} key={(item as TMessage).id}></MessageItem>;
  };

  return (
    <div className='relative flex-1 h-full' onContextMenu={handleContextMenu}>
      {/* Context Menu Rendering */}
      {contextMenu && <ContextMenu x={contextMenu.x} y={contextMenu.y} items={contextMenu.items} onClose={() => setContextMenu(null)} />}
      {/* Use PreviewGroup to wrap all messages for cross-message image preview */}
      <Image.PreviewGroup actionsLayout={['zoomIn', 'zoomOut', 'originalSize', 'rotateLeft', 'rotateRight']}>
        <ImagePreviewContext.Provider value={{ inPreviewGroup: true }}>
          <Virtuoso
            ref={virtuosoRef}
            className='flex-1 h-full pb-10px box-border'
            data={processedList}
            initialTopMostItemIndex={processedList.length - 1}
            atBottomThreshold={100}
            increaseViewportBy={200}
            itemContent={renderItem}
            followOutput={handleFollowOutput}
            onScroll={handleScroll}
            atBottomStateChange={handleAtBottomStateChange}
            components={{
              Header: () => <div className='h-10px' />,
              Footer: () => <div className='h-20px' />,
            }}
          />
        </ImagePreviewContext.Provider>
      </Image.PreviewGroup>

      {showScrollButton && (
        <>
          {/* Gradient mask */}
          <div className='absolute bottom-0 left-0 right-0 h-100px pointer-events-none' />
          {/* Scroll button */}
          <div className='absolute bottom-20px left-50% transform -translate-x-50% z-100'>
            <div className='flex items-center justify-center w-40px h-40px rd-full bg-base shadow-lg cursor-pointer hover:bg-1 transition-all hover:scale-110 border-1 border-solid border-3' onClick={handleScrollButtonClick} title={t('messages.scrollToBottom')} style={{ lineHeight: 0 }}>
              <Down theme='filled' size='20' fill={iconColors.secondary} style={{ display: 'block' }} />
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default MessageList;
