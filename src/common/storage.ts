/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { storage } from '@office-ai/platform';
import type { AcpBackend, AcpBackendAll, AcpBackendConfig } from '@/types/acpTypes';

/**
 * @description 聊天相关的存储
 */
export const ChatStorage = storage.buildStorage<IChatConversationRefer>('agent.chat');

// 聊天消息存储
export const ChatMessageStorage = storage.buildStorage('agent.chat.message');

// 系统配置存储
export const ConfigStorage = storage.buildStorage<IConfigStorageRefer>('agent.config');

// 系统环境变量存储
export const EnvStorage = storage.buildStorage<IEnvStorageRefer>('agent.env');

export interface IConfigStorageRefer {
  'gemini.config': {
    authType: string;
    proxy: string;
    GOOGLE_GEMINI_BASE_URL?: string;
    /** @deprecated Use accountProjects instead. Kept for backward compatibility migration. */
    GOOGLE_CLOUD_PROJECT?: string;
    /** 按 Google 账号存储的 GCP 项目 ID / GCP project IDs stored per Google account */
    accountProjects?: Record<string, string>;
    yoloMode?: boolean;
    /** Preferred session mode for new conversations / 新会话的默认模式 */
    preferredMode?: string;
  };
  'codex.config'?: {
    cliPath?: string;
    yoloMode?: boolean;
  };
  'acp.config': {
    [backend in AcpBackend]?: {
      authMethodId?: string;
      authToken?: string;
      lastAuthTime?: number;
      cliPath?: string;
      yoloMode?: boolean;
      /** Preferred session mode for new conversations / 新会话的默认模式 */
      preferredMode?: string;
      /** Preferred model ID for new conversations / 新会话的默认模型 */
      preferredModelId?: string;
    };
  };
  'acp.customAgents'?: AcpBackendConfig[];
  // Cached model lists per ACP backend for Guid page pre-selection
  'acp.cachedModels'?: Record<string, import('@/types/acpTypes').AcpModelInfo>;
  'model.config': IProvider[];
  'mcp.config': IMcpServer[];
  'mcp.agentInstallStatus': Record<string, string[]>;
  language: string;
  theme: string;
  'gemini.defaultModel': string | { id: string; useModel: string };
  'tools.imageGenerationModel': TProviderWithModel & {
    switch: boolean;
  };
  // 是否在粘贴文件到工作区时询问确认（true = 不再询问）
  'workspace.pasteConfirm'?: boolean;
  // guid 页面上次选择的 agent 类型 / Last selected agent type on guid page
  'guid.lastSelectedAgent'?: string;
  // guid 页面 session 模式（E端 Local/Remote 切换）/ Guid page session mode (Enterprise Local/Remote toggle)
  'guid.sessionMode'?: 'remote' | 'local';
  // 迁移标记：修复老版本中助手 enabled 默认值问题 / Migration flag: fix assistant enabled default value issue
  'migration.assistantEnabledFixed'?: boolean;
  // 迁移标记：旧版硬编码默认图像生成模型（gpt-image-1.5）一次性迁移到当前默认；迁移后用户显式选择不再被覆盖
  // Migration flag: one-time migration of the legacy hardcoded image generation model (gpt-image-1.5) to the current default; after migration, explicit user selections are preserved
  'migration.imageGenerationModelDefaultMigrated'?: boolean;
  // 迁移标记：为 cowork 助手添加默认启用的 skills / Migration flag: add default enabled skills for cowork assistant
  /** @deprecated Use migration.builtinDefaultSkillsAdded_v2 instead */
  'migration.coworkDefaultSkillsAdded'?: boolean;
  // 迁移标记：为所有内置助手添加默认启用的 skills / Migration flag: add default enabled skills for all builtin assistants
  'migration.builtinDefaultSkillsAdded_v2'?: boolean;
  // 迁移标记：为所有内置助手添加 promptsI18n / Migration flag: add promptsI18n for all builtin assistants
  'migration.promptsI18nAdded'?: boolean;
  /** Locally hidden remote cron execution sessions keyed by Moss session ID. */
  'remote.hiddenCronSessionIds'?: Record<string, number>;
  /** Migration flag: skill subdirectory restructuring completed */
  'migration.skillSubdirectoriesMigrated'?: boolean;
  /** Migration flag: channel agent migrated to scode (Sudo Code) */
  'migration.channelAgentMigratedToScode'?: boolean;
  // 关闭窗口时最小化到系统托盘 / Minimize to system tray when closing window
  'system.closeToTray'?: boolean;
  // 每轮消息下方是否显示 token / 积分用量 / Whether to show per-turn token / points usage badges
  'system.showTokenUsageBadges'?: boolean;
  // 对话流中是否显示工具调用（缺省 = 跟随默认值：个人版显示，企业版跟随 Moss 租户配置）
  // Show tool calls in the chat stream (absent = follow default: consumer shows, enterprise follows Moss tenant config)
  'system.showToolCalls'?: boolean;
  // 右栏浏览器新建标签页的默认主页 / Default homepage for new tabs in the right-panel browser
  'system.browserDefaultUrl'?: string;
  // 桌面 avatar 浮窗开关 / Floating desktop avatar window enabled
  'avatar.enabled'?: boolean;
  // Avatar 浮窗最近一次的位置（屏幕坐标）/ Last-known avatar window bounds (screen coords)
  'avatar.bounds'?: { x: number; y: number; width: number; height: number };
  // 内置资源最后复制的版本号，用于优化启动速度 / Last copied version of builtin resources for startup optimization
  'system.lastBuiltinResourcesVersion'?: string;
  /**
   * @deprecated Superseded by `system.sudoworkServerUrl` below. The current sudowork-server URL
   * is resolved at runtime via `src/common/sudoworkServer.ts` (renderer `getSudoworkServerBaseUrl`)
   * and `src/process/initStorage.ts#getSudoworkServerBaseUrlSync` (main), with priority:
   * user setting > build-time `__SUDOWORK_SERVER_BASE_URL__` define > literal fallback.
   * This key is kept for backward compatibility but is no longer read or written.
   */
  'sudowork.server'?: {
    baseUrl: string;
    enterpriseCode?: string;
  };
  /**
   * User-configured sudowork-server base URL (optional override).
   * Resolved by helpers in `src/common/sudoworkServer.ts` (renderer) and
   * `src/process/initStorage.ts#getSudoworkServerBaseUrlSync` (main).
   * Empty / absent → fall back to build-time define, then to literal.
   */
  'system.sudoworkServerUrl'?: string;
  // Telegram assistant default model / Telegram 助手默认模型
  'assistant.telegram.defaultModel'?: {
    id: string;
    useModel: string;
  };
  // Telegram assistant agent selection / Telegram 助手所使用的 Agent
  'assistant.telegram.agent'?: {
    backend: AcpBackendAll;
    customAgentId?: string;
    name?: string;
  };
  // Lark assistant default model / Lark 助手默认模型
  'assistant.lark.defaultModel'?: {
    id: string;
    useModel: string;
  };
  // Lark assistant agent selection / Lark 助手所使用的 Agent
  'assistant.lark.agent'?: {
    backend: AcpBackendAll;
    customAgentId?: string;
    name?: string;
  };
  // DingTalk assistant default model / DingTalk 助手默认模型
  'assistant.dingtalk.defaultModel'?: {
    id: string;
    useModel: string;
  };
  // DingTalk assistant agent selection / DingTalk 助手所使用的 Agent
  'assistant.dingtalk.agent'?: {
    backend: AcpBackendAll;
    customAgentId?: string;
    name?: string;
  };
  // WeChat assistant default model / 微信助手默认模型
  'assistant.wechat.defaultModel'?: {
    id: string;
    useModel: string;
  };
  // WeChat assistant agent selection / 微信助手所使用的 Agent
  'assistant.wechat.agent'?: {
    backend: AcpBackendAll;
    customAgentId?: string;
    name?: string;
  };
  // WeCom assistant default model / 企业微信助手默认模型
  'assistant.wecom.defaultModel'?: {
    id: string;
    useModel: string;
  };
  // WeCom assistant agent selection / 企业微信助手所使用的 Agent
  'assistant.wecom.agent'?: {
    backend: AcpBackendAll;
    customAgentId?: string;
    name?: string;
  };
  // pwd_login auto-fill credential entries (non-secret selector metadata; the
  // username+password live in the Nexus secret store at service:pwdlogin/{title}).
  // Agent-registered custom sites; built-in sites come from pwdAdapters.ts.
  'pwdLogin.entries'?: Array<{
    title: string;
    url: string;
    usernameSelector: string;
    passwordSelector: string;
    submitSelector: string;
    captchaSelector?: string;
    captchaImageSelector?: string;
    strategy: 'single_step' | 'two_step';
  }>;
  // Channel voice transcription / 频道语音转写配置 (shared TranscriptionService)
  'assistant.transcription.engine'?: 'local' | 'cloud'; // 引擎类型：本地(默认)或云端 / engine kind: local (default) or cloud
  'assistant.transcription.localEngine'?: 'faster-whisper' | 'sensevoice'; // 本地 ASR 后端 / local ASR backend
  'assistant.transcription.model'?: string; // 引擎模型名 / engine-specific model name
  'assistant.transcription.language'?: string; // 语言提示 (留空自动检测) / language hint, empty = auto
  // Safety hook enabled state / 安全 Hook 启用状态
  'safetyHook.enabled'?: boolean;
  // Safety hook blacklist configuration / 安全 Hook 黑名单配置
  'safetyHook.blacklist'?: import('./safetyTypes').BlacklistConfig;
  // 建设库 enabled state / 建设库启用状态
  'settings.jsb.enabled'?: boolean;
  'settings.tenant.enabled'?: Record<number, boolean>;
  // LLM request timeout in seconds / LLM 请求超时（秒）
  'agent.promptTimeout'?: number;
  // Agent idle timeout in minutes for recycling / Agent 空闲超时（分钟）用于回收
  'agent.idleTimeout'?: number;
  // Remote agent idle detach timeout in minutes. After a finished remote session is idle for
  // this long, the client tears down the WebSocket (detach only — does NOT terminate the Moss
  // session). 0 disables detach. undefined ⇒ default (30 min).
  // 远程会话空闲 detach 超时（分钟）。会话结束并空闲该时长后，客户端仅断开 WebSocket（不调用 terminate）。
  // 0 表示禁用；未设置时使用默认值（30 分钟）。
  'remote.idleDetachMinutes'?: number;
  // Telemetry configuration / 遥测配置
  'telemetry.enabled'?: boolean; // 是否启用遥测上报 / Whether telemetry reporting is enabled
  'telemetry.optInShown'?: boolean; // 是否已显示 opt-in 弹窗 / Whether opt-in dialog has been shown
  'telemetry.serverUrl'?: string; // 遥测服务器地址 (可选，默认使用内置地址) / Telemetry server URL
  'telemetry.installId'?: string; // 安装 ID / Install ID
  'telemetry.previousVersion'?: string; // 之前的版本 (用于判断安装类型) / Previous version for install type detection
  // App mode: 'c' for consumer, 'e' for enterprise, undefined = not set (new user)
  'system.appMode'?: 'c' | 'e';
  // Enterprise server URL / 企业服务器地址
  'eeclaw.serverUrl'?: string;
  // Enterprise tenant name / 企业租户名称
  'eeclaw.tenantName'?: string;
  // Enterprise user info / 企业用户信息
  'eeclaw.userInfo'?: { id: string; username: string; role?: string };
  // Whether enterprise local mode is available for the current user / 当前用户是否可用企业本地模式
  'eeclaw.localModeAvailable'?: boolean;
  // Enterprise auth token for main process (no user field, unlike localStorage eeclaw_auth_v1)
  'eeclaw.authStorage'?: { access_token: string; refresh_token: string; expires_at: number; device_id: string; session_type?: 'password' | 'api_key' | 'oauth2' };
  // Last resolved tenant config (main-process offline fallback for policy flags like client_cron_enabled)
  'eeclaw.tenantConfig'?: { client_cron_enabled?: boolean; [key: string]: unknown };
  // Consumer (personal) mode user info for telemetry / 个人模式用户信息（用于遥测）
  'consumer.userInfo'?: { id: string; nickname?: string; phone?: string; tenant_id?: string };
}

export interface IEnvStorageRefer {
  'nexus.dir': {
    workDir: string;
    cacheDir: string;
  };
}

/**
 * Conversation source type - identifies where the conversation was created
 * 会话来源类型 - 标识会话创建的来源
 */
export type ConversationSource = 'sudowork' | 'telegram' | 'lark' | 'dingtalk' | 'wechat' | (string & NonNullable<unknown>);

interface IChatConversation<T, Extra> {
  createTime: number;
  modifyTime: number;
  name: string;
  desc?: string;
  id: string;
  type: T;
  extra: Extra;
  model: TProviderWithModel;
  status?: 'pending' | 'running' | 'finished' | undefined;
  /** 处理开始时间戳（毫秒），用于恢复计时器 / Processing start timestamp in milliseconds for timer restoration */
  processingStartTime?: number;
  /** 会话来源，默认为 sudowork / Conversation source, defaults to sudowork */
  source?: ConversationSource;
  /** Channel chat isolation ID (e.g. user:xxx, group:xxx) */
  channelChatId?: string;
}

// Token 使用统计数据类型
export interface TokenUsageData {
  totalTokens: number;
}

export type TChatConversation =
  | Omit<
      IChatConversation<
        'acp',
        {
          workspace?: string;
          backend: AcpBackend;
          cliPath?: string;
          customWorkspace?: boolean;
          agentName?: string;
          customAgentId?: string; // UUID for identifying specific custom agent
          presetContext?: string; // 智能助手的预设规则/提示词 / Preset context from smart assistant
          /** 启用的 skills 列表，用于过滤 SkillManager 加载的 skills / Enabled skills list for filtering SkillManager skills */
          enabledSkills?: string[];
          /** 预设助手 ID，用于在会话面板显示助手名称和头像 / Preset assistant ID for displaying name and avatar in conversation panel */
          presetAssistantId?: string;
          /** 是否置顶会话 / Whether this conversation is pinned */
          pinned?: boolean;
          /** 置顶时间戳（毫秒）/ Pin timestamp in milliseconds */
          pinnedAt?: number;
          /** ACP 后端的 session UUID，用于会话恢复 / ACP backend session UUID for session resume */
          acpSessionId?: string;
          /** ACP session 最后更新时间 / Last update time of ACP session */
          acpSessionUpdatedAt?: number;
          /** Last context usage from usage_update */
          lastTokenUsage?: TokenUsageData;
          /** Context window capacity from usage_update */
          lastContextLimit?: number;
          /** ACP runtime context health after recoverable model context errors */
          acpContextHealth?: {
            poisoned: boolean;
            reason?: 'context_window_exceeded' | 'request_body_too_large' | 'single_request_too_large';
            poisonedAt?: number;
            recoverableByNewSession?: boolean;
          };
          /** Persisted session mode for resume support / 持久化的会话模式，用于恢复 */
          sessionMode?: string;
          /** Persisted model ID for resume support / 持久化的模型 ID，用于恢复 */
          currentModelId?: string;
          /** Explicit marker for temporary health-check conversations */
          isHealthCheck?: boolean;
          /** Display name override for workspace (rename without physical path change) / 工作空间显示名（重命名时只改显示名，不改物理路径） */
          workspaceDisplayName?: string;
          /** Cron job ID that created this conversation (for "new conversation per run" mode) */
          cronJobId?: string;
          /** Cron job name that created this conversation */
          cronJobName?: string;
          /** Cron run ID that created this conversation */
          cronRunId?: string;
          /** Cron job ID this conversation is pre-bound to (reuse mode, user-selected existing conversation) */
          cronJobBoundId?: string;
          /** Cron job name this conversation is pre-bound to */
          cronJobBoundName?: string;
          /** Moss remote container workspace path (enterprise mode) - stored separately from local workspace */
          mossWorkDir?: string;
        }
      >,
      'model'
    >
  | Omit<
      IChatConversation<
        'remote-agent',
        {
          workspace?: string;
          /** Moss Server URL (e.g. http://127.0.0.1:43127) */
          mossServerUrl?: string;
          /** Auth token for Moss Server (API Key or JWT) */
          authToken?: string;
          /** Username for password login (when authToken is empty) */
          username?: string;
          /** Password for password login (when authToken is empty) */
          password?: string;
          /** Agent name (corresponds to Moss assistant_name) */
          agentName?: string;
          /** Custom workspace flag */
          customWorkspace?: boolean;
          /** Custom agent ID */
          customAgentId?: string;
          /** Preset context/rules */
          presetContext?: string;
          /** Skip permission confirmation */
          dangerouslySkipPermissions?: boolean;
          /** Runtime type */
          runtimeType?: 'host' | 'docker';
          /** Backend type for compatibility */
          backend?: AcpBackendAll;
          /** Enterprise code */
          enterpriseCode?: string;
          /** Organization ID */
          orgId?: string;
          /** User ID */
          userId?: string;
          /** CLI path for compatibility */
          cliPath?: string;
          /** 预设助手 ID / Preset assistant ID */
          presetAssistantId?: string;
          /** 启用的 skills 列表 / Enabled skills list */
          enabledSkills?: string[];
          /** Persisted session mode for resume support / 持久化的会话模式，用于恢复 */
          sessionMode?: string;
          /** Persisted model ID for resume support / 持久化的模型 ID，用于恢复 */
          currentModelId?: string;
          /** 是否置顶会话 / Whether this conversation is pinned */
          pinned?: boolean;
          /** 置顶时间戳（毫秒）/ Pin timestamp in milliseconds */
          pinnedAt?: number;
          /** Health check marker */
          isHealthCheck?: boolean;
          /** Moss Session ID for resume */
          mossSessionId?: string;
          /** Moss Session last update time */
          mossSessionUpdatedAt?: number;
          /** WebSocket URL from resume API (for reconnecting to existing session) */
          acpWsUrl?: string;
          /** Whether Moss session is pending creation (lazy creation pattern) / Moss session 是否待创建（延迟创建模式） */
          mossSessionPending?: boolean;
          /** Display name override for workspace */
          workspaceDisplayName?: string;
          /** Cron job ID that created this conversation */
          cronJobId?: string;
          /** Cron job name that created this conversation */
          cronJobName?: string;
          /** Cron run ID that created this conversation */
          cronRunId?: string;
          /** Cron job ID this conversation is pre-bound to */
          cronJobBoundId?: string;
          /** Cron job name this conversation is pre-bound to */
          cronJobBoundName?: string;
          /** Moss remote container workspace path (enterprise mode) - stored separately from local workspace */
          mossWorkDir?: string;
        }
      >,
      'model'
    >;

export type IChatConversationRefer = {
  'chat.history': TChatConversation[];
};

export type ModelType =
  | 'text' // 文本对话
  | 'vision' // 视觉理解
  | 'function_calling' // 工具调用
  | 'image_generation' // 图像生成
  | 'web_search' // 网络搜索
  | 'reasoning' // 推理模型
  | 'embedding' // 嵌入模型
  | 'rerank' // 重排序模型
  | 'excludeFromPrimary'; // 排除：不适合作为主力模型

export type ModelCapability = {
  type: ModelType;
  /**
   * 是否为用户手动选择，如果为true，则表示用户手动选择了该类型，否则表示用户手动禁止了该模型；如果为undefined，则表示使用默认值
   */
  isUserSelected?: boolean;
};

export interface IProvider {
  id: string;
  platform: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string[];
  /**
   * 模型能力标签列表。打了标签就是支持，没打就是不支持
   */
  capabilities?: ModelCapability[];
  /**
   * 上下文token限制，可选字段，只在明确知道时填写
   */
  contextLimit?: number;
  /**
   * 每个模型的协议覆盖配置。映射模型名称到协议字符串。
   * 仅在 platform 为 'new-api' 时使用。
   * Per-model protocol overrides. Maps model name to protocol string.
   * Only used when platform is 'new-api'.
   * e.g. { "gemini-2.5-pro": "gemini", "claude-sonnet-4": "anthropic", "gpt-4o": "openai" }
   */
  modelProtocols?: Record<string, string>;
  /**
   * AWS Bedrock specific configuration
   * Only used when platform is 'bedrock'
   */
  bedrockConfig?: {
    authMethod: 'accessKey' | 'profile';
    region: string;
    // For access key method
    accessKeyId?: string;
    secretAccessKey?: string;
    // For profile method
    profile?: string;
  };
  /**
   * 供应商启用状态，默认为 true
   * Provider enabled state, defaults to true
   */
  enabled?: boolean;
  /**
   * 各个模型的启用状态，默认全部为 true
   * Individual model enabled states, defaults to all true
   */
  modelEnabled?: Record<string, boolean>;
  /**
   * 各个模型的健康检测结果（仅用于 UI 显示，不影响启用状态）
   * Model health check results (for UI display only, does not affect enabled state)
   */
  modelHealth?: Record<
    string,
    {
      status: 'unknown' | 'healthy' | 'unhealthy';
      lastCheck?: number; // 时间戳 / timestamp
      latency?: number; // 延迟时间（毫秒）/ latency in milliseconds
      error?: string; // 错误信息 / error message
    }
  >;
}

export type TProviderWithModel = Omit<IProvider, 'model'> & { useModel: string };

/** Default model used for image parsing/understanding (看图) via SudoRouter */
export const DEFAULT_IMAGE_PARSING_MODEL = 'gemini-3.5-flash';

/** Default model used for image generation (生图) */
export const DEFAULT_IMAGE_GENERATION_MODEL = 'gemini-3.1-flash-image';

// MCP Server Configuration Types
export type McpTransportType = 'stdio' | 'sse' | 'http';

export interface IMcpServerTransportStdio {
  type: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface IMcpServerTransportSSE {
  type: 'sse';
  url: string;
  headers?: Record<string, string>;
}

export interface IMcpServerTransportHTTP {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
}

export interface IMcpServerTransportStreamableHTTP {
  type: 'streamable_http';
  url: string;
  headers?: Record<string, string>;
}

export type IMcpServerTransport = IMcpServerTransportStdio | IMcpServerTransportSSE | IMcpServerTransportHTTP | IMcpServerTransportStreamableHTTP;

export interface IMcpServer {
  id: string;
  name: string;
  description?: string;
  enabled: boolean; // 是否已安装到 CLI agents（控制 Switch 状态）
  transport: IMcpServerTransport;
  tools?: IMcpTool[];
  status?: 'connected' | 'disconnected' | 'error' | 'testing'; // 连接状态（同时表示服务可用性）
  lastConnected?: number;
  createdAt: number;
  updatedAt: number;
  originalJson: string; // 存储原始JSON配置，用于编辑时的准确显示
}

export interface IMcpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

/**
 * CSS 主题配置接口 / CSS Theme configuration interface
 * 用于存储用户自定义的 CSS 皮肤 / Used to store user-defined CSS skins
 */
export interface ICssTheme {
  id: string; // 唯一标识 / Unique identifier
  name: string; // 主题名称 / Theme name
  cover?: string; // 封面图片 base64 或 URL / Cover image base64 or URL
  css: string; // CSS 样式代码 / CSS style code
  isPreset?: boolean; // 是否为预设主题 / Whether it's a preset theme
  createdAt: number; // 创建时间 / Creation time
  updatedAt: number; // 更新时间 / Update time
}
