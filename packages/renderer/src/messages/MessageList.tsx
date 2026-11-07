/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Image, Message } from '@arco-design/web-react';
import { Down } from '@icon-park/react';
import classNames from 'classnames';
import React, { createContext, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Virtuoso } from 'react-virtuoso';
import { IconCopy } from '@arco-design/web-react/icon';
import type { TMessage } from '@sudowork/common/chatLib';
import { NEXUS_FILES_MARKER } from '@sudowork/common/constants';
import { stripThinkTags, hasThinkTags } from '@sudowork/common/thinkTagFilter';
import * as ipcBridge from '@sudowork/host-bridge/ipcBridge';
import { useConversationContextSafe } from '@renderer/context/ConversationContext';
import { CHAT_MESSAGE_JUMP_EVENT, type ChatMessageJumpDetail } from '@renderer/utils/chatMinimapEvents';
import MessageAcpPermission from '@renderer/messages/acp/MessageAcpPermission';
import MessageAcpQuestion from '@renderer/messages/acp/MessageAcpQuestion';
import MessageAcpToolCall from '@renderer/messages/acp/MessageAcpToolCall';
import MessageAgentStatus from '@renderer/messages/MessageAgentStatus';
import ContextMenu, { type ContextMenuItem } from '@renderer/components/ContextMenu';
import { copyText } from '@renderer/utils/clipboard';
import { useShowToolCalls } from '@renderer/hooks/useShowToolCalls';
import { areTurnActionsEqual, buildMessagePresentation, type MessagePresentation, type TurnActionsPresentation } from './messagePresentation';
import HOC from '../utils/HOC';
import MessageCodexToolCall from './codex/MessageCodexToolCall';
import MessageFileChanges from './codex/MessageFileChanges';
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
import { ShareoneCliStatusProvider } from './ShareoneCliStatusContext';
import { BOTTOM_BUFFER_PX, useAutoScroll } from './useAutoScroll';
import MessageTimeSeparator from './MessageTimeSeparator';
import MessageLoadingIndicator from './MessageLoadingIndicator';

type IMessageVO = MessagePresentation;

// Image preview context
export const ImagePreviewContext = createContext<{ inPreviewGroup: boolean }>({ inPreviewGroup: false });

interface IMessageQuestionCallbacks {
  onTeamAnswerQuestion?: (params: { conversationId: string; toolCallId: string; answers: Array<{ id: string; value: string; label?: string }> }) => Promise<{ success: boolean; msg?: string } | void>;
  onTeamQuestionFallbackSend?: (params: { input: string; msg_id: string }) => Promise<{ success: boolean; msg?: string } | void>;
}

export const MessageItem: React.FC<IMessageItemProps> = React.memo(
  HOC((props) => {
    const { message } = props as IMessageItemProps;
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
  })(({ message, isStreaming, turnActions, isTokenUsageBadgeVisible, onTeamAnswerQuestion, onTeamQuestionFallbackSend }: IMessageItemProps) => {
    const { t } = useTranslation();
    const footer = turnActions ? <TurnActions {...turnActions} showTokenUsageBadge={isTokenUsageBadgeVisible} /> : undefined;
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
    prev.isTokenUsageBadgeVisible === next.isTokenUsageBadgeVisible &&
    areTurnActionsEqual(prev.turnActions, next.turnActions) &&
    prev.onTeamAnswerQuestion === next.onTeamAnswerQuestion &&
    prev.onTeamQuestionFallbackSend === next.onTeamQuestionFallbackSend
);

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
              let textToCopy: string;
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
  const processedList = useMemo(() => buildMessagePresentation(list, { isProcessing: aiProcessing, isToolCallsVisible: showToolCalls, conversationId: conversationContext?.conversationId }), [list, aiProcessing, showToolCalls, conversationContext?.conversationId]);

  // Actions render inside the preceding message. A null virtual row at the
  // initial scroll target prevents Virtuoso from measuring the chat history.
  const { visibleItems, actionsByMessageId } = useMemo(() => {
    const actions = new Map<string, Extract<IMessageVO, { type: 'turn_actions' }>>();
    const items = processedList.filter((item, index) => {
      if (item.type !== 'turn_actions') return true;
      const previous = processedList[index - 1];
      if (previous) actions.set(previous.id, item);
      return false;
    });
    return { visibleItems: items, actionsByMessageId: actions };
  }, [processedList]);

  const isShowingEmptyState = Boolean(isEmptyStateReady && emptyState && processedList.length === 0 && !aiProcessing);

  // Use auto-scroll hook
  const { virtuosoRef, handleScroll, handleAtBottomStateChange, handleFollowOutput, handleScrollerRef, showScrollButton, scrollToBottom, hideScrollButton, bottomSpacerHeight } = useAutoScroll({
    messages: list,
    items: visibleItems,
  });

  useEffect(() => {
    const handleMessageJump = (event: Event) => {
      const detail = (event as CustomEvent<ChatMessageJumpDetail>).detail;
      if (!detail || !detail.conversationId) return;
      if (!conversationContext?.conversationId || detail.conversationId !== conversationContext.conversationId) return;

      const targetIndex = visibleItems.findIndex((item) => {
        if ((item as { type?: string }).type === 'file_summary' || (item as { type?: string }).type === 'tool_summary' || (item as { type?: string }).type === 'turn_actions' || (item as { type?: string }).type === 'time_separator' || (item as { type?: string }).type === 'loading_indicator') {
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
  }, [conversationContext?.conversationId, hideScrollButton, visibleItems, virtuosoRef]);

  // Click scroll button
  const handleScrollButtonClick = () => {
    hideScrollButton();
    scrollToBottom('smooth');
  };

  const renderItem = (_index: number, item: (typeof processedList)[0]) => {
    const nextItem = actionsByMessageId.get(item.id);
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
                  const isLastItem = _index === visibleItems.length - 1;
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
    return <MessageItem message={message} key={message.id} isStreaming={message.id === lastAiMessageId} turnActions={nextItem} isTokenUsageBadgeVisible={showTokenUsageBadges} onTeamAnswerQuestion={onTeamAnswerQuestion} onTeamQuestionFallbackSend={onTeamQuestionFallbackSend}></MessageItem>;
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
      <ShareoneCliStatusProvider>
        <Image.PreviewGroup actionsLayout={['zoomIn', 'zoomOut', 'originalSize', 'rotateLeft', 'rotateRight']}>
          <ImagePreviewContext.Provider value={{ inPreviewGroup: true }}>
            <Virtuoso
              ref={virtuosoRef}
              scrollerRef={handleScrollerRef}
              className='flex-1 h-full pb-10px box-border'
              data={visibleItems}
              computeItemKey={(_index, item) => item.id}
              initialTopMostItemIndex={Math.max(0, visibleItems.length - 1)}
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
      </ShareoneCliStatusProvider>

      {showScrollButton && (
        <>
          {/* Gradient mask */}
          <div className='absolute bottom-0 left-0 right-0 h-100px pointer-events-none' />
          {/* Scroll button */}
          <div className='absolute bottom-20px left-50% transform -translate-x-50% z-100'>
            <div className='flex items-center justify-center w-40px h-40px rd-full bg-base shadow-lg cursor-pointer hover:bg-1 transition-all hover:scale-110 border' onClick={handleScrollButtonClick} title={t('messages.scrollToBottom')} style={{ lineHeight: 0 }}>
              <Down theme='filled' size='20' fill={'var(--text-secondary)'} style={{ display: 'block' }} />
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default MessageList;

interface IMessageItemProps extends IMessageQuestionCallbacks {
  message: TMessage;
  isStreaming?: boolean;
  turnActions?: TurnActionsPresentation;
  isTokenUsageBadgeVisible?: boolean;
}

interface IMessageListProps extends IMessageQuestionCallbacks {
  className?: string;
  aiProcessing?: boolean; // AI processing state
  emptyState?: React.ReactNode;
  isEmptyStateReady?: boolean;
}
