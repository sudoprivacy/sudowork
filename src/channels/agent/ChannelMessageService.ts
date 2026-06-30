/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mainWarn } from '@process/utils/mainLogger';
import WorkerManage from '@/process/WorkerManage';
import { getDatabase } from '@/process/database';
import type BaseAgent from '@/process/task/BaseAgent';
import { queueConversationWorkspaceSkillSync } from '@/process/bridge/conversationBridge';
import type { AcpQuestionResponseAnswer } from '@/types/acpTypes';
import { composeMessage, transformMessage, type TMessage, type AcpQuestionData } from '../../common/chatLib';
import { uuid } from '../../common/utils';
import type { IResponseMessage } from '../../common/ipcBridge';
import { channelEventBus, type IAgentMessageEvent } from './ChannelEventBus';

/**
 * Streaming callback for progress updates
 */
export type StreamCallback = (chunk: TMessage, insert: boolean) => void;

/** Maximum time (ms) to wait for a stream to complete before sending timeout warning */
const STREAM_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Maximum time (ms) to wait before force-cleaning a stream (hard timeout).
 * Real agent tasks (browser automation, multi-step tool use) routinely run
 * several minutes, so 10 min was too tight and cut work off mid-flight. 20 min
 * gives genuine long tasks room to finish while still bounding stuck streams.
 */
const STREAM_HARD_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes

/**
 * 消息流状态
 * Message stream state
 */
interface IStreamState {
  msgId: string;
  callback: StreamCallback;
  buffer: string;
  resolve: (value: string) => void;
  reject: (error: Error) => void;
  /** Number of 'start' events received (tracks multi-turn tool-call continuations) */
  turnCount: number;
  /** Number of 'finish' events received */
  finishCount: number;
  /** Timer that sends timeout warning */
  timeoutTimer: ReturnType<typeof setTimeout>;
  /** Timer that force-cleans the stream */
  hardTimeoutTimer: ReturnType<typeof setTimeout>;
  /** Whether timeout warning has been sent */
  timedOut: boolean;
  /** Draining state: finish received, waiting for microtask to flush pending messages */
  draining: boolean;
  /** Pending messages buffered during draining phase */
  pendingMessages: IResponseMessage[];
}

/**
 * A pending ACP question awaiting the user's dtmd button-tap answer.
 * 待答 ACP 选项题状态：用户点击 dtmd 按钮的回答将路由到 answerQuestion。
 */
interface IPendingQuestion {
  toolCallId: string;
  questionId: string;
  kind: 'single_select' | 'multi_select';
  /** option label -> submission value */
  labelToValue: Map<string, string>;
  /** accumulated submission values (multi_select) */
  selectedValues: string[];
}

/**
 * submitAnswer 的路由结果。
 * - single_done: single_select 已作答（已调 answerQuestion）
 * - multi_submit: multi_select 已提交累积值（已调 answerQuestion）
 * - multi_select: multi_select 累积了一项（尚未调 answerQuestion）
 * - no_match: 文本不匹配任何选项 / 空选提交 → 调用方按普通用户消息处理
 */
export type PendingAnswerResult = { kind: 'single_done'; displayLabel: string } | { kind: 'multi_submit'; displayLabel: string } | { kind: 'multi_select'; displayLabel: string } | { kind: 'no_match' };

/** multi_select 提交哨兵（与 dtmd 提交按钮 content 一致）/ submit sentinel */
const QA_SUBMIT_SENTINEL = '__qa_submit__';

/**
 * ChannelMessageService - Manages message sending for Channel
 *
 * Architecture (分离设计):
 * 1. 全局事件监听：通过 ChannelEventBus 监听 Agent 消息
 * 2. sendMessage(): 仅发送消息和注册流回调
 * 3. handleAgentMessage(): 处理消息事件
 *
 * 不直接与 Agent Task 交互，完全通过全局事件总线解耦
 */
export class ChannelMessageService {
  /**
   * 活跃消息流缓存：conversationId -> 流状态
   * Active message stream cache: conversationId -> stream state
   */
  private activeStreams: Map<string, IStreamState> = new Map();

  /**
   * 待答 ACP 选项题缓存：conversationId -> 待答状态
   * Pending ACP question cache: conversationId -> pending state
   */
  private pendingQuestions: Map<string, IPendingQuestion> = new Map();

  /**
   * 全局事件监听器清理函数
   * Global event listener cleanup function
   */
  private eventCleanup: (() => void) | null = null;

  /**
   * 是否已初始化
   * Whether initialized
   */
  private initialized = false;

  private messageListMap = new Map<string, TMessage[]>();

  /**
   * 初始化服务，注册全局事件监听
   * Initialize service, register global event listener
   */
  initialize(): void {
    if (this.initialized) {
      return;
    }

    // 监听全局 Agent 消息事件
    // Listen to global agent message events
    this.eventCleanup = channelEventBus.onAgentMessage((event) => {
      this.handleAgentMessage(event);
    });

    this.initialized = true;
  }

  /**
   * 处理 Agent 消息事件
   * Handle agent message event
   */
  private handleAgentMessage(event: IAgentMessageEvent): void {
    const conversationId = event.conversation_id;
    const stream = this.activeStreams.get(conversationId);
    if (!stream) {
      // 没有活跃的流，忽略消息
      // No active stream, ignore message
      return;
    }

    // If stream is draining, buffer the message for later processing
    // This prevents race condition where finish deletes stream before content arrives
    if (stream.draining) {
      stream.pendingMessages.push(event);
      return;
    }

    // Track 'start' events to count multi-turn continuations (e.g., tool call → model response).
    // ACP agents may emit multiple 'start' events per request. We must wait for all turns to finish.
    if (event.type === 'start') {
      stream.turnCount++;
      return;
    }

    // Detect stream completion: only resolve when all turns have finished.
    // When turnCount is 0 (no 'start' received, e.g., error-only flows), use deferred resolution.
    if (event.type === 'finish') {
      stream.finishCount++;
      if (stream.turnCount === 0 || stream.finishCount >= stream.turnCount) {
        clearTimeout(stream.timeoutTimer);
        clearTimeout(stream.hardTimeoutTimer);
        // Mark stream as draining to buffer any late-arriving messages
        stream.draining = true;
        // Use microtask to defer stream deletion and resolution
        // This ensures all synchronous message emissions are processed before stream is removed
        queueMicrotask(() => {
          const drainingStream = this.activeStreams.get(conversationId);
          if (drainingStream && drainingStream.msgId === stream.msgId) {
            // Flush all pending messages that arrived during draining phase
            for (const pendingEvent of drainingStream.pendingMessages) {
              this.processMessageEvent(pendingEvent, drainingStream);
            }
            drainingStream.pendingMessages = [];
            // Delete stream and resolve
            this.activeStreams.delete(conversationId);
            drainingStream.resolve(drainingStream.msgId);
          }
        });
      }
      return;
    }

    // Process regular message
    this.processMessageEvent(event, stream);
  }

  /**
   * Process a single message event (transform + compose + callback)
   * Extracted from handleAgentMessage for reuse in draining phase flush
   */
  private processMessageEvent(event: IAgentMessageEvent, stream: IStreamState): void {
    // 转换消息
    // Transform message
    const message = transformMessage(event);
    if (!message) {
      // transformMessage 返回 undefined 表示不需要处理的消息类型（如 thought, start）
      // transformMessage returns undefined for message types that don't need processing (like thought, start)
      return;
    }

    let messageList = this.messageListMap.get(event.conversation_id);
    if (!messageList) {
      messageList = [];
    }

    messageList = composeMessage(message, messageList, (type, msg: TMessage) => {
      // insert: true 表示新消息，false 表示更新现有消息
      // insert: true means new message, false means update existing message

      const isInsert = type === 'insert';
      stream.callback(msg, isInsert);
    });
    this.messageListMap.set(event.conversation_id, messageList.slice(-20));
  }

  /**
   * Send a message and get streaming response
   *
   * @param _sessionId - User session ID (kept for API compatibility)
   * @param conversationId - Conversation ID for context
   * @param message - User message text
   * @param onStream - Callback for streaming updates
   * @returns Promise that resolves when streaming is complete
   */
  async sendMessage(_sessionId: string, conversationId: string, message: string, files: string[] | undefined, onStream: StreamCallback): Promise<string> {
    // 确保服务已初始化
    // Ensure service is initialized
    this.initialize();

    // 生成消息 ID
    // Generate message ID
    const msgId = `channel_msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // 获取任务
    // Get task
    let task: BaseAgent<unknown>;
    try {
      // 检查会话来源，如果来自 Channel 则开启 yoloMode (自动同意)
      // Check conversation source, enable yoloMode if it's from a Channel
      const db = getDatabase();
      const dbResult = db.getConversation(conversationId);
      const isFromChannel = dbResult.success && (dbResult.data?.source === 'lark' || dbResult.data?.source === 'telegram' || dbResult.data?.source === 'dingtalk' || dbResult.data?.source === 'wechat');

      if (dbResult.success && dbResult.data) {
        try {
          await queueConversationWorkspaceSkillSync(dbResult.data);
        } catch (syncError) {
          mainWarn('ChannelMessageService', 'Skill sync failed (non-blocking)', syncError);
        }
      }

      task = await WorkerManage.getTaskByIdRollbackBuild(conversationId, {
        yoloMode: isFromChannel,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to get conversation task';
      console.error(`[ChannelMessageService] Failed to get task:`, errorMsg);
      onStream(
        {
          type: 'tips',
          id: uuid(),
          conversation_id: conversationId,
          content: {
            type: 'error',
            content: `Error: ${errorMsg}`,
          },
        },
        true
      );
      throw error;
    }

    return new Promise((resolve, reject) => {
      // One in-flight turn per conversation. If a turn is already running, do
      // NOT clobber it: tearing down the live stream clears the agent's ACP
      // session mid-turn, so the running work is lost and the new turn fails
      // instantly ("Conversation not found" / ~0ms errors) — exactly the cascade
      // that a "Response timed out, please try again" prompt used to trigger
      // (user sees the warning → resends → second message kills the first).
      // Keep the in-flight turn running and tell the user to wait for its reply.
      // The old "clean up to avoid hung promises" reason no longer applies — the
      // existing stream resolves itself on finish (drain) or hard-timeout.
      const existingStream = this.activeStreams.get(conversationId);
      if (existingStream) {
        console.warn(`[ChannelMessageService] Conversation ${conversationId} busy (in-flight msgId=${existingStream.msgId}); deferring concurrent message ${msgId} instead of clobbering`);
        onStream(
          {
            type: 'tips',
            id: uuid(),
            conversation_id: conversationId,
            content: { type: 'warning', content: '⏳ 还在处理上一条消息，请等它回复后再发 / Still working on your previous message — please wait for the reply before sending another.' },
          },
          true
        );
        // Resolve (don't reject) so the channel's post-send cleanup runs as usual;
        // we simply did not start a competing turn.
        resolve(msgId);
        return;
      }

      // Send timeout warning but keep stream alive for late-arriving messages.
      // Agent might still be running and will send finish event later.
      const timeoutTimer = setTimeout(() => {
        const staleStream = this.activeStreams.get(conversationId);
        // Stream ownership check: only warn if this timer's stream is still the active one.
        if (staleStream && staleStream.msgId === msgId && !staleStream.draining && !staleStream.timedOut) {
          console.warn(`[ChannelMessageService] Stream still running after ${STREAM_TIMEOUT_MS / 1000}s for conversation ${conversationId}; sending "still working" notice (stream kept alive)`);
          staleStream.timedOut = true;
          // The stream is intentionally kept alive below and the agent's reply
          // will still arrive when the turn finishes. So this is a progress
          // notice, NOT a failure — and it must NOT tell the user to retry:
          // a resend lands as a concurrent message that would otherwise kill the
          // in-flight turn. Use 'warning' (not 'error') and ask the user to wait.
          staleStream.callback({ type: 'tips', id: uuid(), conversation_id: conversationId, content: { type: 'warning', content: '⏳ 任务较长，仍在处理中，请耐心等待，不要重复发送 / This is taking a while — still working on it. Please wait, no need to resend.' } }, true);
          console.log(`[ChannelMessageService] Keeping stream alive for late-arriving messages, conversationId=${conversationId}`);
        }
      }, STREAM_TIMEOUT_MS);

      // Hard timeout: force cleanup if agent never finishes
      const hardTimeoutTimer = setTimeout(() => {
        const staleStream = this.activeStreams.get(conversationId);
        if (staleStream && staleStream.msgId === msgId && !staleStream.draining) {
          console.warn(`[ChannelMessageService] Stream hard timeout after ${STREAM_HARD_TIMEOUT_MS / 1000}s for conversation ${conversationId}`);
          this.activeStreams.delete(conversationId);
          this.messageListMap.delete(conversationId);
          staleStream.resolve(staleStream.msgId);
        }
      }, STREAM_HARD_TIMEOUT_MS);

      // 注册流状态
      // Register stream state
      this.activeStreams.set(conversationId, {
        msgId,
        callback: onStream,
        buffer: '',
        resolve,
        reject,
        turnCount: 0,
        finishCount: 0,
        timeoutTimer,
        hardTimeoutTimer,
        timedOut: false,
        draining: false,
        pendingMessages: [],
      });

      // Build payload — ACP agents use { content }.
      // Include files (local paths) when media attachments are present.
      const payload: { content: string; msg_id: string; files?: string[] } = { content: message, msg_id: msgId };
      if (files && files.length > 0) {
        payload.files = files;
      }

      task.sendMessage(payload).catch((error: Error) => {
        const errorMessage = `Error: ${error.message || 'Failed to send message'}`;
        console.error(`[ChannelMessageService] Send error:`, error);
        onStream({ type: 'tips', id: uuid(), conversation_id: conversationId, content: { type: 'error', content: errorMessage } }, true);
        clearTimeout(timeoutTimer);
        clearTimeout(hardTimeoutTimer);
        this.activeStreams.delete(conversationId);
        this.messageListMap.delete(conversationId);
        reject(error);
      });
    });
  }

  /**
   * Clear conversation context for a session
   * Note: Agent cleanup is handled by WorkerManage.
   *
   * 清理会话上下文。Agent 的清理由 WorkerManage 处理。
   */
  async clearContext(_sessionId: string): Promise<void> {
    // Agent cleanup is handled by WorkerManage
  }

  /**
   * Clear active stream for a conversation
   * 清理指定会话的活跃流
   */
  clearStreamByConversationId(conversationId: string): void {
    const stream = this.activeStreams.get(conversationId);
    if (!stream) return;
    clearTimeout(stream.timeoutTimer);
    clearTimeout(stream.hardTimeoutTimer);
    this.activeStreams.delete(conversationId);
    // Resolve (not reject) so the caller's post-stream cleanup runs normally
    // (e.g., ActionExecutor finalizing the card with action buttons).
    stream.resolve(stream.msgId);
  }

  /**
   * Stop streaming for a conversation
   */
  async stopStreaming(conversationId: string): Promise<void> {
    try {
      const task = WorkerManage.getTaskById(conversationId);
      if (task) {
        await task.stop();
      }
    } catch (error) {
      console.warn(`[ChannelMessageService] Failed to stop streaming:`, error);
    }
    this.clearStreamByConversationId(conversationId);
  }

  /**
   * Confirm a tool call for a conversation
   * 确认工具调用
   *
   * @param conversationId - Conversation ID
   * @param callId - Tool call ID
   * @param value - Confirmation value (e.g., 'proceed_once', 'cancel')
   */
  async confirm(conversationId: string, callId: string, value: string): Promise<void> {
    try {
      const task = WorkerManage.getTaskById(conversationId);
      if (!task) {
        throw new Error(`Task not found for conversation ${conversationId}`);
      }

      // 调用 agent 的 confirm 方法
      // Call agent's confirm method
      task.confirm(conversationId, callId, value);
    } catch (error) {
      console.error(`[ChannelMessageService] Failed to confirm tool call:`, error);
      throw error;
    }
  }

  /**
   * Register a pending ACP question for a conversation.
   * Called on the first (insert) outbound acp_question so subsequent inbound
   * button-taps route to answerQuestion instead of sendMessage (which would
   * treat the answer as a new turn — AcpAgent.sendMessage ignores pendingQuestions).
   *
   * 为会话登记待答 ACP 选项题（出站首次提问时调用）。
   */
  registerPendingQuestion(conversationId: string, content: AcpQuestionData): void {
    const items = content.items ?? [];
    const item = items[0];
    const kind = item?.kind;
    if (items.length !== 1 || !item || !content.toolCallId) return;
    if (kind !== 'single_select' && kind !== 'multi_select' && kind !== 'boolean') return;

    const labelToValue = new Map<string, string>();
    for (const option of item.options ?? []) {
      labelToValue.set(option.label, option.value);
    }
    this.pendingQuestions.set(conversationId, {
      toolCallId: content.toolCallId,
      questionId: item.id,
      kind: kind === 'multi_select' ? 'multi_select' : 'single_select',
      labelToValue,
      selectedValues: [],
    });
  }

  /**
   * Whether the conversation has a pending ACP question awaiting an answer.
   */
  hasPendingQuestion(conversationId: string): boolean {
    return this.pendingQuestions.has(conversationId);
  }

  /**
   * Submit a user's text answer toward a pending question.
   * - single 命中 → answerQuestion + single_done
   * - multi 命中选项 → 累积(去重) + multi_select（不调 answerQuestion）
   * - multi 提交哨兵 → answerQuestion(累积值, ' / ' 连接) + multi_submit
   * - 否则 → no_match（调用方按普通用户消息处理）
   *
   * multi_select 的 ' / ' 连接口径与桌面端 MessageAcpQuestion 一致。
   */
  submitAnswer(conversationId: string, text: string): PendingAnswerResult {
    const pending = this.pendingQuestions.get(conversationId);
    if (!pending) return { kind: 'no_match' };

    if (text === QA_SUBMIT_SENTINEL && pending.kind === 'multi_select') {
      if (pending.selectedValues.length === 0) {
        return { kind: 'no_match' };
      }
      const displayLabel = this.labelsForValues(pending, pending.selectedValues).join(' / ');
      const submissionValue = pending.selectedValues.join(' / ');
      this.answerQuestion(conversationId, pending.toolCallId, [{ id: pending.questionId, value: submissionValue, label: displayLabel }]);
      this.pendingQuestions.delete(conversationId);
      return { kind: 'multi_submit', displayLabel };
    }

    if (pending.labelToValue.has(text)) {
      const value = pending.labelToValue.get(text)!;
      if (pending.kind === 'single_select') {
        this.answerQuestion(conversationId, pending.toolCallId, [{ id: pending.questionId, value, label: text }]);
        this.pendingQuestions.delete(conversationId);
        return { kind: 'single_done', displayLabel: text };
      }
      if (!pending.selectedValues.includes(value)) {
        pending.selectedValues.push(value);
      }
      return { kind: 'multi_select', displayLabel: text };
    }

    return { kind: 'no_match' };
  }

  /**
   * Clear the pending question for a conversation (idempotent).
   * Called on answered/cancelled outbound update so no stale state remains.
   */
  clearPendingQuestion(conversationId: string): void {
    this.pendingQuestions.delete(conversationId);
  }

  /**
   * Map already-selected submission values back to display labels (multi_select).
   */
  private labelsForValues(pending: IPendingQuestion, values: string[]): string[] {
    const valueToLabel = new Map<string, string>();
    for (const [label, value] of pending.labelToValue) {
      valueToLabel.set(value, label);
    }
    return values.map((v) => valueToLabel.get(v) ?? v);
  }

  /**
   * Send answers back to the agent task via answerQuestion (mirrors confirm()).
   * answerQuestion is provided by AcpAgent; BaseAgent does not declare it, and
   * acp_question only originates from AcpAgent, so the task is guaranteed to support it.
   */
  private answerQuestion(conversationId: string, toolCallId: string, answers: AcpQuestionResponseAnswer[]): void {
    const task = WorkerManage.getTaskById(conversationId);
    if (!task) {
      throw new Error(`Task not found for conversation ${conversationId}`);
    }
    const answerable = task as unknown as {
      answerQuestion?: (toolCallId: string, answers: AcpQuestionResponseAnswer[]) => Promise<void>;
    };
    if (typeof answerable.answerQuestion !== 'function') {
      throw new Error(`Agent does not support answerQuestion for conversation ${conversationId}`);
    }
    void answerable.answerQuestion(toolCallId, answers);
  }

  /**
   * Shutdown service
   * Called during application shutdown
   */
  async shutdown(): Promise<void> {
    // 清理所有活跃流
    // Clear all active streams
    for (const [conversationId] of this.activeStreams) {
      this.clearStreamByConversationId(conversationId);
    }
    this.activeStreams.clear();

    // 移除全局事件监听
    // Remove global event listener
    if (this.eventCleanup) {
      this.eventCleanup();
      this.eventCleanup = null;
    }

    this.initialized = false;
  }
}

// Singleton instance
let serviceInstance: ChannelMessageService | null = null;

export function getChannelMessageService(): ChannelMessageService {
  if (!serviceInstance) {
    serviceInstance = new ChannelMessageService();
  }
  return serviceInstance;
}
