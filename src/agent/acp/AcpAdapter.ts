/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AcpQuestionData, IMessageAcpQuestion, IMessageAcpToolCall, IMessagePlan, IMessageText, TMessage } from '@/common/chatLib';
import { uuid } from '@/common/utils';
import type { AcpBackend, AcpSessionUpdate, AgentMessageChunkUpdate, AgentThoughtChunkUpdate, PlanUpdate, ToolCallUpdate, ToolCallUpdateStatus } from '@/types/acpTypes';

/**
 * Adapter class to convert ACP messages to AionUI message format
 */
export class AcpAdapter {
  private conversationId: string;
  private backend: AcpBackend;
  private activeToolCalls: Map<string, IMessageAcpToolCall> = new Map();
  private currentMessageId: string | null = uuid(); // Track current message for streaming chunks

  constructor(conversationId: string, backend: AcpBackend) {
    this.conversationId = conversationId;
    this.backend = backend;
  }

  /**
   * Reset message tracking for new message
   * Should be called when a new AI response starts
   */
  resetMessageTracking() {
    this.currentMessageId = uuid();
  }

  /**
   * Get current message ID for streaming chunks
   * Also used for cron command detection to find the accumulated message
   */
  getCurrentMessageId(): string {
    if (!this.currentMessageId) {
      this.currentMessageId = uuid();
    }
    return this.currentMessageId;
  }

  /**
   * Convert ACP session update to AionUI messages
   */
  convertSessionUpdate(sessionUpdate: AcpSessionUpdate): TMessage[] {
    const messages: TMessage[] = [];
    const update = sessionUpdate.update;

    switch (update.sessionUpdate) {
      case 'agent_message_chunk': {
        if (update.content) {
          const message = this.convertSessionUpdateChunk(update);
          if (message) {
            messages.push(message);
          }
        }
        break;
      }

      case 'agent_thought_chunk': {
        if (update.content) {
          const message = this.convertThoughtChunk(update);
          if (message) {
            messages.push(message);
          }
        }
        // Reset message tracking for next agent_message_chunk
        this.resetMessageTracking();
        break;
      }

      case 'tool_call': {
        const toolCallMessage = this.createOrUpdateAcpToolCall(sessionUpdate as ToolCallUpdate);
        if (toolCallMessage) {
          messages.push(toolCallMessage);
        }
        // Reset message tracking so next agent_message_chunk gets new msg_id
        this.resetMessageTracking();
        break;
      }

      case 'tool_call_update': {
        const toolCallUpdateMessage = this.updateAcpToolCall(sessionUpdate as ToolCallUpdateStatus);
        if (toolCallUpdateMessage) {
          messages.push(toolCallUpdateMessage);
        }
        // Reset message tracking so next agent_message_chunk gets new msg_id
        this.resetMessageTracking();
        break;
      }

      case 'plan': {
        const planMessage = this.convertPlanUpdate(sessionUpdate as PlanUpdate);
        if (planMessage) {
          messages.push(planMessage);
        }
        // Reset message tracking so next agent_message_chunk gets new msg_id
        this.resetMessageTracking();
        break;
      }

      // Config option updates (e.g., model switch) are handled by AcpConnection
      // directly in handleIncomingRequest; no chat message conversion needed.
      case 'config_option_update':
        break;

      // Usage updates are emitted directly by AcpAgent; no chat message conversion needed.
      case 'usage_update':
        break;

      // Disabled: available_commands messages are too noisy and distracting in the chat UI
      case 'available_commands_update':
        // Still reset message tracking so next agent_message_chunk gets new msg_id
        this.resetMessageTracking();
        break;

      default: {
        // Handle unexpected session update types
        const unknownUpdate = update as { sessionUpdate?: string };
        console.warn('Unknown session update type:', unknownUpdate.sessionUpdate);
        break;
      }
    }

    return messages;
  }

  /**
   * Convert ACP session update chunk to AionUI message
   */
  private convertSessionUpdateChunk(update: AgentMessageChunkUpdate['update']): TMessage | null {
    const msgId = this.getCurrentMessageId(); // Use consistent msg_id for streaming chunks
    const baseMessage = {
      id: uuid(), // Each chunk still gets unique id (for deduplication in composeMessage)
      msg_id: msgId, // But shares msg_id to enable accumulation
      conversation_id: this.conversationId,
      createdAt: Date.now(),
      position: 'left' as const,
    };

    if (update.content && update.content.text) {
      return {
        ...baseMessage,
        type: 'text',
        content: {
          content: update.content.text,
        },
      } as IMessageText;
    }

    return null;
  }

  /**
   * Convert ACP thought chunk to AionUI message
   */
  private convertThoughtChunk(update: AgentThoughtChunkUpdate['update']): TMessage | null {
    const baseMessage = {
      id: uuid(),
      conversation_id: this.conversationId,
      createdAt: Date.now(),
      position: 'center' as const,
    };

    if (update.content && update.content.text) {
      return {
        ...baseMessage,
        type: 'tips',
        content: {
          content: update.content.text,
          type: 'warning',
        },
      };
    }

    return null;
  }

  private createOrUpdateAcpToolCall(update: ToolCallUpdate): IMessageAcpToolCall | null {
    const toolCallId = update.update.toolCallId;

    const existing = this.activeToolCalls.get(toolCallId);
    if (existing) {
      // Merge: preserve rawInput from earlier phases, content from later phases
      const merged: ToolCallUpdate = {
        ...existing.content,
        update: {
          ...existing.content.update,
          ...update.update,
          rawInput: update.update.rawInput || existing.content.update.rawInput,
          content: update.update.content || existing.content.update.content,
        },
      };
      const updatedMessage: IMessageAcpToolCall = {
        ...existing,
        msg_id: toolCallId,
        content: merged,
        createdAt: Date.now(),
      };
      this.activeToolCalls.set(toolCallId, updatedMessage);
      return updatedMessage;
    }

    // 使用 toolCallId 作为 msg_id，确保同一个工具调用的消息可以被合并
    const baseMessage = {
      id: uuid(),
      msg_id: toolCallId, // 关键：使用 toolCallId 作为 msg_id
      conversation_id: this.conversationId,
      createdAt: Date.now(),
      position: 'left' as const,
    };

    const acpToolCallMessage: IMessageAcpToolCall = {
      ...baseMessage,
      type: 'acp_tool_call',
      content: update, // 直接使用 ToolCallUpdate 作为 content
    };

    this.activeToolCalls.set(toolCallId, acpToolCallMessage);
    return acpToolCallMessage;
  }

  /**
   * Update existing ACP tool call message
   * Returns the updated message with the same msg_id so composeMessage can merge it
   * Also generates text messages for SendUserMessage/AskUserQuestion tool results
   */
  private updateAcpToolCall(update: ToolCallUpdateStatus): IMessageAcpToolCall | null {
    const toolCallData = update.update;
    const toolCallId = toolCallData.toolCallId;

    // Get existing message
    const existingMessage = this.activeToolCalls.get(toolCallId);
    if (!existingMessage) {
      console.warn(`No existing tool call found for ID: ${toolCallId}`);
      return null;
    }

    // Update the ToolCallUpdate content with new status, content, and rawInput
    // rawInput may arrive in tool_call_update with complete data (after streaming completes)
    // This fixes #1113: Claude Code MCP tool calls show empty Input in View Steps panel
    const updatedContent: ToolCallUpdate = {
      ...existingMessage.content,
      update: {
        ...existingMessage.content.update,
        status: toolCallData.status,
        content: toolCallData.content || existingMessage.content.update.content,
        // Merge rawInput if present in the update (complete input after streaming)
        rawInput: toolCallData.rawInput || existingMessage.content.update.rawInput,
      },
    };

    // Create updated message with the SAME msg_id so composeMessage will merge it
    const updatedMessage: IMessageAcpToolCall = {
      ...existingMessage,
      msg_id: toolCallId, // 确保 msg_id 一致，这样 composeMessage 会合并消息
      content: updatedContent,
      createdAt: Date.now(), // 更新时间戳
    };

    // Update stored message
    this.activeToolCalls.set(toolCallId, updatedMessage);

    // Clean up completed/failed tool calls after a delay to prevent memory leaks
    if (toolCallData.status === 'completed' || toolCallData.status === 'failed') {
      setTimeout(() => {
        this.activeToolCalls.delete(toolCallId);
      }, 60000); // Clean up after 1 minute
    }

    // Return the updated message with same msg_id - composeMessage will merge it with existing
    return updatedMessage;
  }

  /**
   * Check if a tool call is a user-facing message tool (SendUserMessage/AskUserQuestion)
   * and generate a text message or interactive question for the UI if so.
   * Called by AcpAgent after processing tool_call_update.
   */
  generateUserMessageFromToolCall(update: ToolCallUpdateStatus): TMessage | null {
    const toolCallId = update.update.toolCallId;
    const existingMessage = this.activeToolCalls.get(toolCallId);
    if (!existingMessage) return null;

    const toolName = existingMessage.content.update.title;
    if (toolName !== 'SendUserMessage' && toolName !== 'AskUserQuestion') {
      return null;
    }

    // Only generate message when tool completes
    if (update.update.status !== 'completed') return null;

    // Parse the tool result to extract the message
    const content = update.update.content;
    if (!content || content.length === 0) return null;

    try {
      const resultText = content[0]?.content?.text;
      if (!resultText) return null;

      const result = JSON.parse(resultText) as { message?: string; question?: string; answer?: string; options?: string[] };

      // For SendUserMessage, display as plain text message
      if (toolName === 'SendUserMessage' && result.message) {
        return {
          id: uuid(),
          type: 'text',
          msg_id: `${toolCallId}-user-msg`,
          conversation_id: this.conversationId,
          createdAt: Date.now(),
          position: 'left',
          content: {
            content: result.message,
          },
        } as IMessageText;
      }

      // For AskUserQuestion, generate an interactive question card with clickable options
      if (toolName === 'AskUserQuestion' && result.question) {
        const options = result.options || [];

        // If there are options, show interactive question card
        if (options.length > 0) {
          return {
            id: uuid(),
            type: 'acp_question',
            msg_id: `${toolCallId}-user-msg`,
            conversation_id: this.conversationId,
            createdAt: Date.now(),
            position: 'left',
            content: {
              question: result.question,
              options,
              conversationId: this.conversationId,
              answered: false,
            },
          } as IMessageAcpQuestion;
        }

        // No options available, fallback to plain text display
        let displayText = result.question;
        if (result.answer) {
          displayText += `\n\n**回答**: ${result.answer}`;
        }

        return {
          id: uuid(),
          type: 'text',
          msg_id: `${toolCallId}-user-msg`,
          conversation_id: this.conversationId,
          createdAt: Date.now(),
          position: 'left',
          content: {
            content: displayText,
          },
        } as IMessageText;
      }

      return null;
    } catch {
      // JSON parse failed, ignore
      return null;
    }
  }

  /**
   * Convert plan update to AionUI message
   */
  private convertPlanUpdate(update: PlanUpdate): IMessagePlan | null {
    const baseMessage = {
      id: uuid(),
      msg_id: uuid(), // 生成独立的 msg_id，避免与其他消息合并
      conversation_id: this.conversationId,
      createdAt: Date.now(),
      position: 'left' as const,
    };

    const planData = update.update;
    if (planData.entries && planData.entries.length > 0) {
      return {
        ...baseMessage,
        type: 'plan',
        content: {
          sessionId: update.sessionId,
          entries: planData.entries,
        },
      };
    }

    return null;
  }

  // Removed: convertAvailableCommandsUpdate - available_commands messages are too noisy and distracting in the chat UI
}
