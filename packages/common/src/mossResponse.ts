/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description Pure moss-stream → IResponseMessage mapper shared by the desktop
 * `MossWsConnection` and the apps/webui bridge adapter, so both paths render moss
 * frames through ONE implementation (DRY).
 *
 * Leaf module: it only TYPE-imports from sibling `@sudowork/common` files and has
 * no app / `@sudowork/host-bridge` / node / electron / `@/` runtime dependency, so
 * it builds cleanly under `bun run build:packages`.
 *
 * Scope is the STATELESS frame types (result / system / tool_use / assistant /
 * tool_progress / tool_use_summary / streamlined_*). The stateful / effectful
 * frames (`hello` session capture, `control_response` interrupt confirmation,
 * `control_request` permission prompt) and the unparseable-line text fallback
 * are the CALLER's responsibility — `hello`, `control_response` and
 * `control_request` return `[]` here on purpose. `control_request` still has a
 * shared pure HELPER (`mossControlRequestToConfirmation`) converting its
 * request payload into an `IConfirmation`; routing/effect stays caller-side.
 */

import type { IConfirmation, IResponseMessage } from './chatTypes.js';

export interface MossResponseCtx {
  /** moss session id, stamped onto emitted `acp_tool_call` updates as `sessionId`. */
  sessionId: string;
  /**
   * `conversation_id` stamped on every emitted message. Desktop passes `''`
   * (matching its historical behavior); web passes the session id. Defaults to `''`.
   */
  conversationId?: string;
  /** Fresh `msg_id` generator used whenever a frame carries no `uuid`. */
  nextMsgId: () => string;
}

export function extractTextFromContent(content: any): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((item: any) => item?.type === 'text')
    .map((item: any) => item.text || '')
    .join('');
}

function parseToolInput(input: unknown): Record<string, unknown> {
  if (!input) return {};
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return { input };
    }
  }
  return typeof input === 'object' ? (input as Record<string, unknown>) : { input };
}

export function isUserAbortError(msg: any): boolean {
  if (msg.result_type === 'user') return true;
  const errorMsg = msg.errors?.join('\n') || msg.result || '';
  if (errorMsg.includes('Request was aborted') || errorMsg.includes('AbortError') || errorMsg.includes('aborted by user') || errorMsg.includes('user abort')) return true;
  if (msg.stop_reason === 'abort' || msg.stop_reason === 'user_abort') return true;
  return false;
}

function isAbortRelatedText(text: string): boolean {
  const lowerText = text.toLowerCase();
  return lowerText.includes('request interrupted by user') || lowerText.includes('request was aborted') || lowerText.includes('no response requested') || lowerText.includes('aborted by user') || lowerText.includes('interrupted by user');
}

/**
 * Map one moss stream frame to zero or more `IResponseMessage`s. A single frame
 * (e.g. an `assistant` message with several content blocks) may yield several
 * responses. Faithfully mirrors the desktop `MossWsConnection.processParsedMessage`
 * mapping for the stateless frame types.
 */
export function mossFrameToResponses(frame: any, ctx: MossResponseCtx): IResponseMessage[] {
  const out: IResponseMessage[] = [];
  if (!frame || typeof frame !== 'object') return out;

  const conversationId = ctx.conversationId ?? '';

  // Stateful / effectful frames are the caller's job.
  if (frame.type === 'hello' || frame.type === 'control_response' || frame.type === 'control_request') {
    return out;
  }

  if (frame.type === 'result') {
    const isUserAbort = isUserAbortError(frame);

    if ((frame.is_error || frame.subtype?.startsWith('error_')) && !isUserAbort) {
      const errorMsg = frame.errors?.join('\n') || frame.result || 'Session ended with error';
      out.push({
        type: 'error',
        msg_id: frame.uuid || ctx.nextMsgId(),
        conversation_id: conversationId,
        data: errorMsg,
      });
    }

    out.push({
      type: 'finish',
      msg_id: frame.uuid || ctx.nextMsgId(),
      conversation_id: conversationId,
      data: {
        subtype: frame.subtype,
        duration_ms: frame.duration_ms,
        total_cost_usd: frame.total_cost_usd,
        usage: frame.usage,
        num_turns: frame.num_turns,
        isUserAbort,
      },
    });
    return out;
  }

  if (frame.type === 'system') {
    if (frame.subtype === 'init' || frame.subtype === 'model_changed') {
      const modelName = frame.model || 'unknown';
      // Remove proxy/ prefix for display / 移除 proxy/ 前缀用于显示
      const displayLabel = modelName.startsWith('proxy/') ? modelName.slice(6) : modelName;
      out.push({
        type: 'acp_model_info',
        msg_id: ctx.nextMsgId(),
        conversation_id: conversationId,
        data: {
          source: 'models',
          currentModelId: modelName,
          currentModelLabel: displayLabel,
          canSwitch: false,
          availableModels: [],
        },
      });
    }
    return out;
  }

  if (frame.type === 'tool_use') {
    const toolName = frame.name || frame.tool_name || '';
    const toolUseId = frame.tool_use_id || frame.id || frame.uuid || ctx.nextMsgId();
    const responseToolUseId = frame.uuid || toolUseId;
    const rawInput = parseToolInput(frame.input);
    // For AskUserQuestion, we need the _request_id to send RPC response
    const requestId = frame._request_id;
    // Check if this is a completion status update
    const toolStatus = frame.status;

    if (toolName === 'AskUserQuestion') {
      const question = typeof rawInput.question === 'string' ? rawInput.question : '';
      const description = typeof rawInput.description === 'string' ? rawInput.description : undefined;
      const options = Array.isArray(rawInput.options) ? rawInput.options.filter((option): option is string => typeof option === 'string') : [];

      out.push({
        type: 'acp_question',
        msg_id: toolUseId,
        conversation_id: conversationId,
        data: {
          question: question || description || 'Question',
          intro: description,
          options,
          conversationId: ctx.conversationId ?? '',
          toolCallId: toolUseId,
          responseToolCallId: responseToolUseId,
          answered: false,
          // Pass requestId so the answer can be sent as RPC response
          _request_id: requestId,
        },
      });
      return out;
    }

    // If status is 'completed', send as tool_call_update to mark tool as complete
    if (toolStatus === 'completed') {
      out.push({
        type: 'acp_tool_call',
        msg_id: toolUseId,
        conversation_id: conversationId,
        data: {
          sessionId: ctx.sessionId,
          update: {
            sessionUpdate: 'tool_call_update',
            toolCallId: toolUseId,
            status: 'completed',
            content: [],
          },
        },
      });
      return out;
    }

    out.push({
      type: 'acp_tool_call',
      msg_id: toolUseId,
      conversation_id: conversationId,
      data: {
        sessionId: ctx.sessionId,
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: toolUseId,
          status: 'pending',
          title: toolName || 'Tool',
          kind: 'execute',
          rawInput,
          content: [],
        },
      },
    });
    return out;
  }

  if (frame.type === 'assistant') {
    if (frame.error || frame.isApiErrorMessage) {
      const errorMsg = extractTextFromContent(frame.message?.content) || frame.error || 'Unknown error';
      out.push({
        type: 'error',
        msg_id: frame.uuid || ctx.nextMsgId(),
        conversation_id: conversationId,
        data: errorMsg,
      });
      return out;
    }

    const contentArray = frame.message?.content;
    if (Array.isArray(contentArray)) {
      for (const block of contentArray) {
        if (block?.type === 'thinking') {
          const thinkingContent = block.thinking || block.text || '';
          if (thinkingContent && thinkingContent.trim()) {
            out.push({
              type: 'thought',
              msg_id: `${frame.uuid || ctx.nextMsgId()}-thought`,
              conversation_id: conversationId,
              data: { subject: 'Thinking', description: thinkingContent },
            });
          }
        } else if (block?.type === 'text') {
          const textContent = block.text || '';
          if (textContent && textContent.trim() && !isAbortRelatedText(textContent)) {
            out.push({
              type: 'content',
              msg_id: frame.uuid || ctx.nextMsgId(),
              conversation_id: conversationId,
              data: textContent,
            });
          }
        } else if (block?.type === 'tool_use') {
          out.push({
            type: 'acp_tool_call',
            msg_id: block.id || ctx.nextMsgId(),
            conversation_id: conversationId,
            data: {
              sessionId: ctx.sessionId,
              update: {
                sessionUpdate: 'tool_call',
                toolCallId: block.id || ctx.nextMsgId(),
                status: 'pending',
                title: block.name,
                kind: 'execute',
                rawInput: block.input,
                content: [],
              },
            },
          });
        }
      }
    } else {
      const content = extractTextFromContent(contentArray);
      if (content && content.trim() && !isAbortRelatedText(content)) {
        out.push({
          type: 'content',
          msg_id: frame.uuid || ctx.nextMsgId(),
          conversation_id: conversationId,
          data: content,
        });
      }
    }
    return out;
  }

  if (frame.type === 'tool_progress') {
    out.push({
      type: 'acp_tool_call',
      msg_id: frame.tool_use_id || ctx.nextMsgId(),
      conversation_id: conversationId,
      data: {
        sessionId: ctx.sessionId,
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: frame.tool_use_id || ctx.nextMsgId(),
          status: 'in_progress',
          content: [{ type: 'content', content: { type: 'text', text: `Executing... (${frame.elapsed_time_seconds}s)` } }],
        },
      },
    });
    return out;
  }

  if (frame.type === 'tool_use_summary') {
    out.push({
      type: 'content',
      msg_id: frame.uuid || ctx.nextMsgId(),
      conversation_id: conversationId,
      data: `[Tool Summary] ${frame.summary}`,
    });
    return out;
  }

  if (frame.type === 'streamlined_text') {
    if (frame.text && frame.text.trim()) {
      out.push({
        type: 'content',
        msg_id: frame.uuid || ctx.nextMsgId(),
        conversation_id: conversationId,
        data: frame.text,
      });
    }
    return out;
  }

  if (frame.type === 'streamlined_tool_use_summary') {
    out.push({
      type: 'content',
      msg_id: frame.uuid || ctx.nextMsgId(),
      conversation_id: conversationId,
      data: `[Tool Summary] ${frame.tool_summary}`,
    });
    return out;
  }

  // Any other frame type (user / stream_event / rate_limit_event / auth_status /
  // prompt_suggestion / unknown / plain-text fallback) is handled by the caller.
  return out;
}

/**
 * Convert a moss `control_request` permission prompt into the shared
 * `IConfirmation` shape. Faithfully mirrors the desktop `RemoteAgent
 * .handlePermissionRequest` mapping (title/description/options + the
 * allow_once/allow_always/reject_once fallback). Routing the confirmation to
 * the UI and answering it back over the WS stay caller-side.
 */
export function mossControlRequestToConfirmation(request: any, requestId: string): IConfirmation {
  return {
    id: requestId,
    callId: requestId,
    title: request.title || request.tool_name || 'Permission Required',
    description: JSON.stringify(request.rawInput || request.input || {}),
    options:
      request.options?.map((opt: any) => ({
        label: opt.name || opt,
        value: opt.optionId || opt,
      })) || [
        { label: 'Allow', value: 'allow_once' },
        { label: 'Always Allow', value: 'allow_always' },
        { label: 'Reject', value: 'reject_once' },
      ],
  };
}
