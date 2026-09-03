/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description 跟对话相关的消息类型申明 —— 纯类型，无运行时依赖，供主进程、渲染层
 * 与共享渲染包共用同一份声明；chatLib 的消息 transform 运行时从此模块 re-export 这些类型。
 */

import type { AcpBackend, AcpPermissionRequest, PlanUpdate, ToolCallUpdate } from './acpTypes.js';
import type { CodexPermissionRequest } from './codex/types/index.js';
import type {
  ExecCommandBeginData,
  ExecCommandEndData,
  ExecCommandOutputDeltaData,
  McpToolCallBeginData,
  McpToolCallEndData,
  PatchApplyBeginData,
  PatchApplyEndData,
  TurnDiffData,
  WebSearchBeginData,
  WebSearchEndData,
} from './codex/types/eventData.js';

type TMessageType = 'text' | 'tips' | 'thought' | 'tool_call' | 'tool_group' | 'agent_status' | 'acp_permission' | 'acp_question' | 'acp_tool_call' | 'codex_permission' | 'codex_tool_call' | 'plan' | 'available_commands' | 'file_send';

interface IMessage<T extends TMessageType, Content extends Record<string, any>> {
  /**
   * 唯一ID
   */
  id: string;
  /**
   * 消息来源ID，
   */
  msg_id?: string;

  //消息会话ID
  conversation_id: string;
  /**
   * 消息类型
   */
  type: T;
  /**
   * 消息内容
   */
  content: Content;
  /**
   * 消息创建时间
   */
  createdAt?: number;
  /**
   * 消息位置
   */
  position?: 'left' | 'right' | 'center' | 'pop';
  /**
   * 消息状态
   */
  status?: 'finish' | 'pending' | 'error' | 'work';
}

export type CronMessageMeta = {
  source: 'cron';
  cronJobId: string;
  cronJobName: string;
  triggeredAt: number;
};

export interface TurnTokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens: number;
  cachedReadTokens?: number | null;
  cachedWriteTokens?: number | null;
  thoughtTokens?: number | null;
  contextWindowTokens?: number | null;
  estimatedSessionTokens?: number | null;
  costUnits?: number | null;
  costCurrency?: string | null;
}

export type IMessageText = IMessage<'text', { content: string; cronMeta?: CronMessageMeta; skills?: string[]; tokenUsage?: TurnTokenUsage }>;

export type IMessageTips = IMessage<
  'tips',
  {
    content: string;
    type: 'error' | 'success' | 'warning';
    /**
     * When set, this tip is a CLASSIFIED runtime error and the renderer
     * should render a differentiated RuntimeErrorBanner instead of the
     * plain text tip. Carried alongside (not replacing) `content` so
     * legacy receivers / channels / WebUI logs keep working. See
     * src/common/runtime-errors.ts for the class union.
     */
    errorClass?: string;
    /** Bytes of the offending payload, for size-driven error classes. */
    errorBytes?: number;
  }
>;

/**
 * Model reasoning (thinking) content. Each emission carries the FULL accumulated
 * text for one reasoning block, so merging replaces content instead of appending.
 */
export type IMessageThought = IMessage<
  'thought',
  {
    subject: string;
    description: string;
  }
>;

export type IMessageToolCall = IMessage<
  'tool_call',
  {
    callId: string;
    name: string;
    args: Record<string, any>;
    error?: string;
    status?: 'success' | 'error';
  }
>;

type IMessageToolGroupConfirmationDetailsBase<Type, Extra extends Record<string, any>> = {
  type: Type;
  title: string;
} & Extra;

export type IMessageToolGroup = IMessage<
  'tool_group',
  Array<{
    callId: string;
    description: string;
    name: string;
    renderOutputAsMarkdown: boolean;
    resultDisplay?:
      | string
      | {
          fileDiff: string;
          fileName: string;
        }
      | {
          img_url: string;
          relative_path: string;
        };
    status: 'Executing' | 'Success' | 'Error' | 'Canceled' | 'Pending' | 'Confirming';
    confirmationDetails?:
      | IMessageToolGroupConfirmationDetailsBase<
          'edit',
          {
            fileName: string;
            fileDiff: string;
            isModifying?: boolean;
          }
        >
      | IMessageToolGroupConfirmationDetailsBase<
          'exec',
          {
            rootCommand: string;
            command: string;
          }
        >
      | IMessageToolGroupConfirmationDetailsBase<
          'info',
          {
            urls?: string[];
            prompt: string;
          }
        >
      | IMessageToolGroupConfirmationDetailsBase<
          'mcp',
          {
            toolName: string;
            toolDisplayName: string;
            serverName: string;
          }
        >;
  }>
>;

// Unified agent status message type for all ACP-based agents (Claude, Qwen, Codex, etc.)
export type IMessageAgentStatus = IMessage<
  'agent_status',
  {
    backend: AcpBackend; // Agent identifier: 'claude', 'qwen', 'codex', etc.
    status: 'connecting' | 'connected' | 'authenticated' | 'session_active' | 'disconnected' | 'error';
    /** Display name for the agent (e.g. extension-contributed adapter name) / Agent 显示名称 */
    agentName?: string;
    // Optional legacy fields for backward compatibility
    sessionId?: string;
    isConnected?: boolean;
    hasActiveSession?: boolean;
  }
>;

export type IMessageAcpPermission = IMessage<'acp_permission', AcpPermissionRequest>;

export type AcpQuestionItemKind = 'single_select' | 'multi_select' | 'text' | 'boolean';

export interface AcpQuestionItemOption {
  /** User-facing label */
  label: string;
  /** Backing submission value */
  value: string;
  /** Optional explanatory description */
  description?: string;
  /** Recommended option highlighted in UI */
  recommended?: boolean;
}

export interface AcpQuestionItem {
  /** Stable key for local form state */
  id: string;
  /** Prompt text for the individual question */
  prompt: string;
  /** Question kind controlling UI rendering */
  kind?: AcpQuestionItemKind;
  /** Suggested or strict options for this question */
  options?: AcpQuestionItemOption[];
  /** Whether free-form input is allowed */
  allowCustomInput?: boolean;
  /** Optional hint shown when custom input is enabled */
  customInputHint?: string;
  /** Whether the question can be left blank */
  optional?: boolean;
}

export interface AcpQuestionAnswerItem {
  /** Stable key matching AcpQuestionItem.id */
  id: string;
  /** Question index starting from 1 */
  index: number;
  /** User-visible display value */
  displayValue: string;
  /** Structured submission value */
  submissionValue: string;
  /** Whether the answer was skipped */
  skipped?: boolean;
}

/** ACP Question request data (from AskUserQuestion tool) */
export interface AcpQuestionData {
  /** The question text to display */
  question: string;
  /** Optional intro/header text for multi-question prompts */
  intro?: string;
  /** Clickable options for the user to select (legacy single-question shape) */
  options: string[];
  /** Parsed question items for multi-question prompts */
  items?: AcpQuestionItem[];
  /** The conversation ID to send the answer back to */
  conversationId: string;
  /** The originating tool call ID */
  toolCallId?: string;
  /** The Moss ACP prompt id to use when replying with a tool_result */
  responseToolCallId?: string;
  /** Whether the question has been answered */
  answered?: boolean;
  /** Whether the question was cancelled (user stopped or timed out) before being answered */
  cancelled?: boolean;
  /** The selected answer (set after user responds) */
  selectedAnswer?: string;
  /** Per-question answer state for consistent hydration */
  answerItems?: AcpQuestionAnswerItem[];
}

export type IMessageAcpQuestion = IMessage<'acp_question', AcpQuestionData>;

export type IMessageAcpToolCall = IMessage<'acp_tool_call', ToolCallUpdate>;

export type IMessageCodexPermission = IMessage<'codex_permission', CodexPermissionRequest>;

// Base interface for all tool call updates
interface BaseCodexToolCallUpdate {
  toolCallId: string;
  status: 'pending' | 'executing' | 'success' | 'error' | 'canceled';
  title?: string; // Optional - can be derived from data or kind
  kind: 'execute' | 'patch' | 'mcp' | 'web_search';

  // UI display data
  description?: string;
  content?: Array<{
    type: 'text' | 'diff' | 'output';
    text?: string;
    output?: string;
    filePath?: string;
    oldText?: string;
    newText?: string;
  }>;

  // Timing
  startTime?: number;
  endTime?: number;
}

// Specific subtypes using the original event data structures
export type CodexToolCallUpdate =
  | (BaseCodexToolCallUpdate & {
      subtype: 'exec_command_begin';
      data: ExecCommandBeginData;
    })
  | (BaseCodexToolCallUpdate & {
      subtype: 'exec_command_output_delta';
      data: ExecCommandOutputDeltaData;
    })
  | (BaseCodexToolCallUpdate & {
      subtype: 'exec_command_end';
      data: ExecCommandEndData;
    })
  | (BaseCodexToolCallUpdate & {
      subtype: 'patch_apply_begin';
      data: PatchApplyBeginData;
    })
  | (BaseCodexToolCallUpdate & {
      subtype: 'patch_apply_end';
      data: PatchApplyEndData;
    })
  | (BaseCodexToolCallUpdate & {
      subtype: 'mcp_tool_call_begin';
      data: McpToolCallBeginData;
    })
  | (BaseCodexToolCallUpdate & {
      subtype: 'mcp_tool_call_end';
      data: McpToolCallEndData;
    })
  | (BaseCodexToolCallUpdate & {
      subtype: 'web_search_begin';
      data: WebSearchBeginData;
    })
  | (BaseCodexToolCallUpdate & {
      subtype: 'web_search_end';
      data: WebSearchEndData;
    })
  | (BaseCodexToolCallUpdate & {
      subtype: 'turn_diff';
      data: TurnDiffData;
    })
  | (BaseCodexToolCallUpdate & {
      subtype: 'generic';
      data?: any; // For generic updates that don't map to specific events
    });

export type IMessageCodexToolCall = IMessage<'codex_tool_call', CodexToolCallUpdate>;

export type IMessagePlan = IMessage<
  'plan',
  {
    sessionId: string;
    entries: PlanUpdate['update']['entries'];
  }
>;

// Available commands from ACP agents (Claude, etc.)
export type AvailableCommand = {
  name: string;
  description: string;
  hint?: string;
};

export type IMessageAvailableCommands = IMessage<
  'available_commands',
  {
    commands: AvailableCommand[];
  }
>;

/** Data for file_send messages — used by channels to send files to IM clients */
export interface IFileSendData {
  filePath: string;
  fileName: string;
  fileType: 'image' | 'file';
}

export type IMessageFileSend = IMessage<'file_send', IFileSendData>;

// eslint-disable-next-line max-len
export type TMessage =
  IMessageText | IMessageTips | IMessageThought | IMessageToolCall | IMessageToolGroup | IMessageAgentStatus | IMessageAcpPermission | IMessageAcpQuestion | IMessageAcpToolCall | IMessageCodexPermission | IMessageCodexToolCall | IMessagePlan | IMessageAvailableCommands | IMessageFileSend;

// 统一所有需要用户交互的用户类型
export interface IConfirmation<Option = any> {
  title?: string;
  id: string;
  action?: string;
  description: string;
  callId: string;
  options: Array<{
    label: string;
    value: Option;
    params?: Record<string, string>; // Translation interpolation parameters
  }>;
  /**
   * Command type for exec confirmations (e.g., 'curl', 'npm', 'git')
   * Used for "always allow" permission memory
   */
  commandType?: string;
}
