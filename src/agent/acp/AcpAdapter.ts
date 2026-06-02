/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AcpQuestionData, AcpQuestionItem, AcpQuestionItemKind, AcpQuestionItemOption, IMessageAcpQuestion, IMessageAcpToolCall, IMessagePlan, IMessageText, TMessage } from '@/common/chatLib';
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

  private createQuestionMessage(toolCallId: string, questionData: AcpQuestionData): IMessageAcpQuestion {
    return {
      id: uuid(),
      type: 'acp_question',
      msg_id: `${toolCallId}-user-msg`,
      conversation_id: this.conversationId,
      createdAt: Date.now(),
      position: 'left',
      content: questionData,
    };
  }

  private normalizeKind(value: unknown, hasOptions: boolean): AcpQuestionItemKind | undefined {
    if (typeof value !== 'string') return hasOptions ? 'single_select' : undefined;
    const normalized = value.trim();
    if (normalized === 'single_select' || normalized === 'multi_select' || normalized === 'text' || normalized === 'boolean') {
      return normalized;
    }
    return hasOptions ? 'single_select' : undefined;
  }

  private normalizeQuestionItems(items: unknown): AcpQuestionItem[] {
    if (!Array.isArray(items)) return [];
    return items
      .map((item, index) => {
        if (!item || typeof item !== 'object') return null;
        const candidate = item as Record<string, unknown>;
        const prompt = typeof candidate.prompt === 'string' ? candidate.prompt.trim() : '';
        if (!prompt) return null;
        const options = Array.isArray(candidate.options)
          ? candidate.options
              .map((option) => {
                if (!option || typeof option !== 'object') return null;
                const optionRecord = option as Record<string, unknown>;
                const label = typeof optionRecord.label === 'string' ? optionRecord.label.trim() : '';
                const value = typeof optionRecord.value === 'string' ? optionRecord.value.trim() : '';
                const finalLabel = label || value;
                const finalValue = value || label;
                if (!finalLabel && !finalValue) return null;
                const normalized: AcpQuestionItemOption = {
                  label: finalLabel,
                  value: finalValue,
                  description: typeof optionRecord.description === 'string' ? optionRecord.description : undefined,
                  recommended: optionRecord.recommended === true,
                };
                return normalized;
              })
              .filter((option): option is AcpQuestionItemOption => Boolean(option))
          : [];

        const normalized: AcpQuestionItem = {
          id: typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id.trim() : `q${index + 1}`,
          prompt,
          kind: this.normalizeKind(candidate.kind, options.length > 0),
          options,
          allowCustomInput: candidate.allowCustomInput === true,
          customInputHint: typeof candidate.customInputHint === 'string' ? candidate.customInputHint : undefined,
          optional: candidate.required === false || candidate.optional === true,
        };
        return normalized;
      })
      .filter((item): item is AcpQuestionItem => Boolean(item));
  }

  private buildQuestionData(raw: { title?: unknown; description?: unknown; question?: unknown; questions?: unknown }, toolCallId: string): AcpQuestionData | null {
    const items = this.normalizeQuestionItems(raw.questions);
    if (items.length === 0) {
      const legacyQuestion = typeof raw.question === 'string' ? raw.question.trim() : '';
      if (!legacyQuestion) return null;
      return {
        question: legacyQuestion,
        options: [],
        items: [
          {
            id: 'q1',
            prompt: legacyQuestion,
            allowCustomInput: true,
            optional: false,
          },
        ],
        conversationId: this.conversationId,
        toolCallId,
        answered: false,
      };
    }

    const title = typeof raw.title === 'string' ? raw.title.trim() : '';
    const description = typeof raw.description === 'string' ? raw.description.trim() : '';
    const fallbackQuestion = typeof raw.question === 'string' ? raw.question.trim() : '';

    return {
      question: title || description || fallbackQuestion || items[0]?.prompt || 'Question',
      intro: description || title || undefined,
      options: [],
      items,
      conversationId: this.conversationId,
      toolCallId,
      answered: false,
    };
  }

  private buildAnswerItems(answer: string, items?: AcpQuestionItem[]): AcpQuestionData['answerItems'] {
    if (!answer || !items || items.length === 0) return undefined;

    const normalized = answer.replace(/\r\n/g, '\n').trim();
    if (!normalized) return undefined;

    const lines = normalized
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const structured = lines
      .map((line) => {
        const match = line.match(/^Q(\d+):\s*(.*)$/i);
        if (!match) return null;
        const index = Number(match[1]);
        const item = items[index - 1];
        if (!item) return null;
        const submissionValue = (match[2] || '').trim();
        return {
          id: item.id,
          index,
          submissionValue,
          displayValue: submissionValue === '[skipped]' ? '' : submissionValue,
          skipped: submissionValue === '[skipped]',
        };
      })
      .filter(Boolean) as NonNullable<AcpQuestionData['answerItems']>;

    if (structured.length > 0) {
      return structured;
    }

    if (items.length === 1) {
      return [
        {
          id: items[0].id,
          index: 1,
          submissionValue: normalized,
          displayValue: normalized === '[skipped]' ? '' : normalized,
          skipped: normalized === '[skipped]',
        },
      ];
    }

    return undefined;
  }

  private buildAnswerItemsFromStructuredAnswers(answers: Array<{ id?: string; value?: string; label?: string }>, items?: AcpQuestionItem[]): AcpQuestionData['answerItems'] {
    if (!items || items.length === 0 || answers.length === 0) return undefined;

    const itemById = new Map(items.map((item, index) => [item.id, { item, index }]));
    const normalized = answers
      .map((answer, fallbackIndex) => {
        const answerId = typeof answer.id === 'string' ? answer.id : '';
        const resolved = answerId ? itemById.get(answerId) : undefined;
        const index = resolved ? resolved.index + 1 : fallbackIndex + 1;
        const itemId = resolved ? resolved.item.id : `q${index}`;
        const submissionValue = String(answer.value || '').trim();
        const displayValue = String(answer.label || answer.value || '').trim();
        const skipped = !submissionValue;
        return {
          id: itemId,
          index,
          submissionValue: submissionValue || '[skipped]',
          displayValue,
          skipped,
        };
      })
      .filter((answer) => answer.id && answer.index > 0);

    return normalized.length > 0 ? normalized : undefined;
  }

  buildQuestionMessageFromToolCall(update: ToolCallUpdate | ToolCallUpdateStatus): IMessageAcpQuestion | null {
    const toolCallId = update.update.toolCallId;
    const existingMessage = this.activeToolCalls.get(toolCallId);
    const toolName = existingMessage?.content.update.title || ('title' in update.update ? update.update.title : undefined);

    if (toolName !== 'AskUserQuestion') {
      return null;
    }

    const rawInput = ('rawInput' in update.update ? update.update.rawInput : undefined) as Record<string, unknown> | undefined;
    const fromRawInput = this.buildQuestionData(
      {
        title: rawInput?.title,
        description: rawInput?.description,
        question: rawInput?.question,
        questions: rawInput?.questions,
      },
      toolCallId
    );

    if (fromRawInput) {
      return this.createQuestionMessage(toolCallId, fromRawInput);
    }

    const content = 'content' in update.update ? update.update.content : undefined;
    const resultText = content?.[0]?.type === 'content' ? content[0]?.content?.text : undefined;
    if (!resultText) return null;

    try {
      const parsed = JSON.parse(resultText) as { title?: unknown; description?: unknown; question?: unknown; questions?: unknown };
      const questionData = this.buildQuestionData(parsed, toolCallId);
      return questionData ? this.createQuestionMessage(toolCallId, questionData) : null;
    } catch {
      return null;
    }
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

      const result = JSON.parse(resultText) as {
        message?: string;
        question?: string;
        answer?: string;
        title?: unknown;
        description?: unknown;
        questions?: unknown;
        answers?: Array<{ id?: string; value?: string; label?: string }>;
      };

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

      // For AskUserQuestion, prefer interactive question cards
      if (toolName === 'AskUserQuestion' && (result.questions || result.question)) {
        const questionMessage = this.buildQuestionMessageFromToolCall(update);
        if (questionMessage) {
          const answerItems = Array.isArray(result.answers) && result.answers.length > 0 ? this.buildAnswerItemsFromStructuredAnswers(result.answers, questionMessage.content.items) : this.buildAnswerItems(result.answer || '', questionMessage.content.items);

          if (answerItems && answerItems.length > 0) {
            questionMessage.content.answered = true;
            questionMessage.content.answerItems = answerItems;
            questionMessage.content.selectedAnswer = answerItems.map((answer) => `${answer.index}. ${answer.skipped ? '[skipped]' : answer.displayValue}`).join('\n');
            return questionMessage;
          }

          if (result.answer) {
            questionMessage.content.answered = true;
            questionMessage.content.selectedAnswer = result.answer;
            questionMessage.content.answerItems = this.buildAnswerItems(result.answer, questionMessage.content.items);
            return questionMessage;
          }

          return null;
        }

        if (!result.answer) {
          return null;
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
