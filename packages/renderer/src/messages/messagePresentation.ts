import type { CodexToolCallUpdate, IMessageAcpToolCall, IMessageToolGroup, TMessage, TurnTokenUsage } from '@sudowork/common/chatLib';
import { NEXUS_FILES_MARKER } from '@sudowork/common/constants';
import { stripThinkTags, hasThinkTags } from '@sudowork/common/thinkTagFilter';
import { shouldShowTimeSeparator } from '@renderer/utils/messageTime';
import { parseDiff, type FileChangeInfo } from '@renderer/utils/diffUtils';
import type { WriteFileResult } from './types';

type TurnDiffContent = Extract<CodexToolCallUpdate, { subtype: 'turn_diff' }>;

export type MessagePresentation =
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

const isUserFacingAcpToolCall = (message: IMessageAcpToolCall): boolean => {
  const title = message.content?.update?.title;
  return title === 'AskUserQuestion' || title === 'SendUserMessage';
};

export interface MessagePresentationOptions {
  isProcessing: boolean;
  isToolCallsVisible: boolean;
  conversationId?: string;
}

export type TurnActionsPresentation = Extract<MessagePresentation, { type: 'turn_actions' }>;

/** Compare footer data, rather than newly-created React elements. */
export function areTurnActionsEqual(previous?: TurnActionsPresentation, next?: TurnActionsPresentation): boolean {
  if (previous === next) return true;
  if (!previous || !next) return false;
  return (
    previous.id === next.id &&
    previous.conversationId === next.conversationId &&
    previous.tokenUsage === next.tokenUsage &&
    previous.turnTexts.length === next.turnTexts.length &&
    previous.turnTexts.every((text, index) => text === next.turnTexts[index]) &&
    previous.turnTextsRaw.length === next.turnTextsRaw.length &&
    previous.turnTextsRaw.every((text, index) => text === next.turnTextsRaw[index])
  );
}

/** Derives stable virtual rows from engine messages without altering delivery order. */
export function buildMessagePresentation(list: TMessage[], { isProcessing, isToolCallsVisible, conversationId }: MessagePresentationOptions): MessagePresentation[] {
  const result: Array<MessagePresentation> = [];
  let diffsChanges: FileChangeInfo[] = [];
  let toolList: Array<IMessageToolGroup | IMessageAcpToolCall> = [];
  let turnTexts: string[] = [];
  let turnTextsRaw: string[] = [];
  let turnTokenUsage: TurnTokenUsage | undefined;
  let lastAiTextId = '';

  const flushTurnActions = () => {
    if (turnTexts.length > 0) {
      result.push({ type: 'turn_actions', id: `turn-actions-${lastAiTextId}`, turnTexts, turnTextsRaw, conversationId: conversationId, tokenUsage: turnTokenUsage });
      turnTexts = [];
      turnTextsRaw = [];
      turnTokenUsage = undefined;
      lastAiTextId = '';
    }
  };

  const pushFileDiffChanges = (message: TMessage, changes: FileChangeInfo) => {
    if (!diffsChanges.length) {
      result.push({ type: 'file_summary', id: `file-summary-${message.id}`, diffs: diffsChanges });
    }
    diffsChanges.push(changes);
    toolList = [];
  };
  const pushToolList = (message: IMessageToolGroup | IMessageAcpToolCall) => {
    if (!toolList.length) {
      // Generate unique id for tool_summary using first message's id
      const firstMsg = message;
      const summaryId = firstMsg.type === 'tool_group' ? firstMsg.content[0]?.callId || firstMsg.id : firstMsg.content.update?.toolCallId || firstMsg.id;
      result.push({ type: 'tool_summary', id: `tool-summary-${summaryId}`, messages: toolList });
    }
    toolList.push(message);
    diffsChanges = [];
  };

  for (let i = 0, len = list.length; i < len; i++) {
    const message = list[i];
    // Skip available_commands messages
    if (message.type === 'available_commands') continue;
    // Permission prompts render in ConversationChatConfirm, outside the list.
    if (message.type === 'codex_permission') continue;
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
      pushFileDiffChanges(message, parseDiff((message.content as TurnDiffContent).data.unified_diff));
      continue;
    }
    // 关闭"显示工具调用"时隐藏工具消息（文件变更摘要与用户交互消息保留）
    // Hide tool messages when "show tool calls" is off (file-change summaries
    // and user-facing prompts stay visible)
    if (!isToolCallsVisible && (message.type === 'tool_call' || message.type === 'codex_tool_call')) {
      continue;
    }
    if (message.type === 'tool_group') {
      if (message.content.length === 1) {
        const writeFileResults = message.content.filter((item) => item.name === 'WriteFile' && item.resultDisplay && typeof item.resultDisplay === 'object' && 'fileDiff' in item.resultDisplay).map((item) => item.resultDisplay as WriteFileResult);
        if (writeFileResults.length && writeFileResults[0].fileDiff) {
          pushFileDiffChanges(message, parseDiff(writeFileResults[0].fileDiff, writeFileResults[0].fileName));
          continue;
        }
      }
      if (!isToolCallsVisible) continue;
      pushToolList(message);
      continue;
    }
    if (message.type === 'acp_tool_call') {
      if (isUserFacingAcpToolCall(message)) {
        toolList = [];
        diffsChanges = [];
        continue;
      }
      if (!isToolCallsVisible) continue;
      pushToolList(message);
      continue;
    }
    toolList = [];
    diffsChanges = [];
    result.push(message);
  }
  // Only expose turn actions after the AI stream finishes.
  if (!isProcessing) {
    flushTurnActions();
  }

  // Insert time separators between messages with significant time gaps
  // 在时间间隔较大的消息之间插入时间分隔符
  const withTimeSeparators: Array<MessagePresentation> = [];
  let prevTimestamp: number | undefined;

  for (const item of result) {
    // Get timestamp from TMessage items (they have createdAt)
    const currentTimestamp = 'createdAt' in item ? (item as TMessage).createdAt : undefined;

    if (currentTimestamp && shouldShowTimeSeparator(prevTimestamp, currentTimestamp)) {
      withTimeSeparators.push({
        type: 'time_separator',
        id: `time-sep-${item.id}`,
        timestamp: currentTimestamp,
      });
    }

    withTimeSeparators.push(item);

    if (currentTimestamp) {
      prevTimestamp = currentTimestamp;
    }
  }

  const shouldShowLoading = isProcessing && list.length > 0;
  if (shouldShowLoading) {
    withTimeSeparators.push({
      type: 'loading_indicator',
      id: 'temp-loading-indicator',
    });
  }

  return withTimeSeparators;
}
