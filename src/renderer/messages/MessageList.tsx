/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Image, Message } from '@arco-design/web-react';
import { ChevronDown as Down } from 'lucide-react';
import classNames from 'classnames';
import React, { createContext, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Virtuoso } from 'react-virtuoso';
import { IconCopy } from '@arco-design/web-react/icon';
import type { CodexToolCallUpdate, IMessageAcpToolCall, IMessageToolGroup, TMessage, TurnTokenUsage } from '@/common/chatLib';
import { ipcBridge } from '@/common';
import { useConversationContextSafe } from '@/renderer/context/ConversationContext';
import MessageAcpPermission from '@renderer/messages/acp/MessageAcpPermission';
import MessageAcpQuestion from '@renderer/messages/acp/MessageAcpQuestion';
import MessageAcpToolCall from '@renderer/messages/acp/MessageAcpToolCall';
import MessageAgentStatus from '@renderer/messages/MessageAgentStatus';
import ContextMenu, { type ContextMenuItem } from '@/renderer/components/ContextMenu';
import { copyText } from '@/renderer/utils/clipboard';
import { NEXUS_FILES_MARKER } from '@/common/constants';
import { useShowToolCalls } from '@/renderer/hooks/useShowToolCalls';
import { shouldShowTimeSeparator } from '@/renderer/utils/messageTime';
import { uuid } from '../utils';
import HOC from '../utils/HOC';
import { stripThinkTags, hasThinkTags } from '../utils/thinkTagFilter';
import MessageCodexToolCall from './codex/MessageCodexToolCall';
import type { FileChangeInfo } from './codex/MessageFileChanges';
import MessageFileChanges, { parseDiff } from './codex/MessageFileChanges';
import MessageFileSend from './MessageFileSend';
import { useMessageList } from './hooks';
import MessagePlan from './MessagePlan';
import MessageThought from './MessageThought';
import MessageTips from './MessageTips';
import MessageToolCall from './MessageToolCall';
import MessageToolGroup from './MessageToolGroup';
import MessageToolGroupSummary from './MessageToolGroupSummary';
import MessageText from './MessagetText';
import TurnActions from './TurnActions';
import type { WriteFileResult } from './types';
import { BOTTOM_BUFFER_PX, useAutoScroll } from './useAutoScroll';
import MessageTimeSeparator from './MessageTimeSeparator';
import MessageLoadingIndicator from './MessageLoadingIndicator';

type TurnDiffContent = Extract<CodexToolCallUpdate, { subtype: 'turn_diff' }>;

type IMessageVO =
  | TMessage
  | { type: 'file_summary'; id: string; diffs: FileChangeInfo[] }
  | {
      type: 'tool_summary';
      id: string;
      messages: Array<IMessageToolGroup | IMessageAcpToolCall>;
    }
  | { type: 'turn_actions'; id: string; turnTexts: string[]; turnTextsRaw: string[]; conversationId?: string; tokenUsage?: TurnTokenUsage }
  | { type: 'time_separator'; id: string; timestamp: number }
  | { type: 'loading_indicator'; id: string };

// Image preview context
export const ImagePreviewContext = createContext<{ inPreviewGroup: boolean }>({ inPreviewGroup: false });

const isUserFacingAcpToolCall = (message: IMessageAcpToolCall): boolean => {
  const title = message.content?.update?.title;
  return title === 'AskUserQuestion' || title === 'SendUserMessage';
};

interface IMessageQuestionCallbacks {
  onTeamAnswerQuestion?: (params: { conversationId: string; toolCallId: string; answers: Array<{ id: string; value: string; label?: string }> }) => Promise<{ success: boolean; msg?: string } | void>;
  onTeamQuestionFallbackSend?: (params: { input: string; msg_id: string }) => Promise<{ success: boolean; msg?: string } | void>;
}

const MessageItem: React.FC<{ message: TMessage; isStreaming?: boolean; footer?: React.ReactNode } & IMessageQuestionCallbacks> = React.memo(
  HOC((props) => {
    const { message } = props as { message: TMessage; footer?: React.ReactNode } & IMessageQuestionCallbacks;
    const isAiMessage = message.position === 'left';

    return (
      <div
        data-message-id={message.id}
        className={classNames('min-w-0 flex w-full box-border message-item [&>div]:max-w-full m-t-10px max-w-full md:max-w-800px mx-auto group', message.type, {
          'items-start': !isAiMessage,
          'justify-center': message.position === 'center',
          'justify-end': message.position === 'right',
          'justify-start': message.position === 'left',
        })}
      >
        <div className={classNames('min-w-0', isAiMessage ? 'w-full' : 'flex-none w-fit')}>{props.children}</div>
      </div>
    );
  })(function MessageItemContent({ message, isStreaming, footer, onTeamAnswerQuestion, onTeamQuestionFallbackSend }) {
    const { t } = useTranslation();
    switch (message.type) {
      case 'text':
        return <MessageText message={message} isStreaming={isStreaming} footer={footer}></MessageText>;
      case 'tips':
        return <MessageTips message={message}></MessageTips>;
      case 'thought':
        return <MessageThought message={message}></MessageThought>;
      case 'tool_call':
        return <MessageToolCall message={message}></MessageToolCall>;
      case 'tool_group':
        return <MessageToolGroup message={message}></MessageToolGroup>;
      case 'agent_status':
        return <MessageAgentStatus message={message}></MessageAgentStatus>;
      case 'acp_permission':
        return <MessageAcpPermission message={message}></MessageAcpPermission>;
      case 'acp_question':
        return <MessageAcpQuestion message={message} onTeamAnswerQuestion={onTeamAnswerQuestion} onTeamQuestionFallbackSend={onTeamQuestionFallbackSend}></MessageAcpQuestion>;
      case 'acp_tool_call':
        return <MessageAcpToolCall message={message}></MessageAcpToolCall>;
      case 'codex_permission':
        // Permission UI is now handled by ConversationChatConfirm component
        return null;
      case 'codex_tool_call':
        return <MessageCodexToolCall message={message}></MessageCodexToolCall>;
      case 'plan':
        return <MessagePlan message={message}></MessagePlan>;
      case 'file_send':
        return <MessageFileSend message={message}></MessageFileSend>;
      case 'available_commands':
        return null;
      default:
        return <div>{t('messages.unknownMessageType', { type: (message as any).type })}</div>;
    }
  }),
  (prev, next) =>
    prev.message.id === next.message.id &&
    prev.message.content === next.message.content &&
    prev.message.position === next.message.position &&
    prev.message.type === next.message.type &&
    prev.isStreaming === next.isStreaming &&
    prev.onTeamAnswerQuestion === next.onTeamAnswerQuestion &&
    prev.onTeamQuestionFallbackSend === next.onTeamQuestionFallbackSend
);

interface IMessageListProps extends IMessageQuestionCallbacks {
  className?: string;
  aiProcessing?: boolean; // AI processing state
  emptyState?: React.ReactNode;
  isEmptyStateReady?: boolean;
}

const MessageList: React.FC<IMessageListProps> = ({ className, aiProcessing = false, emptyState, isEmptyStateReady = false, onTeamAnswerQuestion, onTeamQuestionFallbackSend }) => {
  const list = useMessageList();
  const conversationContext = useConversationContextSafe();
  const { t } = useTranslation();
  const [contextMenu, setContextMenu] = React.useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const [showTokenUsageBadges, setShowTokenUsageBadges] = React.useState(false);
  const showToolCalls = useShowToolCalls();
  // Track expanded/collapsed state for each tool_summary by id
  // 保存每个 tool_summary 的展开/折叠状态
  const [toolSummaryStates, setToolSummaryStates] = React.useState<Record<string, boolean>>({});

  useEffect(() => {
    void ipcBridge.systemSettings.getShowTokenUsageBadges
      .invoke()
      .then(setShowTokenUsageBadges)
      .catch(() => {});
    return ipcBridge.systemSettings.showTokenUsageBadgesChanged.on(({ enabled }) => {
      setShowTokenUsageBadges(enabled);
    });
  }, []);

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
                // For text messages, extract only the text content (exclude files, skills, etc.)
                let rawContent = messageObj.content.content;
                // Strip think tags if present
                if (typeof rawContent === 'string' && hasThinkTags(rawContent)) {
                  rawContent = stripThinkTags(rawContent);
                }
                // Strip file marker and file list
                if (typeof rawContent === 'string') {
                  const markerIdx = rawContent.indexOf(NEXUS_FILES_MARKER);
                  if (markerIdx !== -1) {
                    rawContent = rawContent.slice(0, markerIdx).trimEnd();
                  }
                  // Strip markdown image syntax ![alt](path) → path
                  rawContent = rawContent.replace(/!\[[^\]]*\]\(([^)]+)\)/g, '$1');
                }
                textToCopy = rawContent;
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

  // Find the last AI text message for streaming effect
  // Only highlight if it's the most recent message (no user messages after it)
  // 找到最后一条正在流式的 AI 文本消息
  // 只有当它是最新的消息（后面没有用户消息）时才闪烁
  const lastAiMessageId = React.useMemo(() => {
    if (!aiProcessing) return null;

    let lastAiId: string | null = null;
    let hasUserMessageAfter = false;

    // Iterate from end to find the last AI message and check if there's a user message after it
    // 从后向前遍历，找到最后一条 AI 消息并检查后面是否有用户消息
    for (let i = list.length - 1; i >= 0; i--) {
      const msg = list[i];
      if (msg.position === 'right') {
        // Found a user message
        hasUserMessageAfter = true;
      } else if (msg.type === 'text' && msg.position === 'left' && !hasUserMessageAfter) {
        // Found an AI message with no user messages after it
        lastAiId = msg.id;
        break;
      }
    }

    return lastAiId;
  }, [list, aiProcessing]);

  // Pre-process message list to group Codex turn_diff messages and add turn-level copy actions
  const processedList = useMemo(() => {
    const result: Array<IMessageVO> = [];
    let diffsChanges: FileChangeInfo[] = [];
    let toolList: Array<IMessageToolGroup | IMessageAcpToolCall> = [];
    let turnTexts: string[] = [];
    let turnTextsRaw: string[] = [];
    let turnTokenUsage: TurnTokenUsage | undefined;
    let lastAiTextId = '';

    const flushTurnActions = () => {
      if (turnTexts.length > 0) {
        result.push({ type: 'turn_actions', id: `turn-actions-${lastAiTextId}`, turnTexts, turnTextsRaw, conversationId: conversationContext?.conversationId, tokenUsage: turnTokenUsage });
        turnTexts = [];
        turnTextsRaw = [];
        turnTokenUsage = undefined;
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
      // Hide transient Sudoclaw recovery tip from chat after the reconnecting banner is cleared
      if (message.type === 'tips' && message.content?.content === '已连接到 Sudoclaw') continue;

      // Flush turn actions before a user message
      if (message.position === 'right') {
        flushTurnActions();
      }

      // Collect AI text content for turn-level copy
      if (message.type === 'text' && message.position === 'left') {
        const rawContent = message.content.content;
        if (message.content.tokenUsage) {
          turnTokenUsage = message.content.tokenUsage;
        }
        if (typeof rawContent === 'string' && rawContent.trim()) {
          let cleaned = hasThinkTags(rawContent) ? stripThinkTags(rawContent) : rawContent;
          const markerIdx = cleaned.indexOf(NEXUS_FILES_MARKER);
          if (markerIdx !== -1) cleaned = cleaned.slice(0, markerIdx).trimEnd();
          // Keep raw markdown with images for sharing
          const rawCleaned = cleaned;
          // Strip image syntax for plain text copy
          cleaned = cleaned.replace(/!\[[^\]]*\]\(([^)]+)\)/g, '$1');
          if (cleaned.trim()) {
            turnTexts.push(cleaned);
            turnTextsRaw.push(rawCleaned);
            lastAiTextId = message.id;
          }
        }
      }

      if (message.type === 'codex_tool_call' && message.content.subtype === 'turn_diff') {
        pushFileDffChanges(parseDiff((message.content as TurnDiffContent).data.unified_diff));
        continue;
      }
      // 关闭"显示工具调用"时隐藏工具消息（文件变更摘要与用户交互消息保留）
      // Hide tool messages when "show tool calls" is off (file-change summaries
      // and user-facing prompts stay visible)
      if (!showToolCalls && (message.type === 'tool_call' || message.type === 'codex_tool_call')) {
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
        if (!showToolCalls) continue;
        pushToolList(message);
        continue;
      }
      if (message.type === 'acp_tool_call') {
        if (isUserFacingAcpToolCall(message)) {
          toolList = [];
          diffsChanges = [];
          continue;
        }
        if (!showToolCalls) continue;
        pushToolList(message);
        continue;
      }
      toolList = [];
      diffsChanges = [];
      result.push(message);
    }
    // Only expose turn actions after the AI stream finishes.
    if (!aiProcessing) {
      flushTurnActions();
    }

    // Insert time separators between messages with significant time gaps
    // 在时间间隔较大的消息之间插入时间分隔符
    const withTimeSeparators: Array<IMessageVO> = [];
    let prevTimestamp: number | undefined;

    for (const item of result) {
      // Get timestamp from TMessage items (they have createdAt)
      const currentTimestamp = 'createdAt' in item ? (item as TMessage).createdAt : undefined;

      if (currentTimestamp && shouldShowTimeSeparator(prevTimestamp, currentTimestamp)) {
        withTimeSeparators.push({
          type: 'time_separator',
          id: `time-sep-${currentTimestamp}`,
          timestamp: currentTimestamp,
        });
      }

      withTimeSeparators.push(item);

      if (currentTimestamp) {
        prevTimestamp = currentTimestamp;
      }
    }

    const shouldShowLoading = aiProcessing && list.length > 0;
    if (shouldShowLoading) {
      withTimeSeparators.push({
        type: 'loading_indicator',
        id: 'temp-loading-indicator',
      });
    }

    return withTimeSeparators;
  }, [list, aiProcessing, showToolCalls, conversationContext?.conversationId]);

  const isShowingEmptyState = Boolean(isEmptyStateReady && emptyState && processedList.length === 0 && !aiProcessing);

  // Use auto-scroll hook
  const { virtuosoRef, handleScroll, handleAtBottomStateChange, handleFollowOutput, handleScrollerRef, showScrollButton, scrollToBottom, hideScrollButton, bottomSpacerHeight } = useAutoScroll({
    messages: list,
    items: processedList,
  });

  // Click scroll button
  const handleScrollButtonClick = () => {
    hideScrollButton();
    scrollToBottom('smooth');
  };

  const renderItem = (_index: number, item: (typeof processedList)[0]) => {
    const nextItem = processedList[_index + 1];
    const turnActionsNode = 'type' in item && nextItem?.type === 'turn_actions' ? <TurnActions turnTexts={nextItem.turnTexts} turnTextsRaw={nextItem.turnTextsRaw} conversationId={nextItem.conversationId} tokenUsage={nextItem.tokenUsage} showTokenUsageBadge={showTokenUsageBadges} /> : undefined;

    if ('type' in item && item.type === 'loading_indicator') {
      return <MessageLoadingIndicator key={item.id} />;
    }
    // Render time separator
    if ('type' in item && item.type === 'time_separator') {
      return <MessageTimeSeparator key={item.id} timestamp={(item as { type: 'time_separator'; id: string; timestamp: number }).timestamp} />;
    }
    if ('type' in item && ['file_summary', 'tool_summary'].includes(item.type)) {
      return (
        <div key={item.id} data-message-id={item.id} className={'min-w-0 flex w-full flex-col items-start box-border message-item m-t-10px max-w-full md:max-w-800px mx-auto ' + item.type}>
          <div className='w-full min-w-0 flex flex-col items-start'>
            <div className='flex w-full min-w-0 justify-start'>
              {item.type === 'file_summary' && <MessageFileChanges diffsChanges={item.diffs} />}
              {item.type === 'tool_summary' &&
                (() => {
                  // Check if this summary is part of the ongoing AI response
                  // 检查这个汇总是否是当前正在进行的 AI 响应的一部分
                  const isLastItem = _index >= processedList.length - 2; // last or second to last (actions)
                  const isStreaming = item.messages.some((m) => m.id === lastAiMessageId) || (aiProcessing && isLastItem);

                  return (
                    <MessageToolGroupSummary
                      messages={item.messages}
                      summaryId={item.id}
                      // While AI is processing/streaming this block, it MUST be expanded.
                      // 当 AI 正在处理或流式传输此块时，它必须展开。
                      isExpanded={isStreaming ? true : (toolSummaryStates[item.id] ?? false)}
                      onToggle={(id) => {
                        // Only allow toggling if it's NOT streaming
                        if (!isStreaming) {
                          setToolSummaryStates((prev) => ({ ...prev, [id]: !prev[id] }));
                        }
                      }}
                      isStreaming={isStreaming}
                    />
                  );
                })()}
            </div>
            {turnActionsNode && <div className='mt-4px w-full max-w-full'>{turnActionsNode}</div>}
          </div>
        </div>
      );
    }
    if ('type' in item && item.type === 'turn_actions') {
      return null;
    }
    const message = item as TMessage;
    return <MessageItem message={message} key={message.id} isStreaming={message.id === lastAiMessageId} footer={turnActionsNode} onTeamAnswerQuestion={onTeamAnswerQuestion} onTeamQuestionFallbackSend={onTeamQuestionFallbackSend}></MessageItem>;
  };

  return (
    <div className={classNames('relative flex-1 h-full', className)} onContextMenu={handleContextMenu}>
      {/* Context Menu Rendering */}
      {contextMenu && <ContextMenu x={contextMenu.x} y={contextMenu.y} items={contextMenu.items} onClose={() => setContextMenu(null)} />}
      {isShowingEmptyState ? (
        <div className='absolute inset-0 z-1 flex items-center justify-center px-20px pointer-events-none'>
          <div className='w-full pointer-events-auto'>{emptyState}</div>
        </div>
      ) : null}
      {/* Use PreviewGroup to wrap all messages for cross-message image preview */}
      <Image.PreviewGroup actionsLayout={['zoomIn', 'zoomOut', 'originalSize', 'rotateLeft', 'rotateRight']}>
        <ImagePreviewContext.Provider value={{ inPreviewGroup: true }}>
          <Virtuoso
            ref={virtuosoRef}
            scrollerRef={handleScrollerRef}
            className='flex-1 h-full pb-10px box-border'
            data={processedList}
            initialTopMostItemIndex={processedList.length - 1}
            // atBottom must encompass the dynamic spacer so "at bottom" still
            // means "the last message is in view" while the user prompt is
            // pinned at the top with an empty canvas below it.
            atBottomThreshold={bottomSpacerHeight + BOTTOM_BUFFER_PX}
            increaseViewportBy={200}
            itemContent={renderItem}
            followOutput={handleFollowOutput}
            onScroll={handleScroll}
            atBottomStateChange={handleAtBottomStateChange}
            components={{
              Header: () => <div className='h-10px' />,
              // Footer = static BOTTOM_BUFFER_PX (breathing room between the
              // last message and the SendBox below) + dynamic bottomSpacerHeight
              // that pins the user prompt to the top of the viewport while the
              // AI streams into the empty canvas below. bottomSpacerHeight is 0
              // in idle state, so the chat log looks like a regular list when
              // no turn is active.
              Footer: () => <div style={{ height: BOTTOM_BUFFER_PX + bottomSpacerHeight }} />,
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
            <div
              className='f-center h-10 w-10 cursor-pointer rounded-full border border-border bg-card text-foreground-secondary shadow-lg transition-all hover:scale-110 hover:bg-accent hover:text-foreground'
              onClick={handleScrollButtonClick}
              title={t('messages.scrollToBottom')}
              style={{ lineHeight: 0 }}
            >
              <Down size={20} style={{ display: 'block' }} />
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default MessageList;
