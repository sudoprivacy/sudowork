/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { EventEmitter } from 'events';
import type { IResponseMessage } from '@/common/ipcBridge';

/**
 * Approval event data — emitted when a tool requires user confirmation
 */
export type IApprovalPendingEvent = {
  conversationId: string;
  requestId: string;
  callId: string;
  toolName: string;
  description: string;
};

/**
 * Approval resolved event data — emitted when user approves or denies
 */
export type IApprovalResolvedEvent = {
  conversationId: string;
  requestId: string;
  callId: string;
  optionId: string;
};

/**
 * SudoClaw notification urgency levels
 */
export type SudoClawUrgency = 'info' | 'action_needed' | 'completed';

/**
 * SudoClaw notification event data
 */
export interface ISudoClawNotificationEvent {
  /** Notification title */
  title: string;
  /** Notification body / message */
  body: string;
  /** Urgency level for routing decisions */
  urgency: SudoClawUrgency;
  /** Optional conversation ID associated with this notification */
  conversationId?: string;
  /** Optional metadata for downstream consumers */
  metadata?: Record<string, unknown>;
}

/**
 * Channel 全局事件类型
 * Channel global event types
 */
export const ChannelEvents = {
  /** Agent 消息事件 / Agent message event */
  AGENT_MESSAGE: 'channel.agent.message',
  /** Tool approval pending — agent is waiting for user confirmation */
  APPROVAL_PENDING: 'channel.approval.pending',
  /** Tool approval resolved — user has approved or denied */
  APPROVAL_RESOLVED: 'channel.approval.resolved',
  /** SudoClaw 通知事件 / SudoClaw notification event */
  SUDOCLAW_NOTIFICATION: 'sudoclaw-notification',
} as const;

/**
 * Agent 消息事件数据
 * Agent message event data
 */
export interface IAgentMessageEvent extends IResponseMessage {
  conversation_id: string;
}

/**
 * ChannelEventBus - 全局事件总线
 *
 * 用于 Agent 消息的全局分发，解耦 ChannelMessageService 与 Agent Task
 *
 * Usage:
 * ```typescript
 * // 发送事件（在 AgentManager 中）
 * channelEventBus.emitAgentMessage(conversationId, data);
 *
 * // 监听事件（在 ChannelMessageService 中）
 * channelEventBus.onAgentMessage((event) => {
 *   // 处理消息
 * });
 * ```
 */
class ChannelEventBus extends EventEmitter {
  constructor() {
    super();
    // 增加监听器上限，避免警告
    this.setMaxListeners(100);
  }

  /**
   * 发送 Agent 消息事件
   * Emit agent message event
   */
  emitAgentMessage(conversationId: string, data: IResponseMessage): void {
    const event: IAgentMessageEvent = {
      ...data,
      conversation_id: conversationId,
    };
    this.emit(ChannelEvents.AGENT_MESSAGE, event);
  }

  /**
   * 监听 Agent 消息事件
   * Listen to agent message event
   */
  onAgentMessage(handler: (event: IAgentMessageEvent) => void): () => void {
    this.on(ChannelEvents.AGENT_MESSAGE, handler);
    return () => {
      this.off(ChannelEvents.AGENT_MESSAGE, handler);
    };
  }

  /**
   * 移除 Agent 消息监听器
   * Remove agent message listener
   */
  offAgentMessage(handler: (event: IAgentMessageEvent) => void): void {
    this.off(ChannelEvents.AGENT_MESSAGE, handler);
  }

  /**
   * Emit approval-pending event (tool requires user confirmation)
   */
  emitApprovalPending(event: IApprovalPendingEvent): void {
    this.emit(ChannelEvents.APPROVAL_PENDING, event);
  }

  /**
   * Listen for approval-pending events
   */
  onApprovalPending(handler: (event: IApprovalPendingEvent) => void): () => void {
    this.on(ChannelEvents.APPROVAL_PENDING, handler);
    return () => {
      this.off(ChannelEvents.APPROVAL_PENDING, handler);
    };
  }

  /**
   * Emit approval-resolved event (user approved or denied)
   */
  emitApprovalResolved(event: IApprovalResolvedEvent): void {
    this.emit(ChannelEvents.APPROVAL_RESOLVED, event);
  }

  /**
   * Listen for approval-resolved events
   */
  onApprovalResolved(handler: (event: IApprovalResolvedEvent) => void): () => void {
    this.on(ChannelEvents.APPROVAL_RESOLVED, handler);
    return () => {
      this.off(ChannelEvents.APPROVAL_RESOLVED, handler);
    };
  }

  /**
   * Emit SudoClaw notification event
   */
  emitSudoClawNotification(event: ISudoClawNotificationEvent): void {
    this.emit(ChannelEvents.SUDOCLAW_NOTIFICATION, event);
  }

  /**
   * Listen to SudoClaw notification event
   */
  onSudoClawNotification(handler: (event: ISudoClawNotificationEvent) => void): () => void {
    this.on(ChannelEvents.SUDOCLAW_NOTIFICATION, handler);
    return () => {
      this.off(ChannelEvents.SUDOCLAW_NOTIFICATION, handler);
    };
  }
}

// 单例
export const channelEventBus = new ChannelEventBus();
