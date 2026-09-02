/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mainWarn } from '@process/utils/mainLogger';
import WorkerManage from '@/process/WorkerManage';
import { turnInputCoordinator, type QueuedTurn } from '@/process/task/turnInputCoordinator';
import { ProcessConfig } from '@/process/initStorage';
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
  /**
   * Promises returned by async callbacks that haven't settled yet. Awaited on
   * finish so resolve() doesn't fire while a callback is still mid-await.
   */
  inFlightCallbacks: Set<Promise<void>>;
}

/**
 * A pending ACP question item (one of possibly many in a multi-question prompt).
 * 单道待答题。
 */
interface IPendingItem {
  id: string;
  kind: 'single_select' | 'multi_select' | 'text';
  /** option label -> submission value (empty Map for text kind) */
  labelToValue: Map<string, string>;
  /** accumulated submission values (multi_select only) */
  selectedValues: string[];
}

/**
 * A pending ACP question (1 or more items) awaiting the user's dtmd button-tap answer.
 * 待答 ACP 选项题状态：用户点击 dtmd 按钮的回答将累积，直到所有题答完再一次性 answerQuestion。
 */
interface IPendingQuestion {
  toolCallId: string;
  /** Original content kept for re-rendering subsequent items. */
  originalContent: AcpQuestionData;
  items: IPendingItem[];
  /** Index of the item currently awaiting an answer (0-based). */
  currentIndex: number;
  /** Answers accumulated from already-answered items, submitted in bulk on the last item. */
  completedAnswers: AcpQuestionResponseAnswer[];
  /**
   * All offered option labels of already-answered items → that item's index.
   * Used to detect stale-button taps: once an item has advanced, tapping ANY of
   * its old card's buttons (selected or not) should be reported as stale rather
   * than fall through to a new agent turn.
   */
  staleLabels: Map<string, number>;
}

/**
 * submitAnswer 的路由结果。
 * - item_done: 当前题已作答（multi_select 已提交）但仍有未答的下一题，尚未调 answerQuestion
 * - multi_select_accumulate: multi_select 当前题累积了一项（尚未提交）
 * - all_done: 最后一道已作答 → 已一次性调 answerQuestion(completedAnswers)
 * - stale: 用户回头点了已答题的旧 dtmd 按钮
 * - no_match: 文本不匹配任何选项 → 调用方按普通用户消息处理
 */
export type PendingAnswerResult =
  { kind: 'item_done'; displayLabel: string; currentIndex: number; totalItems: number } | { kind: 'multi_select_accumulate'; displayLabel: string } | { kind: 'all_done'; displayLabel: string } | { kind: 'stale'; staleQuestionIndex: number; currentIndex: number } | { kind: 'no_match' };

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
        queueMicrotask(async () => {
          const drainingStream = this.activeStreams.get(conversationId);
          if (drainingStream && drainingStream.msgId === stream.msgId) {
            // Flush all pending messages that arrived during draining phase
            for (const pendingEvent of drainingStream.pendingMessages) {
              this.processMessageEvent(pendingEvent, drainingStream);
            }
            drainingStream.pendingMessages = [];
            // Drain in-flight async callbacks so the caller's finalize step sees
            // up-to-date state (e.g. sentMessageIds containing the just-created card).
            // Loop because a callback may fire more callbacks during await.
            while (drainingStream.inFlightCallbacks.size > 0) {
              await Promise.all(Array.from(drainingStream.inFlightCallbacks));
            }
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
    // 思考过程只在桌面/WebUI 会话中展示，不转发到 IM 渠道
    // Reasoning content is desktop/WebUI-only; never forward it to IM channels
    if (event.type === 'thought') {
      return;
    }

    // 转换消息
    // Transform message
    const message = transformMessage(event);
    if (!message) {
      // transformMessage 返回 undefined 表示不需要处理的消息类型（如 start, finish）
      // transformMessage returns undefined for message types that don't need processing (like start, finish)
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
      // Callback's declared return is void, but async implementations actually return a Promise.
      // Promise.resolve uniformly wraps both cases so the finish path can await any in-flight
      // async work before resolving the outer sendMessage Promise.
      const promise = Promise.resolve(stream.callback(msg, isInsert));
      stream.inFlightCallbacks.add(promise);
      void promise.finally(() => stream.inFlightCallbacks.delete(promise));
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

    // Interrupt / message-queue: route through the shared coordinator (SSOT) so a new
    // channel message interrupts or queues against an in-flight turn instead of being
    // dropped. Same matrix as desktop; channels have no queue UI, so outcomes are surfaced
    // as short text notices (proposal §4.2).
    const autoInterrupt = (await ProcessConfig.get('agent.autoInterrupt').catch(() => false)) === true;
    const messageQueue = (await ProcessConfig.get('agent.messageQueue').catch(() => true)) !== false;

    return new Promise<string>((resolve, reject) => {
      // The coordinator hands tail items to the head's run when batching. We capture it here
      // so the run-closure below can inline them into task.sendMessage's user content.
      let flushedTail: QueuedTurn[] | undefined;
      // One channel turn: register its stream state + send, resolving when the turn ends.
      // The coordinator runs these serially (now, or after the current turn / a cancel).
      const run = (tail?: QueuedTurn[]) =>
        new Promise<void>((turnDone) => {
          flushedTail = tail;
          // Soft timeout: progress notice, keep the stream alive for late-arriving messages.
          const timeoutTimer = setTimeout(() => {
            const staleStream = this.activeStreams.get(conversationId);
            if (staleStream && staleStream.msgId === msgId && !staleStream.draining && !staleStream.timedOut) {
              staleStream.timedOut = true;
              staleStream.callback({ type: 'tips', id: uuid(), conversation_id: conversationId, content: { type: 'warning', content: '⏳ 任务较长，仍在处理中，请耐心等待，不要重复发送 / This is taking a while — still working on it. Please wait, no need to resend.' } }, true);
            }
          }, STREAM_TIMEOUT_MS);

          // Hard timeout: force cleanup if the agent never finishes.
          const hardTimeoutTimer = setTimeout(() => {
            const staleStream = this.activeStreams.get(conversationId);
            if (staleStream && staleStream.msgId === msgId && !staleStream.draining) {
              this.activeStreams.delete(conversationId);
              this.messageListMap.delete(conversationId);
              staleStream.resolve(staleStream.msgId);
            }
          }, STREAM_HARD_TIMEOUT_MS);

          // Register stream state. resolve/reject also end the coordinator turn (turnDone)
          // so the drain loop advances to the next queued input.
          this.activeStreams.set(conversationId, {
            msgId,
            callback: onStream,
            buffer: '',
            resolve: (mid: string) => {
              resolve(mid);
              turnDone();
            },
            reject: (err: Error) => {
              reject(err);
              turnDone();
            },
            turnCount: 0,
            finishCount: 0,
            timeoutTimer,
            hardTimeoutTimer,
            timedOut: false,
            draining: false,
            pendingMessages: [],
            inFlightCallbacks: new Set(),
          });

          // If the coordinator flushed queued items as our tail, merge their text into this
          // message so the downstream turn sees a single combined user message (§3.2 batched
          // flush). Only text is merged — tail items' `files` slots are not exposed and are
          // dropped (queued channel messages are text in practice; attachments are rare).
          const contentWithTail = flushedTail && flushedTail.length > 0 ? [message, ...flushedTail.map((t) => t.content)].join('\n\n') : message;
          const payload: { content: string; msg_id: string; files?: string[] } = { content: contentWithTail, msg_id: msgId };
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
            turnDone();
          });
        });

      const status = turnInputCoordinator.submit(
        conversationId,
        {
          id: msgId,
          content: message,
          run,
          // If this message is batched into another head's tail, our outer Promise here would
          // hang (our `run` never fires). Resolve it with our own msgId so the caller sees a
          // clean completion; also send a channel tip so the user knows it was merged.
          onBatched: () => {
            onStream({ type: 'tips', id: uuid(), conversation_id: conversationId, content: { type: 'success', content: '📎 已合并到当前回复 / Merged into the current reply.' } }, true);
            resolve(msgId);
          },
        },
        () => Promise.resolve((task as { stop?: () => unknown }).stop?.()),
        { autoInterrupt, messageQueue }
      );

      if (status === 'busy') {
        // Both interrupt + queue off → keep today's behaviour: don't clobber, ask to wait.
        onStream({ type: 'tips', id: uuid(), conversation_id: conversationId, content: { type: 'warning', content: '⏳ 还在处理上一条消息，请等它回复后再发 / Still working on your previous message — please wait for the reply before sending another.' } }, true);
        resolve(msgId);
      } else if (status === 'queued') {
        onStream({ type: 'tips', id: uuid(), conversation_id: conversationId, content: { type: 'warning', content: '📥 已排队，将在当前回复结束后依次处理 / Queued — will be handled after the current reply.' } }, true);
      } else if (status === 'interrupting') {
        onStream({ type: 'tips', id: uuid(), conversation_id: conversationId, content: { type: 'warning', content: '⚡ 已中断，正在处理新指令 / Interrupted — handling your new instruction.' } }, true);
      }
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
   * Returns true if registered (all items have supported kinds and toolCallId is set);
   * false otherwise so the caller can render the downgrade text path.
   *
   * 为会话登记待答 ACP 选项题（出站首次提问时调用）；返回是否登记成功。
   */
  registerPendingQuestion(conversationId: string, content: AcpQuestionData): boolean {
    const items = content.items ?? [];
    if (items.length === 0 || !content.toolCallId) return false;
    for (const item of items) {
      const k = item.kind;
      if (k !== 'single_select' && k !== 'multi_select' && k !== 'boolean' && k !== 'text') return false;
    }

    const pendingItems: IPendingItem[] = items.map((item): IPendingItem => {
      const labelToValue = new Map<string, string>();
      // text item has no dtmd options; its labelToValue stays empty.
      if (item.kind !== 'text') {
        for (const option of item.options ?? []) {
          labelToValue.set(option.label, option.value);
        }
      }
      // boolean 视作 single_select：行为完全一致（点哪个 label 即提交对应 value）
      let kind: IPendingItem['kind'];
      if (item.kind === 'multi_select') kind = 'multi_select';
      else if (item.kind === 'text') kind = 'text';
      else kind = 'single_select';
      return {
        id: item.id,
        kind,
        labelToValue,
        selectedValues: [],
      };
    });

    this.pendingQuestions.set(conversationId, {
      toolCallId: content.toolCallId,
      originalContent: content,
      items: pendingItems,
      currentIndex: 0,
      completedAnswers: [],
      staleLabels: new Map<string, number>(),
    });
    return true;
  }

  /**
   * Returns the data needed to render the NEXT pending item card
   * (i.e. the item at currentIndex). Used after submitAnswer returns item_done
   * so the ActionExecutor can dispatch the next question's card.
   */
  getPendingForNextRender(conversationId: string): { content: AcpQuestionData; itemIndex: number } | null {
    const pending = this.pendingQuestions.get(conversationId);
    if (!pending) return null;
    return { content: pending.originalContent, itemIndex: pending.currentIndex };
  }

  /**
   * Whether the conversation has a pending ACP question awaiting an answer.
   */
  hasPendingQuestion(conversationId: string): boolean {
    return this.pendingQuestions.has(conversationId);
  }

  /**
   * Submit a user's text answer toward the currently-pending item of a pending question.
   *
   * Routing for `current = items[currentIndex]`:
   * 1. `__qa_submit__` 哨兵 + current.kind === 'multi_select' → 合并累积值为单答案推入
   *    completedAnswers，advance；进入终态判断（步骤 4）
   * 2. text 命中 current.labelToValue：
   *    - single_select：推入单答案，advance → 终态判断
   *    - multi_select：去重累积到 current.selectedValues，返回 multi_select_accumulate
   * 3. 陈旧检测：text 命中任何已答题的 label → 返回 stale
   * 4. 终态判断：
   *    - currentIndex < items.length → item_done（调用方应渲染下一题卡片）
   *    - currentIndex === items.length → 一次性 answerQuestion(completedAnswers)，all_done
   * 5. 都不命中 → no_match（调用方按普通用户消息处理）
   *
   * multi_select 的 ' / ' 连接口径与桌面端 MessageAcpQuestion 一致。
   */
  submitAnswer(conversationId: string, text: string): PendingAnswerResult {
    const pending = this.pendingQuestions.get(conversationId);
    if (!pending) return { kind: 'no_match' };

    const current = pending.items[pending.currentIndex];
    if (!current) return { kind: 'no_match' };

    let displayLabel: string | null = null;

    if (text === QA_SUBMIT_SENTINEL && current.kind === 'multi_select') {
      if (current.selectedValues.length === 0) {
        return { kind: 'no_match' };
      }
      const labels = this.labelsForValues(current, current.selectedValues);
      const submissionValue = current.selectedValues.join(' / ');
      const submissionLabel = labels.join(' / ');
      pending.completedAnswers.push({ id: current.id, value: submissionValue, label: submissionLabel });
      this.markItemLabelsStale(pending, current);
      pending.currentIndex++;
      displayLabel = submissionLabel;
    } else if (current.labelToValue.has(text)) {
      const value = current.labelToValue.get(text)!;
      if (current.kind === 'single_select') {
        pending.completedAnswers.push({ id: current.id, value, label: text });
        this.markItemLabelsStale(pending, current);
        pending.currentIndex++;
        displayLabel = text;
      } else {
        if (!current.selectedValues.includes(value)) {
          current.selectedValues.push(value);
        }
        return { kind: 'multi_select_accumulate', displayLabel: text };
      }
    } else if (pending.staleLabels.has(text)) {
      return {
        kind: 'stale',
        staleQuestionIndex: pending.staleLabels.get(text)!,
        currentIndex: pending.currentIndex,
      };
    } else if (current.kind === 'text') {
      // Free-text item: accept any user input as the answer.
      // markItemLabelsStale is a no-op here (current.labelToValue is empty).
      pending.completedAnswers.push({ id: current.id, value: text, label: text });
      this.markItemLabelsStale(pending, current);
      pending.currentIndex++;
      displayLabel = text;
    } else {
      return { kind: 'no_match' };
    }

    // 终态判断
    if (pending.currentIndex >= pending.items.length) {
      this.answerQuestion(conversationId, pending.toolCallId, pending.completedAnswers);
      this.pendingQuestions.delete(conversationId);
      return { kind: 'all_done', displayLabel: displayLabel! };
    }
    return {
      kind: 'item_done',
      displayLabel: displayLabel!,
      currentIndex: pending.currentIndex,
      totalItems: pending.items.length,
    };
  }

  /**
   * Clear the pending question for a conversation (idempotent).
   * Called on answered/cancelled outbound update so no stale state remains.
   */
  clearPendingQuestion(conversationId: string): void {
    this.pendingQuestions.delete(conversationId);
  }

  /**
   * Record every offered label of an item as "stale" before advancing past it.
   * After advance, tapping any of these labels (selected or not) on the old card
   * should be reported as a stale tap rather than fall through to a new agent turn.
   */
  private markItemLabelsStale(pending: IPendingQuestion, item: IPendingItem): void {
    for (const lbl of item.labelToValue.keys()) {
      pending.staleLabels.set(lbl, pending.currentIndex);
    }
  }

  /**
   * Map already-selected submission values back to display labels (multi_select).
   */
  private labelsForValues(item: IPendingItem, values: string[]): string[] {
    const valueToLabel = new Map<string, string>();
    for (const [label, value] of item.labelToValue) {
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
