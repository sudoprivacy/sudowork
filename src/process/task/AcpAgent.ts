/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Merged AcpAgentManager + AcpAgent — owns AcpConnection directly.
 */

import { spawn } from 'child_process';
import * as fs from 'node:fs';
import * as nodePath from 'node:path';
import { app } from 'electron';
import { AcpAdapter } from '@/agent/acp/AcpAdapter';
import { AcpApprovalStore, createAcpApprovalKey } from '@/agent/acp/ApprovalStore';
import { AcpConnection } from '@/agent/acp/AcpConnection';
import { CLAUDE_YOLO_SESSION_MODE, CODEBUDDY_YOLO_SESSION_MODE, IFLOW_YOLO_SESSION_MODE, QWEN_YOLO_SESSION_MODE } from '@/agent/acp/constants';
import { acpDetector } from '@/agent/acp/AcpDetector';
import { getClaudeModel } from '@/agent/acp/utils';
import { buildAcpModelInfo, summarizeAcpModelInfo } from '@/agent/acp/modelInfo';
import { channelEventBus } from '@/channels/agent/ChannelEventBus';
import { ipcBridge } from '@/common';
import type { AcpQuestionData, CronMessageMeta, TMessage, TurnTokenUsage } from '@/common/chatLib';
import type { SlashCommandItem } from '@/common/slash/types';
import { transformMessage } from '@/common/chatLib';
import { DRAFTS_DIR_NAME, NEXUS_FILES_MARKER } from '@/common/constants';
import { appendNexusFilesMarker } from '@/common/nexusFiles';
import type { IResponseMessage } from '@/common/ipcBridge';
import { NavigationInterceptor, type NavigationToolData } from '@/common/navigation';
import { parseError, uuid } from '@/common/utils';
import type {
  AcpBackend,
  AcpError,
  AcpModelInfo,
  AcpPermissionOption,
  AcpPermissionRequest,
  AcpPromptResponseUsage,
  AcpQuestionRequest,
  AcpQuestionResponseAnswer,
  AcpResult,
  AcpSessionConfigOption,
  AcpSessionUpdate,
  AvailableCommandsUpdate,
  ToolCallUpdate,
  ToolCallUpdateStatus,
} from '@/types/acpTypes';
import { ACP_BACKENDS_ALL, AcpErrorType, createAcpError, getAcpResumeStrategy } from '@/types/acpTypes';
import { ExtensionRegistry } from '@/extensions';
import { getEnhancedEnv, resolveNpxPath } from '@process/utils/shellEnv';
import { applyPresetRuntime } from '@process/task/presetRuntime';
import { assistantManager } from '@/process/AssistantManager';
import { getDatabase } from '@process/database';
import { cronBusyGuard } from '@process/services/cron/CronBusyGuard';
import { translateLLMError } from '@process/utils/llmErrorTranslation';
import { classifyLlmError } from '@process/utils/llmErrorClassification';
import { mergeScodeProxyModelInfo, isModelVisionCapable, getScodeProxyModelInfoSync } from '@process/services/scode/scodeProxyModels';
import { extractGovernanceBlock } from '@process/services/team/GovernancePrompt';
import { appendGeneratedFilesMarker, type GeneratedFileEntry } from '@/common/generatedFiles';
import { readAssistantResource, ruleFilePattern } from '@process/utils/assistantResources';
import { protectUnsupportedAcpSlashPrompt } from '@/common/slash/sudoworkCommands';
import { cdpPort as chromiumCdpPort } from '@/utils/configureChromium';
import { parseImageCapability, type IImageCapability } from '@/common/imageUtils';
import { clearSkillsCache, getCustomSkillsDir, ProcessConfig } from '../initStorage';
import { addMessage, addOrUpdateMessage, nextTickToLocalFinish } from '../message';
import { handlePreviewOpenEvent } from '../utils/previewUtils';
import { mainLog, mainWarn, mainError } from '../utils/mainLogger';
import {
  startConversationTracking,
  endConversationSuccess,
  endConversationError,
  endConversationUserCancel,
  startToolCallTracking,
  endToolCallTracking,
  startPermissionRequestTracking,
  endPermissionRequestTracking,
  recordFileOperationStep,
  startTurnTracking,
  updateTurnTokens,
  endTurnSuccess,
  endTurnError,
  getCurrentTurnId,
} from '../telemetry';
import { conversationBreadcrumbs, apiBreadcrumbs, mcpBreadcrumbs } from '../telemetry/BreadcrumbTracker';
import { resolveImageConfig, callImagesGenerations, callImagesEdits, saveImageResult, resolveChatModel, callChatCompletionsWithImage, readSudorouterCredentials } from '../bridge/imageGenerationBridge';
import { resolveWorkspaceSkillsDir } from '../utils/workspaceSkillsDir';
import { injectSkillsDirectoryHint, prepareFirstMessageWithSkillsIndex } from './agentUtils';
import { AcpSkillManager } from './AcpSkillManager';
import { archiveTurnFiles, cleanupIntermediateFiles, cleanupTrackedDraftsOnCancel, type TrackedTurnFile } from './draftsCleanup';
import { detectBashDraftRestoreCommand, FileIntentClassifier, type BashDraftRestoreDetection, type FileIntentSource, type FileOperationIntent } from './FileIntentClassifier';
import { buildAcpModelIdentityReminder, SCODE_COMPLETION_REMINDER, shouldInjectLanguageReminder, shouldRunCurrentTurnPostCleanup, shouldSkipAcpWorkspaceTrackingPath } from './acpWorkspaceTracking';
import { installWorkspaceSkillsFromTrackedFiles } from './workspaceSkillInstaller';
import { buildGeneratedFileEntries as buildGeneratedFileEntriesFromTracked, resolveFinalFileDisplayPath as resolveFinalFileDisplayPathPure } from './generatedFileEntries';
import BaseAgent from './BaseAgent';
import { hasCronCommands } from './CronCommandDetector';
import { detectChannelQueryIntent, executeChannelInfoCommand, type ChannelQueryCommand } from './ChannelInfoDetector';
import { extractTextFromMessage, processCronInMessage } from './MessageMiddleware';
import { processAtFileReferences } from './acp/AcpAtFileProcessor';
import { StreamTextBuffer, CronTextAccumulator, preprocessContentMessage } from './acp/AcpMessagePipeline';
import { clearAcpSessionId, saveAcpSessionId, saveSessionMode, saveModelId, saveContextUsage } from './acp/AcpPersistence';
import { extractLatestScodeAssistantUsageFromJsonl, findScodeSessionFile, normalizePromptUsageForMessage, SCODE_LATE_RECONCILIATION_DEFAULTS } from './acpUsageReconciliation';

// Telemetry imports for conversation tracking

// Telemetry imports for turn/step tracking

// CrashReporter imports for breadcrumb tracking

/** Default prompt timeout in seconds */
const DEFAULT_PROMPT_TIMEOUT_SECONDS = 300;

/** Prompt timeout range (seconds) */
const PROMPT_TIMEOUT_MIN_SECONDS = 30;
const PROMPT_TIMEOUT_MAX_SECONDS = 3600;
const TEXT_ATTACHMENT_BLOCK_BYTES = 1024 * 1024;
const CONTEXT_OVERFLOW_REASONS = new Set(['context_window_exceeded', 'single_request_too_large', 'request_body_too_large']);
const CONTEXT_RISK_TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.json', '.jsonl', '.csv', '.tsv', '.xml', '.yaml', '.yml', '.log']);

/** Enable ACP performance diagnostics via ACP_PERF=1 */
const ACP_PERF_LOG = process.env.ACP_PERF === '1';

/**
 * Check if rules contain explicit identity statement like "你是 XX 助手" or "You are XX"
 * Also detects [Identity Override] blocks that we inject
 */
function hasExplicitIdentity(rules: string): boolean {
  if (!rules) return false;
  // Check for Identity Override block (injected by our system)
  if (rules.includes('[Identity Override')) return true;
  // Chinese patterns: "你是 XX 助手", "你是 **XX**", "你的身份是"
  const zhPatterns = [/你是\s+.{1,20}助手/, /你是\s+\*{0,2}.{1,20}\*{0,2}[，,。]/, /你的身份是[:：]?/];
  // English patterns: "You are XX assistant", "I am XX", "Your identity is"
  const enPatterns = [/You are\s+.{1,20}assistant/i, /I am\s+.{1,20}(assistant|helper|agent)/i, /Your identity is[:]?/i];
  return zhPatterns.some((p) => p.test(rules)) || enPatterns.some((p) => p.test(rules));
}

function formatBytesForMessage(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * ACP available command type - subset of SlashCommandItem for ACP protocol layer
 */
type AcpAvailableCommand = Pick<SlashCommandItem, 'name' | 'description' | 'hint'>;

/**
 * Initialize response result interface
 */
interface InitializeResult {
  authMethods?: Array<{
    type: string;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

function normalizeToolCallStatus(status: string | undefined): 'pending' | 'in_progress' | 'completed' | 'failed' {
  if (!status) return 'pending';
  return status as 'pending' | 'in_progress' | 'completed' | 'failed';
}

export interface AcpAgentData {
  workspace?: string;
  backend: AcpBackend;
  cliPath?: string;
  customWorkspace?: boolean;
  conversation_id: string;
  customAgentId?: string;
  agentName?: string;
  presetContext?: string;
  enabledSkills?: string[];
  yoloMode?: boolean;
  acpSessionId?: string;
  acpSessionUpdatedAt?: number;
  sessionMode?: string;
  currentModelId?: string;
  presetAssistantId?: string;
  /** Per-member team MCP server config (K2 wire, injected via session/new.mcp_servers, see A1); undefined for non-team conversations */
  teamMcpConfig?: { name: string; command: string; args?: string[]; env?: Array<{ name: string; value: string }> };
}

class AcpAgent extends BaseAgent<AcpAgentData, AcpPermissionOption> {
  workspace: string;
  private bootstrap: Promise<void> | undefined;
  private isFirstMessage: boolean = true;
  options: AcpAgentData;
  private currentMode: string = 'default';
  private persistedModelId: string | null = null;

  // Connection — owned directly
  private connection: AcpConnection;
  private adapter: AcpAdapter;
  private pendingPermissions = new Map<string, { resolve: (response: { optionId: string }) => void; reject: (error: Error) => void }>();
  private pendingQuestions = new Map<string, { resolve: (response: { answers: AcpQuestionResponseAnswer[] }) => void; reject: (error: Error) => void; msgId: string }>();
  private approvalStore = new AcpApprovalStore();
  private permissionRequestMeta = new Map<string, { kind?: string; title?: string; rawInput?: Record<string, unknown>; stepId?: string }>();
  private pendingNavigationTools = new Set<string>();
  private statusMessageId: string | null = null;
  private _lastConnectionStatus: string | null = null;

  // Flag to track if user cancelled - ignore subsequent messages
  private userCancelled: boolean = false;
  private stopPromise: Promise<void> | null = null;
  private turnActive = false;

  // Tool call tracking for file_send messages to channel clients
  private toolCallMeta = new Map<string, { toolName: string; rawInput?: Record<string, unknown> }>();

  // Model tracking
  private userModelOverride: string | null = null;
  private pendingModelSwitchNotice: string | null = null;
  private hasReceivedUsageUpdate = false;
  private lastAssistantTextMsgId: string | null = null;
  /** Pending token usage to apply when assistant text message arrives */
  private pendingTokenUsage: TurnTokenUsage | null = null;
  private turnHadVisibleAssistantContent = false;
  private turnEventSequence = 0;
  private lastVisibleAssistantContentSequence = 0;
  private lastToolCompletionSequence = 0;
  private lastUserMessage: string | null = null;
  private plannedRestartInProgress = false;
  private contextOverflowRecoveryPending = false;
  private streamedContextErrorBuffer = '';

  // Slash commands
  private acpAvailableSlashCommands: SlashCommandItem[] = [];
  private acpAvailableSlashWaiters: Array<(commands: SlashCommandItem[]) => void> = [];

  // Message pipeline
  private readonly streamTextBuffer = new StreamTextBuffer();
  private readonly cronAccumulator = new CronTextAccumulator();

  // Workspace file tracking for channel file_send messages
  private workspaceFileSnapshot = new Map<string, number>();
  // Turn-start snapshot of deliverable files (path -> mtime), decoupled from
  // workspaceFileSnapshot which gets mutated by trackBashGeneratedFiles.
  // Used purely to decide "new in this turn" at turn-end.
  private turnStartDeliverableSnapshot = new Map<string, number>();
  private customSkillsSnapshot = new Set<string>();

  // Turn-level file tracking for precise cleanup on cancel
  private currentTurnFiles: Map<string, TrackedTurnFile> = new Map();
  // Files already forwarded to channel clients this turn (prevents duplicate file_send)
  private sentChannelFilePaths: Set<string> = new Set();
  private currentTurnProtectedFinalPaths = new Set<string>();
  private pendingCurrentTurnPostCleanup = false;
  private readonly fileIntentClassifier = new FileIntentClassifier();

  // Extra config passed to connection
  private extra: {
    workspace?: string;
    backend: AcpBackend;
    cliPath?: string;
    customWorkspace?: boolean;
    customArgs?: string[];
    customEnv?: Record<string, string>;
    yoloMode?: boolean;
    agentName?: string;
    acpSessionId?: string;
    acpSessionUpdatedAt?: number;
    presetAssistantId?: string;
  };

  constructor(data: AcpAgentData) {
    super('acp', data);
    this.conversation_id = data.conversation_id;
    this.workspace = data.workspace;
    this.options = data;
    this.currentMode = data.sessionMode || 'default';
    this.persistedModelId = data.currentModelId || null;
    this.status = 'pending';
    this.yoloMode = this.yoloMode || this.currentMode === 'yolo' || this.currentMode === 'bypassPermissions';

    this.connection = new AcpConnection();
    this.adapter = new AcpAdapter(data.conversation_id, data.backend);
    this.extra = {
      workspace: data.workspace,
      backend: data.backend,
      cliPath: data.cliPath,
      customWorkspace: data.customWorkspace,
      yoloMode: data.yoloMode,
      agentName: data.agentName,
      acpSessionId: data.acpSessionId,
      acpSessionUpdatedAt: data.acpSessionUpdatedAt,
      presetAssistantId: data.presetAssistantId,
    };

    this.setupConnectionHandlers();
    this.refreshWorkspaceFileSnapshot();
    // Initialize full workspace snapshot for Bash file tracking
    // 初始化完整工作空间快照用于 Bash 文件追踪
    this.workspaceFileSnapshot = this.getWorkspaceFiles();
    mainLog('[AcpAgent]', `[INIT] Initialized workspace snapshot with ${this.workspaceFileSnapshot.size} files`);
  }

  // ========== Connection Lifecycle ==========

  private setupConnectionHandlers(): void {
    this.connection.onSessionUpdate = (data: AcpSessionUpdate) => {
      this.handleSessionUpdate(data);
    };
    this.connection.onPermissionRequest = (data: AcpPermissionRequest) => {
      return this.handlePermissionRequest(data);
    };
    this.connection.onQuestionRequest = (data: AcpQuestionRequest) => {
      return this.handleQuestionRequest(data);
    };
    this.connection.onEndTurn = () => {
      void this.handleEndTurn();
    };
    this.connection.onPromptUsage = (usage: AcpPromptResponseUsage) => {
      this.handlePromptUsage(usage);
    };
    this.connection.onFileOperation = (operation) => {
      this.handleFileOperation(operation);
    };
    this.connection.onDisconnect = (error) => {
      this.handleDisconnect(error);
    };
  }

  initAgent(data: AcpAgentData = this.options): Promise<void> {
    if (this.bootstrap) return this.bootstrap;
    this.bootstrap = (async () => {
      let cliPath = data.cliPath;
      let customArgs: string[] | undefined;
      let customEnv: Record<string, string> | undefined;
      let yoloMode: boolean | undefined;

      // Handle custom backend
      if (data.backend === 'custom' && data.customAgentId) {
        // Look up from AssistantManager (filesystem SSOT)
        const strippedId = data.customAgentId.startsWith('builtin-') ? data.customAgentId.slice('builtin-'.length) : data.customAgentId;
        const meta = await assistantManager.getAssistantMeta(strippedId);
        let customAgentConfig = meta ? ({ id: data.customAgentId, name: meta.nameI18n?.['en-US'] || strippedId } as any) : undefined;

        if (!customAgentConfig && data.customAgentId.startsWith('ext:')) {
          const [, extensionName, ...idParts] = data.customAgentId.split(':');
          const adapterId = idParts.join(':');
          const adapter = ExtensionRegistry.getInstance()
            .getAcpAdapters()
            .find((item) => {
              const record = item as Record<string, unknown>;
              return record._extensionName === extensionName && record.id === adapterId;
            }) as Record<string, unknown> | undefined;

          if (adapter) {
            customAgentConfig = {
              id: data.customAgentId,
              name: typeof adapter.name === 'string' ? adapter.name : data.customAgentId,
              defaultCliPath: typeof adapter.defaultCliPath === 'string' ? adapter.defaultCliPath : undefined,
              acpArgs: Array.isArray(adapter.acpArgs) ? adapter.acpArgs.filter((v): v is string => typeof v === 'string') : undefined,
              env: typeof adapter.env === 'object' && adapter.env ? (adapter.env as Record<string, string>) : undefined,
            } as any;
          }
        }

        if (customAgentConfig?.defaultCliPath) {
          cliPath = customAgentConfig.defaultCliPath.trim();
          customArgs = customAgentConfig.acpArgs;
          customEnv = customAgentConfig.env;
        }
      } else if (data.backend !== 'custom') {
        const config = await ProcessConfig.get('acp.config');
        if (!cliPath && config?.[data.backend]?.cliPath) {
          cliPath = config[data.backend].cliPath;
        }
        // Fallback: resolve from acpDetector (handles channel conversations and restored sessions)
        if (!cliPath) {
          const detected = acpDetector.getDetectedAgents().find((a) => a.backend === data.backend);
          if (detected?.cliPath) {
            cliPath = detected.cliPath;
          }
        }
        const legacyYoloMode = data.yoloMode ?? (config?.[data.backend] as any)?.yoloMode;

        if (legacyYoloMode && this.currentMode === 'default' && !data.sessionMode) {
          const yoloModeValues: Record<string, string> = {
            claude: 'bypassPermissions',
            qwen: 'yolo',
            iflow: 'yolo',
            codex: 'yolo',
          };
          this.currentMode = yoloModeValues[data.backend] || 'yolo';
          this.yoloMode = true;
        }

        if (legacyYoloMode && data.sessionMode && !this.isYoloMode(data.sessionMode)) {
          void this.clearLegacyYoloConfig();
        }

        yoloMode = data.yoloMode ?? this.isYoloMode(this.currentMode);

        const backendConfig = ACP_BACKENDS_ALL[data.backend];
        if (backendConfig?.acpArgs) {
          customArgs = backendConfig.acpArgs;
        }
        if (!cliPath && backendConfig?.cliCommand) {
          cliPath = backendConfig.cliCommand;
        }
      } else {
        mainWarn('[AcpAgent]', 'Custom backend specified but customAgentId is missing');
      }

      // Apply preset-specific runtime configuration (env vars, scripts, model configs)
      const cdpPort = chromiumCdpPort || 9230;
      const presetResult = await applyPresetRuntime({
        presetAssistantId: this.extra.presetAssistantId,
        backend: this.extra.backend,
        workspace: this.extra.workspace,
        cdpPort,
      });
      customEnv = { ...customEnv, ...presetResult.envOverrides };
      // Always fold the runtime context appendix (auto-discovered scripts /
      // ops entry point) into presetContext — even when presetContext started
      // empty. Gating this on a non-empty presetContext dropped the absolute
      // script paths for assistants whose rule file produced no context,
      // forcing the agent to `find` for its own scripts.
      if (presetResult.contextAppendix) {
        this.options.presetContext = (this.options.presetContext || '') + presetResult.contextAppendix;
      }

      // Store resolved config for connection
      if (data.backend === 'scode' && this.persistedModelId) {
        customEnv = {
          ...customEnv,
          SUDOCODE_CURRENT_MODEL_ID: this.persistedModelId,
        };
      }

      this.extra = {
        ...this.extra,
        cliPath,
        customArgs,
        customEnv,
        yoloMode,
      };

      // Write preset rules as GEMINI.md for Gemini backend system instruction
      if (this.extra.backend === 'gemini' && this.extra.workspace && this.options.presetContext) {
        try {
          const geminiMdPath = nodePath.join(this.extra.workspace, 'GEMINI.md');
          fs.writeFileSync(geminiMdPath, this.options.presetContext);
          mainLog('[AcpAgent]', `Wrote GEMINI.md to ${geminiMdPath}`);
        } catch (error) {
          mainWarn('[AcpAgent]', 'Failed to write GEMINI.md:', error);
        }
      }

      // Connect
      await this.connect();

      // Re-apply persisted mode after session start/resume
      // codex/scode 不支持 session/set_mode，跳过
      if (this.currentMode && this.currentMode !== 'default' && this.options.backend !== 'codex' && this.options.backend !== 'scode') {
        try {
          await this.connection.setSessionMode(this.currentMode);
          mainLog('[AcpAgent]', `Re-applied persisted mode: ${this.currentMode}`);
        } catch (error) {
          mainWarn('[AcpAgent]', `Failed to re-apply mode ${this.currentMode}`, error);
        }
      }

      // Re-apply persisted model
      if (this.persistedModelId) {
        const currentInfo = this.getModelInfo();
        const isModelAvailable = currentInfo?.availableModels?.some((m) => m.id === this.persistedModelId);
        if (!isModelAvailable) {
          mainWarn('[AcpAgent]', `Persisted model ${this.persistedModelId} is not in available models, clearing`);
          this.persistedModelId = null;
        } else if (currentInfo?.currentModelId !== this.persistedModelId) {
          try {
            await this.setModelByConfigOption(this.persistedModelId);
          } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            mainWarn('[AcpAgent]', `Failed to re-apply model ${this.persistedModelId}`, error);
            if (errMsg.includes('model_not_found') || errMsg.includes('无可用渠道')) {
              ipcBridge.acpConversation.responseStream.emit({
                type: 'error',
                conversation_id: this.conversation_id,
                msg_id: `model_error_${Date.now()}`,
                data: `Model "${this.persistedModelId}" is not available on your API relay service. ` + `Please add this model to your relay's channel configuration. Falling back to the default model.`,
              });
            }
            this.persistedModelId = null;
          }
        }
      }

      // For scode backend, unconditionally call setModel via ACP RPC to ensure
      // scode uses the correct model for this session (not its own default).
      if (this.options.backend === 'scode' && this.persistedModelId) {
        try {
          await this.connection.setModel(this.persistedModelId);
          mainLog('[AcpAgent]', `scode: forced setModel("${this.persistedModelId}") via ACP RPC`);
        } catch (error) {
          mainWarn('[AcpAgent]', `scode: forced setModel failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      // Cache model list for Guid page
      const modelInfo = this.getModelInfo();
      if (modelInfo && modelInfo.availableModels?.length > 0) {
        void this.cacheModelList(modelInfo);
      }
    })();
    return this.bootstrap;
  }

  private async connect(): Promise<void> {
    const startTotal = Date.now();
    try {
      this.emitStatusMessage('connecting');

      let connectTimeoutId: NodeJS.Timeout | null = null;
      const connectTimeoutPromise = new Promise<never>((_, reject) => {
        connectTimeoutId = setTimeout(() => reject(new Error('Connection timeout after 70 seconds')), 70000);
      });

      const connectStart = Date.now();
      try {
        const tryConnect = async () => {
          await Promise.race([this.connection.connect(this.extra.backend, this.extra.cliPath, this.extra.workspace, this.extra.customArgs, this.extra.customEnv), connectTimeoutPromise]);
        };

        try {
          await tryConnect();
        } catch (firstError) {
          mainWarn('ACP', 'First connect attempt failed, retrying once:', firstError instanceof Error ? firstError.message : String(firstError));
          await this.connection.disconnect();
          await new Promise((resolve) => setTimeout(resolve, 300));
          await tryConnect();
        }
      } finally {
        if (connectTimeoutId) {
          clearTimeout(connectTimeoutId);
        }
      }
      if (ACP_PERF_LOG) mainLog('ACP-PERF', `start: connection.connect() completed ${Date.now() - connectStart}ms`);

      this.emitStatusMessage('connected');

      const authStart = Date.now();
      await this.performAuthentication();
      if (ACP_PERF_LOG) mainLog('ACP-PERF', `start: authentication completed ${Date.now() - authStart}ms`);

      if (!this.connection.hasActiveSession) {
        const sessionStart = Date.now();
        await this.createOrResumeSession();
        if (ACP_PERF_LOG) mainLog('ACP-PERF', `start: session created ${Date.now() - sessionStart}ms`);
      }

      // YOLO mode
      if (this.extra.yoloMode) {
        const yoloModeMap: Partial<Record<AcpBackend, string>> = {
          claude: CLAUDE_YOLO_SESSION_MODE,
          codebuddy: CODEBUDDY_YOLO_SESSION_MODE,
          qwen: QWEN_YOLO_SESSION_MODE,
          iflow: IFLOW_YOLO_SESSION_MODE,
        };
        const sessionMode = yoloModeMap[this.extra.backend];
        if (sessionMode) {
          try {
            const modeStart = Date.now();
            await this.connection.setSessionMode(sessionMode);
            if (ACP_PERF_LOG) mainLog('ACP-PERF', `start: session mode set ${Date.now() - modeStart}ms`);
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`[ACP] Failed to enable ${this.extra.backend} YOLO mode (${sessionMode}): ${errorMessage}`);
          }
        }
      }

      // Apply model from settings for Claude
      if (this.extra.backend === 'claude') {
        const configuredModel = getClaudeModel();
        if (configuredModel) {
          try {
            const modelStart = Date.now();
            await this.connection.setModel(configuredModel);
            if (ACP_PERF_LOG) mainLog('ACP-PERF', `start: model set ${Date.now() - modelStart}ms`);
          } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            mainWarn('ACP', `Failed to set model from settings: ${errMsg}`);
            if (errMsg.includes('model_not_found') || errMsg.includes('无可用渠道')) {
              this.emitErrorMessage(
                `Model "${configuredModel}" is not available on your API relay service. ` + `Please add this model to your relay's channel configuration, ` + `or update ANTHROPIC_MODEL in ~/.claude/settings.json to a supported model name. ` + `Falling back to the relay's default model.`
              );
            }
          }
        }
      }

      this.emitModelInfoEvent();
      this.emitStatusMessage('session_active');
      if (ACP_PERF_LOG) mainLog('ACP-PERF', `start: total ${Date.now() - startTotal}ms`);
    } catch (error) {
      if (ACP_PERF_LOG) mainLog('ACP-PERF', `start: failed after ${Date.now() - startTotal}ms`);
      this.emitStatusMessage('error');
      throw error;
    }
  }

  private async createOrResumeSession(): Promise<void> {
    const resumeSessionId = this.extra.acpSessionId;
    // A1: inject per-member team MCP server (K2 wire) when this is a team member conversation.
    const memberMcpServers = this.options.teamMcpConfig ? [this.options.teamMcpConfig] : undefined;

    if (resumeSessionId) {
      try {
        // Resume routing is driven by the per-backend strategy (SSOT in acpTypes), not ad-hoc
        // backend checks. 'session-load' (default: scode, codex, any ACP-compliant bridge) restores
        // history from disk by id via the ACP-standard `session/load`. 'meta-resume' (claude/codebuddy)
        // resumes through `session/new` + `_meta.claudeCode.options.resume`.
        const strategy = getAcpResumeStrategy(this.extra.backend);
        const response: { sessionId?: string } = strategy === 'meta-resume' ? await this.connection.newSession(this.extra.workspace, { resumeSessionId, forkSession: false }, memberMcpServers) : await this.connection.loadSession(resumeSessionId, this.extra.workspace, memberMcpServers);

        // Only adopt a server-minted id when the mechanism legitimately issues a new one (meta-resume
        // bridges may). `session/load` keeps the id we sent, so it never orphans the stored handle —
        // which is exactly the bug that made scode resume silently start a fresh, empty session.
        if (response.sessionId && response.sessionId !== resumeSessionId) {
          this.extra.acpSessionId = response.sessionId;
          saveAcpSessionId(this.conversation_id, response.sessionId);
        }
        return;
      } catch (resumeError) {
        mainWarn('AcpAgent', `Failed to resume session ${resumeSessionId}, creating fresh session:`, resumeError instanceof Error ? resumeError.message : String(resumeError));
      }
    }

    const response = await this.connection.newSession(this.extra.workspace, undefined, memberMcpServers);
    if (response.sessionId) {
      this.extra.acpSessionId = response.sessionId;
      saveAcpSessionId(this.conversation_id, response.sessionId);
    }
  }

  private async performAuthentication(): Promise<void> {
    try {
      const initResponse = this.connection.getInitializeResponse();
      const result = initResponse?.result as InitializeResult | undefined;
      if (!initResponse || !result?.authMethods?.length) {
        this.emitStatusMessage('authenticated');
        return;
      }

      try {
        await this.createOrResumeSession();
        this.emitStatusMessage('authenticated');
        return;
      } catch {
        // Need auth
      }

      if (this.extra.backend === 'qwen') {
        await this.ensureBackendAuth('qwen', 'login');
      } else if (this.extra.backend === 'claude') {
        await this.ensureBackendAuth('claude', '/login');
      }

      try {
        await this.createOrResumeSession();
        this.emitStatusMessage('authenticated');
        return;
      } catch {
        this.emitStatusMessage('error');
      }
    } catch {
      this.emitStatusMessage('error');
    }
  }

  private async ensureBackendAuth(backend: AcpBackend, loginArg: string): Promise<void> {
    try {
      this.emitStatusMessage('connecting');
      if (!this.extra.cliPath) {
        throw new Error(`No CLI path configured for ${backend} backend`);
      }

      const cleanEnv = getEnhancedEnv();
      let command: string;
      let args: string[];

      if (this.extra.cliPath.startsWith('npx ')) {
        const parts = this.extra.cliPath.split(' ');
        command = resolveNpxPath(cleanEnv);
        args = [...parts.slice(1), loginArg];
      } else {
        command = this.extra.cliPath;
        args = [loginArg];
      }

      const loginProcess = spawn(command, args, {
        stdio: 'pipe',
        timeout: 70000,
        env: cleanEnv,
      });

      await new Promise<void>((resolve, reject) => {
        loginProcess.on('close', (code) => {
          if (code === 0) {
            mainLog('AcpAgent', `${backend} authentication refreshed`);
            resolve();
          } else {
            reject(new Error(`${backend} login failed with code ${code}`));
          }
        });
        loginProcess.on('error', reject);
      });
    } catch (error) {
      mainWarn('AcpAgent', `${backend} auth refresh failed, will try to connect anyway:`, error);
    }
  }

  // ========== Public API (BaseAgent contract) ==========

  async sendMessage(data: { content: string; files?: string[]; msg_id?: string; cronMeta?: CronMessageMeta; skills?: string[] }): Promise<{
    success: boolean;
    msg?: string;
    message?: string;
  }> {
    const managerSendStart = Date.now();
    cronBusyGuard.setProcessing(this.conversation_id, true);
    this.status = 'running';
    this.processingStartTime = Date.now();
    this.turnActive = true;

    // Reset user cancelled flag for new message
    this.userCancelled = false;
    this.stopPromise = null;
    this.hasReceivedUsageUpdate = false;
    this.lastAssistantTextMsgId = null;
    this.pendingTokenUsage = null;
    this.turnHadVisibleAssistantContent = false;
    this.turnEventSequence = 0;
    this.lastVisibleAssistantContentSequence = 0;
    this.lastToolCompletionSequence = 0;

    // ★ Reset turn-level file tracking for new turn
    // 重置 Turn 级别文件追踪，开始新的 Turn
    this.currentTurnFiles.clear();
    this.sentChannelFilePaths.clear();
    this.turnStartDeliverableSnapshot = this.captureDeliverableSnapshot();
    this.currentTurnProtectedFinalPaths.clear();
    this.pendingCurrentTurnPostCleanup = false;
    this.workspaceFileSnapshot = this.getWorkspaceFiles();
    this.customSkillsSnapshot = this.getCustomSkillNames();
    mainLog('[AcpAgent]', `[TURN-START] Reset file tracking, snapshot size: ${this.workspaceFileSnapshot.size}`);

    try {
      // Apply prompt timeout from config before sending
      this.applyPromptTimeoutFromConfig();

      // Start telemetry conversation tracking
      const modelInfo = this.getModelInfo();
      const modelId = modelInfo?.currentModelId || this.persistedModelId || 'unknown';
      const modelProvider = this.options.backend;
      startConversationTracking(this.conversation_id, modelId, modelProvider);

      // Start telemetry turn tracking
      startTurnTracking(this.conversation_id, modelId, modelProvider, this.options.backend);

      // Breadcrumb: conversation started
      conversationBreadcrumbs.start(this.conversation_id, modelId, modelProvider);

      // Store user's message for file-sending intent detection
      // 存储用户消息用于检测文件发送意图
      if (data.content) {
        this.lastUserMessage = data.content;
        console.log(`[AcpAgent] Stored lastUserMessage: "${data.content.substring(0, 100)}..."`);
      }

      // Emit/persist user message immediately
      if (data.msg_id && data.content) {
        const displayContent = appendNexusFilesMarker(data.content, data.files || [], this.workspace);
        const userMessage: TMessage = {
          id: data.msg_id,
          msg_id: data.msg_id,
          type: 'text',
          position: 'right',
          conversation_id: this.conversation_id,
          content: {
            content: displayContent,
            ...(data.skills && data.skills.length > 0 && { skills: data.skills }),
            ...(data.cronMeta && { cronMeta: data.cronMeta }),
          },
          createdAt: Date.now(),
        };
        addMessage(this.conversation_id, userMessage);
        try {
          getDatabase().updateConversation(this.conversation_id, {});
        } catch {
          // Conversation might not exist in DB yet
        }
        let responseData: any = displayContent;
        if (data.cronMeta || (data.skills && data.skills.length > 0)) {
          responseData = {
            content: displayContent,
            ...(data.cronMeta && { cronMeta: data.cronMeta }),
            ...(data.skills && data.skills.length > 0 && { skills: data.skills }),
          };
        }

        const userResponseMessage: IResponseMessage = {
          type: 'user_content',
          conversation_id: this.conversation_id,
          msg_id: data.msg_id,
          data: responseData,
        };
        ipcBridge.acpConversation.responseStream.emit(userResponseMessage);
      }

      // Emit start event before async initAgent so frontend loading state
      // is set immediately, without waiting for the connection to be ready.
      ipcBridge.acpConversation.responseStream.emit({
        type: 'start',
        conversation_id: this.conversation_id,
        msg_id: data.msg_id || uuid(),
        data: { processingStartTime: this.processingStartTime },
      });

      // Intercept /model slash command locally so model switching does not depend on backend command support.
      const modelMatch = data.content.trim().match(/^\/model(?:\s+(.*))?$/);
      if (modelMatch !== null) {
        return await this.handleModelCommand(modelMatch);
      }

      // Intercept /image sub-commands
      const imageMatch = data.content.trim().match(/^\/image(?:\s+([\s\S]+))?$/);
      if (imageMatch !== null) {
        return await this.handleImageCommand((imageMatch[1] || '').trim());
      }

      // Intercept /browser sub-commands (open / status / eval / screenshot)
      const browserMatch = data.content.trim().match(/^\/browser(?:\s+([\s\S]+))?$/);
      if (browserMatch !== null) {
        return await this.handleBrowserCommand((browserMatch[1] || '').trim());
      }

      // Intercept channel query intent (natural language)
      const channelQueryCommand = detectChannelQueryIntent(data.content);
      if (channelQueryCommand) {
        return await this.handleChannelQueryIntent(channelQueryCommand);
      }

      const initStart = Date.now();
      if (this.contextOverflowRecoveryPending) {
        await this.resetRuntimeSessionAfterContextOverflow();
      } else {
        await this.initAgent(this.options);
      }
      if (ACP_PERF_LOG) mainLog('ACP-PERF', `manager: initAgent completed ${Date.now() - initStart}ms`);

      // Guard against stale agent after CLI crash
      if (!this.connection.isConnected) {
        mainWarn('[AcpAgent]', 'Agent not connected after initAgent, re-initializing');
        this.bootstrap = undefined;
        await this.initAgent(this.options);
      }

      // Dynamic reload of presetContext with latest assistant name (on every message, not just init)
      // 每次发送消息时动态重新加载 presetContext，确保使用最新的助手名称
      if (this.options.presetAssistantId) {
        try {
          const strippedId = this.options.presetAssistantId.startsWith('builtin-') ? this.options.presetAssistantId.slice('builtin-'.length) : this.options.presetAssistantId;

          // Get latest meta from AssistantManager (filesystem SSOT)
          const meta = await assistantManager.getAssistantMeta(strippedId);

          // Resolve locale for rule loading
          const appLocale = app.getLocale() || 'en-US';
          const localeKey = appLocale.startsWith('zh') ? 'zh-CN' : appLocale.startsWith('ja') ? 'ja-JP' : appLocale.startsWith('ko') ? 'ko-KR' : 'en-US';

          // Reload rules from filesystem
          let loadedRules = await readAssistantResource('rules', this.options.presetAssistantId, localeKey, ruleFilePattern).catch(() => '');

          // Get latest assistant name from meta
          const latestAgentName = meta?.nameI18n?.[localeKey] || meta?.nameI18n?.['en-US'] || meta?.id || strippedId;

          // Inject identity statement if rules don't have explicit identity
          if (latestAgentName && (!loadedRules || !hasExplicitIdentity(loadedRules))) {
            const identityBlock = localeKey.startsWith('zh')
              ? `[Identity Override - 最高优先级]
你的身份是：${latestAgentName}
当用户询问"你是谁"或类似身份问题时，必须回答："我是${latestAgentName}，有什么可以帮助你的吗？"
此身份声明优先级高于 USER.md 中的默认身份声明。
\n\n`
              : `[Identity Override - Highest Priority]
Your identity is: ${latestAgentName}
When users ask "Who are you" or similar identity questions, you MUST answer: "I am ${latestAgentName}. How can I help you?"
This identity statement takes priority over the default identity in USER.md.
\n\n`;
            loadedRules = identityBlock + (loadedRules || '');
          }

          // Update presetContext with the fresh rules (for subsequent use).
          // Preserve team governance (generated by TeamService, not the rules
          // file) across this reload — otherwise team members lose their role
          // instructions on every turn.
          const governanceBlock = extractGovernanceBlock(this.options.presetContext);
          this.options.presetContext = governanceBlock ? `${loadedRules}\n\n${governanceBlock}` : loadedRules;

          // Re-append the preset runtime context appendix (auto-discovered
          // scripts/ absolute paths + ops entry point). This block reloads the
          // rule file on every message and would otherwise overwrite the
          // appendix that applyPresetRuntime injected at init — leaving the
          // assistant unable to locate its own scripts and forcing a `find`.
          try {
            const cdpPort = chromiumCdpPort || 9230;
            const reloadPresetResult = await applyPresetRuntime({
              presetAssistantId: this.options.presetAssistantId,
              backend: this.extra.backend,
              workspace: this.extra.workspace,
              cdpPort,
            });
            if (reloadPresetResult.contextAppendix) {
              this.options.presetContext = (this.options.presetContext || '') + reloadPresetResult.contextAppendix;
            }
          } catch (appendixError) {
            mainWarn('[AcpAgent]', 'Failed to re-append preset runtime appendix:', appendixError);
          }

          // Also update agentName for placeholder display
          if (latestAgentName) {
            this.options.agentName = latestAgentName;
          }

          mainLog('[AcpAgent]', `Reloaded presetContext for ${this.options.presetAssistantId} with latest name: ${latestAgentName}`);
        } catch (error) {
          mainWarn('[AcpAgent]', 'Failed to reload preset context:', error);
        }

        // Append Dify enhancement prelude to system prompt (.md) if this
        // conversation was bound via ipcBridge.dify.bindSession. Cheap when
        // not bound — short-circuits on missing session.
        try {
          const { enhancePresetContext } = await import('@process/services/dify/enhancementOrchestrator');
          this.options.presetContext = await enhancePresetContext(this.conversation_id, this.options.presetContext || '');
        } catch (enhanceErr) {
          mainWarn('[AcpAgent]', 'Failed to apply Dify enhancement prelude:', enhanceErr);
        }
      }

      if (data.msg_id && data.content) {
        let contentToSend = data.content;
        if (contentToSend.includes(NEXUS_FILES_MARKER)) {
          contentToSend = contentToSend.split(NEXUS_FILES_MARKER)[0].trimEnd();
        }
        // Snapshot the user's RAW typed text right after marker-stripping.
        // Everything below this point appends scode-specific scaffolding —
        // file refs, skill tags, the full preset system prompt for first
        // messages, identity-override blocks for subsequent messages. That
        // scaffolding is *local-agent context* and must not pollute the
        // query we send to Dify (which should answer the user's actual
        // intent, not the scode bootstrap prose). We pass this snapshot to
        // `augmentUserContent` as the Dify-side query at the very end.
        const rawUserQuery = contentToSend;

        if (data.files && data.files.length > 0) {
          const fileRefs = data.files
            .map((filePath) => {
              const normalized = filePath.replace(/\\/g, '/');
              return normalized.includes(' ') ? `@"${normalized}"` : '@' + normalized;
            })
            .join(' ');
          contentToSend = fileRefs + ' ' + contentToSend;
        }

        if (data.skills && data.skills.length > 0) {
          mainLog('AcpAgent', `sendMessage: processing skills=${JSON.stringify(data.skills)}`);
          const skillTags = data.skills.map((skill) => `<command-name>${skill}</command-name>`).join('\n');
          contentToSend = `${skillTags}\n\n${contentToSend}`;
          mainLog('AcpAgent', `sendMessage: added skill tags to content, contentToSend starts with: ${contentToSend.substring(0, 100)}`);
        } else {
          mainLog('AcpAgent', `sendMessage: no skills to process, data.skills=${JSON.stringify(data.skills)}`);
        }

        const attachmentGuard = this.validateAttachmentContextRisk(data.files);
        if (attachmentGuard) {
          this.emitErrorMessage(attachmentGuard);
          return {
            success: false,
            msg: attachmentGuard,
          };
        }

        // ACP capability negotiation (design: image-handling-non-user-facing.html
        // Decision 1). Read once per turn — the cap is part of the session, not
        // the model. Backends that don't advertise the extension → `null`, which
        // makes getImageTargetSize fall back to sudowork defaults (Decision 1's
        // graceful-degradation hard rule).
        const imageCapability: IImageCapability | null = parseImageCapability(this.connection.getInitializeResponse());
        const economyMode = ProcessConfig.getSync('image.economyMode') === true;

        const processed = await processAtFileReferences(contentToSend, this.workspace, data.files, this.persistedModelId, {
          capability: imageCapability,
          economyMode,
        });
        contentToSend = processed.text;
        if (processed.images.length > 0) {
          mainLog('AcpAgent', `sendMessage: sending ${processed.images.length} image(s) as content blocks, mimeTypes=[${processed.images.map((i) => i.mimeType).join(', ')}]`);
        }

        const finalImages = processed.images;

        if (processed.images.length > 0 && this.options.backend === 'scode') {
          // Wrong-model handling (design: Decision 2). When the ACP backend
          // advertises `autoHandlesWrongModel=true` (sudocode does, as of the
          // matching sudocode PR #258 commit chain), sudowork hands off silently
          // — sudocode's push_images runs the VLM-route internally and substitutes
          // a description for the image. Sudowork only emits the legacy "model
          // doesn't support images" tip when the backend cannot handle it AND
          // the active model is text-only — preserving the existing UX for
          // pre-extension scode versions and other backends.
          if (!imageCapability?.autoHandlesWrongModel) {
            const currentModel = this.persistedModelId || this.getModelInfo()?.currentModelId;
            if (!isModelVisionCapable(currentModel)) {
              const modelLabel = this.getModelInfo()?.currentModelLabel || currentModel || 'unknown';
              const visionModels = getScodeProxyModelInfoSync()
                ?.availableModels?.filter((m) => isModelVisionCapable(m.id))
                ?.map((m) => m.label || m.id)
                ?.join(', ');
              const tip = `当前模型 "${modelLabel}" 不支持图片分析，请切换到支持视觉的模型${visionModels ? `（如 ${visionModels}）` : ''}后再发送图片。`;
              this.emitErrorMessage(tip);
              return { success: false, message: tip };
            }
          }
        }

        if (this.isFirstMessage) {
          contentToSend = await prepareFirstMessageWithSkillsIndex(contentToSend, {
            presetContext: this.options.presetContext,
            enabledSkills: this.options.enabledSkills,
            workspace: this.workspace,
            presetAgentType: this.options.backend,
          });

          if (this.options.backend === 'claude' || this.options.backend === 'scode') {
            const skillsDir = resolveWorkspaceSkillsDir({
              type: 'acp',
              extra: {
                workspace: this.workspace,
                backend: this.options.backend,
              },
            });
            if (skillsDir) {
              const linkedSkillNames = await fs.promises
                .readdir(skillsDir, { withFileTypes: true })
                .then((entries) =>
                  entries
                    .filter((entry) => entry.isSymbolicLink() || entry.isDirectory())
                    .map((entry) => entry.name)
                    .sort()
                )
                .catch((): string[] => []);
              contentToSend = await injectSkillsDirectoryHint(contentToSend, skillsDir, linkedSkillNames);
            }
          }
        } else if (this.options.presetAssistantId && this.options.presetContext) {
          // For subsequent messages, re-inject identity override (latest assistant
          // name) and team governance so the member keeps its role across turns.
          // Both prepend to the user request; neither enters displayContent (which
          // is derived from the raw user input above), so they stay invisible to the user.
          const blocks: string[] = [];
          if (this.options.presetContext.includes('[Identity Override')) {
            const identityStart = this.options.presetContext.indexOf('[Identity Override');
            const identityEnd = this.options.presetContext.indexOf('\n\n', identityStart);
            if (identityStart >= 0 && identityEnd > identityStart) {
              blocks.push(this.options.presetContext.slice(identityStart, identityEnd));
            }
          }
          const governanceBlock = extractGovernanceBlock(this.options.presetContext);
          if (governanceBlock) blocks.push(governanceBlock);
          if (blocks.length > 0) {
            contentToSend = `${blocks.join('\n\n')}\n\n[User Request]\n${contentToSend}`;
          }
        }

        // Dify enhancement: wrap user message with <knowledge_context> block
        // when this conversation has a bound Dify-enhanced assistant. Falls
        // through unchanged for non-enhanced sessions or on any error.
        //
        // We pass two args: `rawUserQuery` is what Dify sees as the user's
        // question; `contentToSend` (already fully wrapped with scode
        // scaffolding above) is what the local agent ultimately receives,
        // with the Dify-returned text prepended as a <knowledge_context>
        // block. This separation is critical — without it, Dify's RAG /
        // Agent receives the entire 10K scode bootstrap prompt instead of
        // the actual question, and just parrots whatever fallback line is
        // closest at hand.
        try {
          const { augmentUserContent } = await import('@process/services/dify/enhancementOrchestrator');
          contentToSend = await augmentUserContent(this.conversation_id, rawUserQuery, contentToSend);
        } catch (augErr) {
          mainWarn('[AcpAgent]', 'Dify augment failed; sending original message:', augErr);
        }

        const agentSendStart = Date.now();
        const result = await this.sendToConnection(contentToSend, data.msg_id, finalImages, true);
        if (ACP_PERF_LOG) mainLog('ACP-PERF', `manager: sendMessage completed ${Date.now() - agentSendStart}ms (total: ${Date.now() - managerSendStart}ms)`);
        if (this.isFirstMessage) {
          this.isFirstMessage = false;
        }
        // Handle sendToConnection error result (not thrown)
        if (!result.success) {
          const acpError = (result as { success: false; error: AcpError }).error;
          // Telemetry: end turn tracking (error)
          endTurnError(this.conversation_id, acpError.type?.toString() || 'UNKNOWN');
          // Telemetry: end conversation tracking (error)
          endConversationError(this.conversation_id);
          conversationBreadcrumbs.error(this.conversation_id, acpError.type?.toString() || 'unknown', acpError.message);
        }
        return result;
      }
      const agentSendStart = Date.now();
      const result = await this.sendToConnection(data.content, data.msg_id, undefined, true);
      if (ACP_PERF_LOG) mainLog('ACP-PERF', `manager: sendMessage completed ${Date.now() - agentSendStart}ms (total: ${Date.now() - managerSendStart}ms)`);
      // Handle sendToConnection error result (not thrown)
      if (!result.success) {
        const acpError = (result as { success: false; error: AcpError }).error;
        // Telemetry: end turn tracking (error)
        endTurnError(this.conversation_id, acpError.type?.toString() || 'UNKNOWN');
        // Telemetry: end conversation tracking (error)
        endConversationError(this.conversation_id);
        conversationBreadcrumbs.error(this.conversation_id, acpError.type?.toString() || 'unknown', acpError.message);
      }
      return result;
    } catch (e) {
      this.streamTextBuffer.flushAll();
      cronBusyGuard.setProcessing(this.conversation_id, false);
      this.status = 'finished';
      this.turnActive = false;
      // Clear processingStartTime on error
      // 错误时清除处理开始时间
      this.processingStartTime = undefined;

      // Telemetry: end conversation tracking (error)
      const errorMsg = e instanceof Error ? e.message : String(e);
      this.logAgentError('sendMessage failed', e, { msg_id: data.msg_id });
      let errorCode: string | undefined;
      if (errorMsg.includes('timeout') || errorMsg.includes('Timeout') || errorMsg.includes('timed out')) {
        errorCode = 'E002';
        // Telemetry: end turn tracking (error)
        endTurnError(this.conversation_id, 'E002');
        endConversationError(this.conversation_id, 'E002');
      } else if (errorMsg.includes('authentication') || errorMsg.includes('认证失败')) {
        errorCode = 'E006';
        // Telemetry: end turn tracking (error)
        endTurnError(this.conversation_id, 'E006');
        endConversationError(this.conversation_id, 'E006');
      } else if (errorMsg.includes('interrupted') || errorMsg.includes('SSE') || errorMsg.includes('stream')) {
        errorCode = 'E003';
        // Telemetry: end turn tracking (error)
        endTurnError(this.conversation_id, 'E003');
        endConversationError(this.conversation_id, 'E003');
      } else if (errorMsg.includes('parse') || errorMsg.includes('JSON') || errorMsg.includes('invalid response')) {
        errorCode = 'E005';
        // Telemetry: end turn tracking (error)
        endTurnError(this.conversation_id, 'E005');
        endConversationError(this.conversation_id, 'E005');
      } else if (errorMsg.includes('connection') || errorMsg.includes('Connection')) {
        errorCode = 'E001';
        // Telemetry: end turn tracking (error)
        endTurnError(this.conversation_id, 'E001');
        endConversationError(this.conversation_id, 'E001');
      } else {
        errorCode = 'E009';
        // Telemetry: end turn tracking (error)
        endTurnError(this.conversation_id, 'E009');
        endConversationError(this.conversation_id, 'E009');
      }

      // Breadcrumb: conversation ended (error)
      conversationBreadcrumbs.error(this.conversation_id, errorCode || 'unknown', errorMsg);

      const message: IResponseMessage = {
        type: 'error',
        conversation_id: this.conversation_id,
        msg_id: data.msg_id || uuid(),
        data: parseError(e),
      };

      const tMessage = transformMessage(message);
      if (tMessage) {
        addOrUpdateMessage(this.conversation_id, tMessage);
      }

      ipcBridge.acpConversation.responseStream.emit(message);
      channelEventBus.emitAgentMessage(this.conversation_id, message);

      const finishMessage: IResponseMessage = {
        type: 'finish',
        conversation_id: this.conversation_id,
        msg_id: uuid(),
        data: null,
      };
      ipcBridge.acpConversation.responseStream.emit(finishMessage);
      channelEventBus.emitAgentMessage(this.conversation_id, finishMessage);

      return new Promise((_, reject) => {
        nextTickToLocalFinish(() => {
          reject(e);
        });
      });
    }
  }

  /**
   * Apply prompt timeout from user config before sending message.
   * Reads agent.promptTimeout from ProcessConfig and sets it on the AcpConnection.
   * Falls back to DEFAULT_PROMPT_TIMEOUT_SECONDS (300s) if not configured.
   * Uses synchronous read to avoid IPC blocking issues.
   */
  private applyPromptTimeoutFromConfig(): void {
    if (!this.connection) {
      mainWarn('AcpAgent', 'applyPromptTimeoutFromConfig: connection is null');
      return;
    }

    try {
      // Use synchronous read to avoid IPC blocking
      const timeoutSeconds = ProcessConfig.getSync('agent.promptTimeout');
      mainLog('AcpAgent', `Read promptTimeout from config: ${timeoutSeconds}`);
      if (timeoutSeconds && timeoutSeconds > 0) {
        // Clamp to valid range
        const clampedSeconds = Math.max(PROMPT_TIMEOUT_MIN_SECONDS, Math.min(PROMPT_TIMEOUT_MAX_SECONDS, timeoutSeconds));
        const timeoutMs = clampedSeconds * 1000;
        this.connection.setPromptTimeout(timeoutMs);
        mainLog('AcpAgent', `Applied prompt timeout: ${clampedSeconds}s (${timeoutMs}ms), current connection timeout: ${this.connection.getPromptTimeout()}ms`);
      } else {
        // Use default if not configured
        this.connection.setPromptTimeout(DEFAULT_PROMPT_TIMEOUT_SECONDS * 1000);
        mainLog('AcpAgent', `Using default prompt timeout: ${DEFAULT_PROMPT_TIMEOUT_SECONDS}s`);
      }
    } catch (error) {
      mainWarn('AcpAgent', 'Failed to read prompt timeout config, using default:', error);
      this.connection.setPromptTimeout(DEFAULT_PROMPT_TIMEOUT_SECONDS * 1000);
    }
  }

  private async sendToConnection(content: string, msg_id?: string, images?: Array<{ type: 'image'; data: string; mimeType: string }>, skipStart?: boolean): Promise<AcpResult> {
    const sendStart = Date.now();
    try {
      if (!this.connection.isConnected || !this.connection.hasActiveSession) {
        const reconnectStart = Date.now();
        try {
          this.bootstrap = undefined;
          await this.initAgent(this.options);
          if (ACP_PERF_LOG) mainLog('ACP-PERF', `send: auto-reconnect completed ${Date.now() - reconnectStart}ms`);
        } catch (reconnectError) {
          if (ACP_PERF_LOG) mainLog('ACP-PERF', `send: auto-reconnect failed ${Date.now() - reconnectStart}ms`);
          const errorMsg = reconnectError instanceof Error ? reconnectError.message : String(reconnectError);
          this.logAgentError('sendToConnection reconnect failed', reconnectError, { msg_id });
          return {
            success: false,
            error: createAcpError(AcpErrorType.CONNECTION_NOT_READY, `Failed to reconnect: ${errorMsg}`, true),
          };
        }
      }

      // Emit start event (skip if already emitted by sendMessage)
      if (!skipStart) {
        this.handleStreamEvent({
          type: 'start',
          conversation_id: this.conversation_id,
          msg_id: msg_id || uuid(),
          data: { processingStartTime: this.processingStartTime },
        });
      }

      this.adapter.resetMessageTracking();
      this.streamedContextErrorBuffer = '';
      let processedContent = content;

      // Re-assert model override
      if (this.userModelOverride) {
        const currentInfo = this.getModelInfo();
        if (currentInfo?.currentModelId !== this.userModelOverride) {
          try {
            await this.connection.setModel(this.userModelOverride);
          } catch (err) {
            mainWarn('ACP', `Pre-prompt model re-assert failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }

      const shouldInjectScodeStartupModelNotice = this.extra.backend === 'scode' && this.isFirstMessage && !this.pendingModelSwitchNotice;
      const activeModelNoticeId = this.pendingModelSwitchNotice || (shouldInjectScodeStartupModelNotice ? this.getModelInfo()?.currentModelId || this.persistedModelId : null);

      // Inject model identity reminder for backends whose upstream identity text can be stale.
      if (activeModelNoticeId && (this.extra.backend === 'claude' || this.extra.backend === 'scode')) {
        const modelNotice = buildAcpModelIdentityReminder(this.extra.backend, activeModelNoticeId);
        processedContent = modelNotice + processedContent;
        this.pendingModelSwitchNotice = null;
      }

      const promptStart = Date.now();
      // Breadcrumb: API request
      apiBreadcrumbs.request(`session/prompt`, 'POST', this.conversation_id);

      processedContent = protectUnsupportedAcpSlashPrompt(
        processedContent,
        this.acpAvailableSlashCommands.map((command) => command.name)
      );
      if (shouldInjectLanguageReminder(this.extra.backend)) {
        processedContent = SCODE_COMPLETION_REMINDER + processedContent;
      }

      await this.connection.sendPrompt(processedContent, images, msg_id);
      if (ACP_PERF_LOG) mainLog('ACP-PERF', `send: sendPrompt completed ${Date.now() - promptStart}ms (total send: ${Date.now() - sendStart}ms)`);

      // Breadcrumb: API response success
      apiBreadcrumbs.responseSuccess(`session/prompt`, 200, Date.now() - sendStart);

      this.statusMessageId = null;
      return { success: true, data: null };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logAgentError('sendToConnection failed', error, { msg_id });
      if (errorMsg.includes('Internal error') && this.extra.backend === 'qwen') {
        const enhancedMsg = `Qwen ACP Internal Error: This usually means authentication failed or ` + `the Qwen CLI has compatibility issues. Please try: 1) Restart the application ` + `2) Use 'npx @qwen-code/qwen-code' instead of global qwen 3) Check if you have valid Qwen credentials.`;
        this.emitErrorMessage(enhancedMsg);
        return {
          success: false,
          error: createAcpError(AcpErrorType.AUTHENTICATION_FAILED, enhancedMsg, false),
        };
      }

      let errorType: AcpErrorType = AcpErrorType.UNKNOWN;
      let retryable = false;
      const classification = classifyLlmError(error);
      if (classification.type === 'context_window_exceeded') {
        errorType = AcpErrorType.CONTEXT_WINDOW_EXCEEDED;
        retryable = true;
        if (classification.recoverableByNewSession) {
          await this.markRuntimeContextPoisoned(classification.userMessage, 'context_window_exceeded');
        }
      } else if (classification.type === 'single_request_too_large' || classification.type === 'request_body_too_large') {
        errorType = AcpErrorType.REQUEST_TOO_LARGE;
        retryable = classification.recoverableByNewSession;
        if (classification.recoverableByNewSession) {
          await this.markRuntimeContextPoisoned(classification.userMessage, classification.type);
        }
      } else if (errorMsg.includes('authentication') || errorMsg.includes('认证失败') || errorMsg.includes('[ACP-AUTH-')) {
        errorType = AcpErrorType.AUTHENTICATION_FAILED;
      } else if (errorMsg.includes('timeout') || errorMsg.includes('Timeout') || errorMsg.includes('timed out')) {
        errorType = AcpErrorType.TIMEOUT;
        retryable = true;
        // For scode backend, attempt late reconciliation after timeout
        if (this.options.backend === 'scode') {
          void this.attemptScodeLateReconciliation();
        }
      } else if (errorMsg.includes('permission') || errorMsg.includes('Permission')) {
        errorType = AcpErrorType.PERMISSION_DENIED;
      } else if (errorMsg.includes('connection') || errorMsg.includes('Connection')) {
        errorType = AcpErrorType.NETWORK_ERROR;
        retryable = true;
      }

      // Pass classification.type as errorClass when it's a known runtime error class —
      // the renderer routes to a differentiated RuntimeErrorBanner per class (PR-B).
      // For 'unknown' we send no errorClass so renderer falls back to the legacy
      // plain-text tip path.
      const runtimeErrorMeta = classification.type !== 'unknown' ? { errorClass: classification.type } : undefined;
      this.emitErrorMessage(classification.type === 'unknown' ? translateLLMError(errorMsg) : classification.userMessage, true, runtimeErrorMeta);

      // Breadcrumb: API response error
      apiBreadcrumbs.responseError(`session/prompt`, errorType === AcpErrorType.TIMEOUT ? 408 : 500, errorMsg);

      return {
        success: false,
        error: createAcpError(errorType, errorMsg, retryable),
      };
    }
  }

  private async markRuntimeContextPoisoned(userMessage: string, reason: 'context_window_exceeded' | 'request_body_too_large' | 'single_request_too_large', options: { disconnectNow?: boolean } = {}): Promise<void> {
    if (this.contextOverflowRecoveryPending) {
      return;
    }

    this.contextOverflowRecoveryPending = true;
    this.extra.acpSessionId = undefined;
    this.options.acpSessionId = undefined;

    try {
      const db = getDatabase();
      const result = db.getConversation(this.conversation_id);
      if (result.success && result.data && result.data.type === 'acp') {
        const conversation = result.data;
        const updatedExtra = { ...conversation.extra };
        delete updatedExtra.acpSessionId;
        delete updatedExtra.acpSessionUpdatedAt;
        updatedExtra.acpContextHealth = {
          poisoned: true,
          reason,
          poisonedAt: Date.now(),
          recoverableByNewSession: true,
        };
        db.updateConversation(this.conversation_id, { extra: updatedExtra } as Partial<typeof conversation>);
      }
    } catch (err) {
      mainWarn('[AcpAgent]', `Failed to persist context overflow recovery state: ${err instanceof Error ? err.message : String(err)}`);
    }

    clearAcpSessionId(this.conversation_id);
    if (options.disconnectNow !== false) {
      try {
        await this.connection.disconnect();
      } catch (err) {
        mainWarn('[AcpAgent]', `Failed to disconnect poisoned ACP session: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    this.bootstrap = undefined;
    this.isFirstMessage = true;
    mainWarn('[AcpAgent]', `Marked ACP runtime context as poisoned for ${this.conversation_id}: ${reason}. ${userMessage}`);
  }

  private validateAttachmentContextRisk(files?: string[]): string | null {
    if (!files || files.length === 0) return null;

    for (const filePath of files) {
      const ext = nodePath.extname(filePath).toLowerCase();
      if (!CONTEXT_RISK_TEXT_EXTENSIONS.has(ext)) continue;

      try {
        const stat = fs.statSync(filePath);
        if (!stat.isFile() || stat.size < TEXT_ATTACHMENT_BLOCK_BYTES) continue;

        const fileName = nodePath.basename(filePath);
        return `附件 "${fileName}" 大小为 ${formatBytesForMessage(stat.size)}，读取全文很可能超过当前模型上下文限制。请拆分文件、只发送相关片段，或先让模型按章节/行号读取。`;
      } catch (err) {
        mainWarn('[AcpAgent]', `Failed to inspect attachment size for ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return null;
  }

  private async resetRuntimeSessionAfterContextOverflow(): Promise<void> {
    this.contextOverflowRecoveryPending = false;
    this.streamedContextErrorBuffer = '';
    this.extra.acpSessionId = undefined;
    this.options.acpSessionId = undefined;
    clearAcpSessionId(this.conversation_id);

    if (this.connection.isConnected) {
      try {
        await this.connection.disconnect();
      } catch (err) {
        mainWarn('[AcpAgent]', `Failed to disconnect before fresh context session: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    this.bootstrap = undefined;
    this.isFirstMessage = true;
    await this.initAgent(this.options);

    try {
      const db = getDatabase();
      const result = db.getConversation(this.conversation_id);
      if (result.success && result.data && result.data.type === 'acp') {
        const conversation = result.data;
        const updatedExtra = {
          ...conversation.extra,
          acpContextHealth: {
            poisoned: false,
            recoverableByNewSession: false,
          },
        };
        db.updateConversation(this.conversation_id, { extra: updatedExtra } as Partial<typeof conversation>);
      }
    } catch (err) {
      mainWarn('[AcpAgent]', `Failed to clear context overflow recovery state: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async sleepForLateReconciliation(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private getLatestAssistantTextMsgIdFromDb(): string | null {
    try {
      const db = getDatabase();
      const result = db.getConversationMessages(this.conversation_id, 0, 100, 'DESC');
      for (const msg of result.data) {
        if (msg.type === 'text' && msg.position === 'left') {
          return msg.msg_id || msg.id;
        }
      }
    } catch (err) {
      mainWarn('[AcpAgent]', `[LATE-RECONCILE] Failed to read latest assistant message: ${err instanceof Error ? err.message : String(err)}`);
    }
    return null;
  }

  private patchAssistantTokenUsage(msgId: string, tokenUsage: TurnTokenUsage, options: { flush?: boolean } = {}): void {
    if (options.flush) {
      this.streamTextBuffer.flushAll();
    }

    const usagePatch: IResponseMessage = {
      type: 'content',
      conversation_id: this.conversation_id,
      msg_id: msgId,
      data: {
        content: '',
        tokenUsage,
      },
    };
    const tMessage = transformMessage(usagePatch);
    if (tMessage) {
      addOrUpdateMessage(this.conversation_id, tMessage);
    }
    ipcBridge.acpConversation.responseStream.emit(usagePatch);
  }

  /**
   * SCode can continue running after Sudowork's prompt call times out. In that
   * case the final usage lands in the SCode session JSONL later, so poll for a
   * bounded window and patch only tokenUsage onto the latest assistant message.
   */
  private async attemptScodeLateReconciliation(): Promise<void> {
    if (this.options.backend !== 'scode' || !this.workspace || !this.extra.acpSessionId) {
      return;
    }

    const sessionId = this.extra.acpSessionId;
    const { attempts, intervalMs } = SCODE_LATE_RECONCILIATION_DEFAULTS;
    let sessionFile: string | null = null;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        sessionFile = sessionFile ?? (await findScodeSessionFile(this.workspace, sessionId));
        if (!sessionFile) {
          mainLog('[AcpAgent]', `[LATE-RECONCILE] SCode session file not found for ${sessionId}, attempt ${attempt}/${attempts}`);
        } else {
          const content = await fs.promises.readFile(sessionFile, 'utf-8');
          const usageEntry = extractLatestScodeAssistantUsageFromJsonl(content);
          if (usageEntry) {
            const patchMsgId = this.lastAssistantTextMsgId || this.getLatestAssistantTextMsgIdFromDb();
            if (!patchMsgId) {
              mainLog('[AcpAgent]', `[LATE-RECONCILE] Usage found for ${sessionId}, but no assistant message is available to patch`);
              return;
            }

            mainLog('[AcpAgent]', `[LATE-RECONCILE] Applying SCode usage from ${sessionFile} to msg_id=${patchMsgId}`);
            this.patchAssistantTokenUsage(patchMsgId, usageEntry.usage);
            updateTurnTokens(this.conversation_id, {
              totalTokens: usageEntry.usage.totalTokens,
              inputTokens: usageEntry.usage.inputTokens ?? 0,
              outputTokens: usageEntry.usage.outputTokens ?? 0,
              cachedReadTokens: usageEntry.usage.cachedReadTokens,
              cachedWriteTokens: usageEntry.usage.cachedWriteTokens,
              thoughtTokens: usageEntry.usage.thoughtTokens,
              contextWindowTokens: usageEntry.usage.contextWindowTokens,
              estimatedSessionTokens: usageEntry.usage.estimatedSessionTokens,
              costUnits: usageEntry.usage.costUnits,
              costCurrency: usageEntry.usage.costCurrency,
            });
            return;
          }

          mainLog('[AcpAgent]', `[LATE-RECONCILE] No assistant usage yet in ${sessionFile}, attempt ${attempt}/${attempts}`);
        }
      } catch (err) {
        mainWarn('[AcpAgent]', `[LATE-RECONCILE] Attempt ${attempt}/${attempts} failed: ${err instanceof Error ? err.message : String(err)}`);
      }

      if (attempt < attempts) {
        await this.sleepForLateReconciliation(intervalMs);
      }
    }

    mainLog('[AcpAgent]', `[LATE-RECONCILE] No SCode usage reconciled for ${sessionId} after ${attempts} attempts`);
  }

  async confirm(id: string, callId: string, data: AcpPermissionOption) {
    super.confirm(id, callId, data);
    await this.bootstrap;

    if (this.pendingPermissions.has(callId)) {
      const { resolve } = this.pendingPermissions.get(callId)!;
      this.pendingPermissions.delete(callId);

      // Telemetry: end permission request step tracking
      const meta = this.permissionRequestMeta.get(callId);
      if (meta?.stepId) {
        const approved = data.optionId === 'allow' || data.optionId === 'allow_always';
        endPermissionRequestTracking(meta.stepId, approved);
      }

      if (data.optionId === 'allow_always') {
        if (meta) {
          const approvalKey = createAcpApprovalKey({
            kind: meta.kind,
            title: meta.title,
            rawInput: meta.rawInput,
          });
          this.approvalStore.put(approvalKey, 'allow_always');
        }
      }
      this.permissionRequestMeta.delete(callId);
      resolve({ optionId: data.optionId });
    }
  }

  async answerQuestion(toolCallId: string, answers: AcpQuestionResponseAnswer[]): Promise<void> {
    mainLog('[AcpAgent]', `answerQuestion toolCallId=${toolCallId} pending=${this.pendingQuestions.has(toolCallId)} pendingKeys=[${Array.from(this.pendingQuestions.keys()).join(',')}] answerCount=${answers.length}`);
    if (!this.pendingQuestions.has(toolCallId)) {
      throw new Error(`Question request not found: ${toolCallId}`);
    }

    const pending = this.pendingQuestions.get(toolCallId)!;
    this.pendingQuestions.delete(toolCallId);

    // Persist the answered state so the card survives DB reloads / tab switches.
    // 持久化已回答状态，确保切换会话或重新加载后卡片仍显示用户选择。
    try {
      this.emitQuestionAnswered(pending.msgId, answers);
    } catch {
      // Best-effort UI persistence; never let emit errors mask the resolve.
    }

    pending.resolve({ answers });
  }

  async stop(): Promise<void> {
    if (this.stopPromise) {
      return this.stopPromise;
    }
    if (!this.turnActive) {
      return;
    }

    this.stopPromise = this.performStop().finally(() => {
      this.stopPromise = null;
    });
    return this.stopPromise;
  }

  private async performStop(): Promise<void> {
    // Telemetry: end turn tracking (user cancel)
    endTurnError(this.conversation_id, 'USER_CANCEL');

    // Telemetry: end conversation tracking (user cancel)
    endConversationUserCancel(this.conversation_id);

    // Breadcrumb: conversation ended (user cancel)
    conversationBreadcrumbs.userCancel(this.conversation_id);

    // Mark as user cancelled to ignore subsequent messages from backend
    this.userCancelled = true;

    // 1. Flush buffered streaming text
    this.streamTextBuffer.flushAll();

    // 2. Respond to pending permission requests with Cancelled
    //    (ACP spec: client MUST do this when cancelling)
    for (const [_callId, pending] of this.pendingPermissions) {
      pending.reject(new Error('Cancelled'));
    }
    this.pendingPermissions.clear();
    for (const [, pending] of this.pendingQuestions) {
      this.emitQuestionCancelled(pending.msgId);
      pending.reject(new Error('Cancelled'));
    }
    this.pendingQuestions.clear();
    this.permissionRequestMeta.clear();

    // 3. Clear confirmation UI
    for (const confirmation of this.confirmations) {
      ipcBridge.conversation.confirmation.remove.emit({
        conversation_id: this.conversation_id,
        id: confirmation.id,
      });
    }
    this.confirmations = [];

    // 4. Cancel the current turn. If the backend doesn't acknowledge quickly,
    // force disconnect to stop the process.
    // 取消当前 turn。如果后端不及时响应，强制断开连接以停止进程。
    let result: 'cancelled' | 'abandoned' | 'disconnected';
    try {
      result = await this.connection.cancel(5000); // 5 seconds timeout
    } catch {
      result = 'disconnected';
    }

    // If backend didn't acknowledge cancel or abandoned, force disconnect
    // 如果后端没有确认取消或放弃，强制断开连接
    if (result === 'abandoned' || result === 'disconnected') {
      mainLog('[AcpAgent]', `Backend cancel result: ${result}, forcing disconnect`);
      await this.connection.disconnect();
    }

    this.status = 'finished';
    this.turnActive = false;
    // Clear processingStartTime on stop
    // 停止时清除处理开始时间
    this.processingStartTime = undefined;

    // 5. Clean up all tracked files on cancel (precise cleanup)
    // 取消时精确清理追踪到的所有文件（包括 draft 和 final）
    if (this.workspace) {
      mainLog('[AcpAgent]', `[STOP] currentTurnFiles size: ${this.currentTurnFiles.size}`);
      if (this.currentTurnFiles.size > 0) {
        for (const [path, file] of this.currentTurnFiles) {
          mainLog('[AcpAgent]', `[STOP] Tracked file: ${path}, intent: ${file.intent}, source: ${file.source}, reason: ${file.reason}`);
        }
        this.cleanupTrackedDraftFiles().catch((err) => {
          mainError('[AcpAgent]', 'Failed to cleanup tracked files:', err);
        });
      } else {
        mainLog('[AcpAgent]', '[STOP] No tracked files to cleanup');
      }
    }

    // 6. Clear incomplete tool calls from message list
    this.emitClearIncompleteTools();

    // 6. Emit user cancelled message
    this.emitUserCancelledMessage();

    // 7. Always emit finish to ensure UI state is reset
    void this.handleSignalEvent({
      type: 'finish',
      conversation_id: this.conversation_id,
      msg_id: uuid(),
      data: null,
    });

    // 8. Clear state for next turn
    if (result !== 'cancelled') {
      // Backend was disconnected or abandoned - clear state for fresh start
      this.emitStatusMessage('disconnected');
      this.approvalStore.clear();
      this.bootstrap = undefined;
    }
  }

  /**
   * Clean up current-turn draft files on cancel. Final files are preserved.
   * 取消时只清理当前 Turn 的草稿文件，保留最终交付文件。
   */
  private async cleanupTrackedDraftFiles(): Promise<number> {
    const removedCount = await cleanupTrackedDraftsOnCancel(this.workspace, this.currentTurnFiles);
    this.currentTurnFiles.clear();
    this.currentTurnProtectedFinalPaths.clear();
    this.pendingCurrentTurnPostCleanup = false;

    if (removedCount > 0) {
      mainLog('[AcpAgent]', `[CLEANUP] Total current-turn draft files removed: ${removedCount}`);
    }

    return removedCount;
  }

  /**
   * Archive the current turn's tracked files and return the deliverables marker
   * entries built from their FINAL on-disk paths. Building happens here — after
   * `archiveTurnFiles` has moved/renamed files but before `currentTurnFiles` is
   * cleared — so the marker records the real post-archive location.
   */
  private async archiveCurrentTurnFiles(): Promise<GeneratedFileEntry[]> {
    if (!this.workspace || this.currentTurnFiles.size === 0) {
      return [];
    }

    this.currentTurnProtectedFinalPaths = this.getCurrentTurnFinalRootPaths();
    this.pendingCurrentTurnPostCleanup = true;
    const archivedPaths = await archiveTurnFiles(this.workspace, this.currentTurnFiles);
    const entries = this.buildGeneratedFileEntries(archivedPaths);
    this.currentTurnFiles.clear();
    mainLog('[AcpAgent]', '[TURN-ARCHIVE] Archived currentTurnFiles and cleared tracking');
    return entries;
  }

  private getCurrentTurnFinalRootPaths(): Set<string> {
    const protectedPaths = new Set<string>();
    if (!this.workspace || this.currentTurnFiles.size === 0) {
      return protectedPaths;
    }

    const workspaceRoot = nodePath.resolve(this.workspace);
    for (const file of this.currentTurnFiles.values()) {
      if (file.intent !== 'final') {
        continue;
      }

      const finalPath = this.resolveFinalFileDisplayPath(file, workspaceRoot);
      if (finalPath && !finalPath.startsWith(`${DRAFTS_DIR_NAME}/`)) {
        protectedPaths.add(finalPath);
      }

      const resolvedActualPath = nodePath.resolve(file.actualPath);
      const relativePath = nodePath.relative(workspaceRoot, resolvedActualPath);
      if (!relativePath || relativePath.startsWith('..') || nodePath.isAbsolute(relativePath) || relativePath.startsWith(`${DRAFTS_DIR_NAME}${nodePath.sep}`)) {
        continue;
      }

      protectedPaths.add(relativePath.replace(/\\/g, '/'));
    }

    return protectedPaths;
  }

  private getCurrentTurnFinalFileSummaries(): Array<{ path: string; reason: string }> {
    if (!this.workspace || this.currentTurnFiles.size === 0) {
      return [];
    }

    const workspaceRoot = nodePath.resolve(this.workspace);
    const seen = new Set<string>();
    const summaries: Array<{ path: string; reason: string }> = [];

    for (const file of this.currentTurnFiles.values()) {
      if (file.intent !== 'final') {
        continue;
      }

      const finalPath = this.resolveFinalFileDisplayPath(file, workspaceRoot);
      if (seen.has(finalPath)) {
        continue;
      }

      seen.add(finalPath);
      summaries.push({
        path: finalPath,
        reason: file.reason,
      });
    }

    return summaries.sort((a, b) => a.path.localeCompare(b.path));
  }

  /**
   * Build a list of `GeneratedFileEntry` records for the current turn's
   * `intent==='final'` files, enriched with on-disk size + extension + mime so
   * the renderer can show a preview card without re-stat'ing every file.
   *
   * `archivedPaths` (returned by `archiveTurnFiles`) maps tracking keys to the
   * file's FINAL on-disk location so the marker records the post-archive path
   * (after drafts → root restore + collision rename), not the pre-archive one.
   */
  private buildGeneratedFileEntries(archivedPaths?: ReadonlyMap<string, string>): GeneratedFileEntry[] {
    if (!this.workspace || this.currentTurnFiles.size === 0) return [];

    return buildGeneratedFileEntriesFromTracked({
      workspaceRoot: nodePath.resolve(this.workspace),
      trackedFiles: this.currentTurnFiles,
      archivedPaths,
      statSize: (absolutePath) => {
        try {
          const stat = fs.statSync(absolutePath);
          return stat.isFile() ? stat.size : undefined;
        } catch {
          // file may have moved between archive + lookup — leave size undefined
          return undefined;
        }
      },
    });
  }

  private resolveFinalFileDisplayPath(file: TrackedTurnFile, workspaceRoot: string, overrideAbsolutePath?: string): string {
    return resolveFinalFileDisplayPathPure(file, workspaceRoot, overrideAbsolutePath);
  }

  private emitFallbackCompletionMessage(finalFiles: Array<{ path: string; reason: string }>): void {
    const hasVisibleContentAfterLastTool = this.turnHadVisibleAssistantContent && this.lastVisibleAssistantContentSequence > this.lastToolCompletionSequence;
    if (this.userCancelled || hasVisibleContentAfterLastTool) {
      return;
    }

    let content = '执行已完成，但模型没有返回总结。';
    if (finalFiles.length > 0) {
      const fileList = finalFiles.map((file) => `- ${file.path}`).join('\n');
      content = `执行已完成。\n\n生成或更新的文件：\n${fileList}`;
    }

    this.emitMessage({
      id: uuid(),
      msg_id: uuid(),
      conversation_id: this.conversation_id,
      type: 'text',
      position: 'left',
      createdAt: Date.now(),
      status: 'finish',
      content: { content },
    });
  }

  /**
   * Emit a trailing assistant `text` message whose content is JUST the
   * `[[NEXUS_GENERATED_FILES]]` marker + JSON payload. The renderer
   * (MessagetText.tsx → GeneratedFileCard) detects it and shows preview
   * cards instead of plain text.
   *
   * This is a separate message — not appended to the assistant's prose —
   * so the renderer can style it as a "deliverables" bubble distinct from
   * the natural-language reply.
   *
   * Skipped when no final files exist (most chat-only turns).
   */
  private emitGeneratedFilesMarkerMessage(entries: GeneratedFileEntry[]): void {
    if (this.userCancelled || entries.length === 0) return;
    const content = appendGeneratedFilesMarker('', entries);
    this.emitMessage({
      id: uuid(),
      msg_id: uuid(),
      conversation_id: this.conversation_id,
      type: 'text',
      position: 'left',
      createdAt: Date.now(),
      status: 'finish',
      content: { content },
    });
    // Live-push the deliverables list to the renderer's right-panel
    // "交付物" tab so it can append without refetching from DB.
    try {
      ipcBridge.deliverables.changed.emit({ conversationId: this.conversation_id, files: entries });
    } catch (err) {
      mainLog('[AcpAgent]', `[TRACK] deliverables.changed emit failed: ${String(err)}`);
    }
  }

  private hasVisibleAssistantContent(data: unknown): boolean {
    if (typeof data === 'string') {
      return data.trim().length > 0;
    }

    if (!data || typeof data !== 'object' || !('content' in data)) {
      return false;
    }

    const content = (data as { content?: unknown }).content;
    return typeof content === 'string' && content.trim().length > 0;
  }

  private resolveWorkspacePath(requestedPath: string, intent: 'draft' | 'final' = 'final'): string {
    const workspaceRoot = nodePath.resolve(this.workspace);
    const trimmedPath = requestedPath.trim();
    const resolvedPath = nodePath.isAbsolute(trimmedPath) ? nodePath.resolve(trimmedPath) : nodePath.resolve(workspaceRoot, trimmedPath);
    const relativePath = nodePath.relative(workspaceRoot, resolvedPath);

    if (relativePath && !relativePath.startsWith('..') && !nodePath.isAbsolute(relativePath)) {
      return resolvedPath;
    }

    const fallbackDir = intent === 'draft' ? nodePath.join(workspaceRoot, DRAFTS_DIR_NAME) : workspaceRoot;
    return nodePath.join(fallbackDir, nodePath.basename(trimmedPath));
  }

  private trackTurnFile(input: { requestedPath: string; actualPath?: string; content?: string | null; source: FileIntentSource; kind: 'create' | 'edit'; operationIntent?: FileOperationIntent }): void {
    if (!this.workspace || !input.requestedPath) {
      return;
    }

    const preliminaryPath = input.actualPath || this.resolveWorkspacePath(input.requestedPath);
    const classification = this.fileIntentClassifier.classify({
      filePath: preliminaryPath,
      requestedPath: input.requestedPath,
      content: input.content,
      userMessage: this.lastUserMessage,
      source: input.source,
      operationIntent: input.operationIntent,
    });
    const actualPath = input.actualPath || this.resolveWorkspacePath(input.requestedPath);
    const workspaceRoot = nodePath.resolve(this.workspace);
    const relativePath = nodePath.relative(workspaceRoot, nodePath.resolve(actualPath));
    const trackingKey = relativePath && !relativePath.startsWith('..') && !nodePath.isAbsolute(relativePath) ? relativePath : input.requestedPath;

    this.currentTurnFiles.set(trackingKey, {
      actualPath,
      path: actualPath,
      requestedPath: input.requestedPath,
      intent: classification.intent,
      reason: classification.reason,
      source: input.source,
      kind: input.kind,
      userInitiated: classification.userInitiated,
    });
    mainLog('[AcpAgent]', `[TRACK] File: ${trackingKey}, intent: ${classification.intent}, source: ${input.source}, reason: ${classification.reason}, actualPath: ${actualPath}`);

    // Surface AI-written HTML in the right-panel browser. trackFile is the
    // earliest point where the absolute path is fully resolved (the prior
    // attempt in the write/edit/create tool-call branch relied on
    // extractFilePathFromToolCall, which returns null for many ACP backends'
    // tool argument shapes).
    if (classification.intent !== 'draft' && /\.html?$/i.test(actualPath)) {
      try {
        ipcBridge.rightPanelBrowser.open.emit({ url: `file://${actualPath}`, switchTab: true, conversationId: this.conversation_id });
        mainLog('[AcpAgent]', `[TRACK] rightPanelBrowser.open fired for ${actualPath}`);
      } catch (err) {
        mainLog('[AcpAgent]', `[TRACK] rightPanelBrowser.open emit failed: ${String(err)}`);
      }
    }
  }

  private trackRootDeliverableFile(input: { requestedPath: string; actualPath: string; kind: 'create' | 'edit' }): void {
    if (!this.workspace || !input.requestedPath) return;

    const workspaceRoot = nodePath.resolve(this.workspace);
    const relativePath = nodePath.relative(workspaceRoot, nodePath.resolve(input.actualPath));
    if (!relativePath || relativePath.startsWith('..') || nodePath.isAbsolute(relativePath) || relativePath.includes(nodePath.sep)) {
      return;
    }

    this.currentTurnFiles.set(relativePath, {
      actualPath: input.actualPath,
      path: input.actualPath,
      requestedPath: input.requestedPath,
      intent: 'final',
      reason: 'Root-level turn-end deliverable file',
      source: 'bash-generated',
      kind: input.kind,
    });
    mainLog('[AcpAgent]', `[TRACK] Root deliverable: ${relativePath}, intent: final, actualPath: ${input.actualPath}`);
  }

  /**
   * Emit clear incomplete tools message
   * 发送清理未完成工具调用的消息
   */
  private emitClearIncompleteTools(): void {
    ipcBridge.acpConversation.responseStream.emit({
      type: 'clear_incomplete_tools',
      conversation_id: this.conversation_id,
      msg_id: uuid(),
      data: null,
    });
  }

  /**
   * Track files generated by Bash tool execution
   * 追踪 Bash 工具执行产生的文件
   *
   * Scans workspace for new files after Bash completes and tracks them
   * 在 Bash 完成后扫描工作空间新增文件并追踪
   */
  private trackBashGeneratedFiles(command?: string | null): void {
    try {
      const currentSnapshot = this.getWorkspaceFiles();

      // Compare with previous snapshot to find new and modified files
      const previousSnapshot = this.workspaceFileSnapshot;
      const draftRestoreDetection = detectBashDraftRestoreCommand(command);
      const changedFiles: Array<{ path: string; kind: 'create' | 'edit' }> = [];

      for (const [file, time] of currentSnapshot) {
        if (!previousSnapshot.has(file)) {
          changedFiles.push({ path: file, kind: 'create' });
          continue;
        }

        const previousTime = previousSnapshot.get(file);
        if (previousTime !== undefined && time > previousTime) {
          changedFiles.push({ path: file, kind: 'edit' });
        }
      }

      let trackedCount = 0;
      for (const changedFile of changedFiles) {
        const file = changedFile.path;
        const relativePath = nodePath.relative(this.workspace, file);

        if (this.shouldSkipWorkspaceTrackingPath(relativePath)) continue;

        let content: string | null = null;
        try {
          content = fs.readFileSync(file, 'utf-8');
        } catch {
          content = null;
        }

        this.trackTurnFile({
          requestedPath: relativePath,
          actualPath: file,
          content,
          source: 'bash-generated',
          kind: changedFile.kind,
          operationIntent: this.isBashRestoredDraftRootFile(relativePath, previousSnapshot, draftRestoreDetection) ? 'restore-from-drafts' : undefined,
        });
        trackedCount++;
      }

      // Update snapshot for next comparison
      this.workspaceFileSnapshot = currentSnapshot;

      if (trackedCount > 0) {
        mainLog('[AcpAgent]', `[TRACK-BASH] Total changed files tracked: ${trackedCount}`);
      }
    } catch (err) {
      mainError('[AcpAgent]', 'Failed to track Bash generated files:', err);
    }
  }

  private isBashRestoredDraftRootFile(relativePath: string, previousSnapshot: Map<string, number>, detection: BashDraftRestoreDetection): boolean {
    const normalizedRelativePath = relativePath.trim().replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
    if (!normalizedRelativePath || normalizedRelativePath.startsWith('../') || normalizedRelativePath.split('/').includes(DRAFTS_DIR_NAME)) {
      return false;
    }

    const basename = nodePath.basename(normalizedRelativePath).toLowerCase();
    if (detection.explicitPaths.has(normalizedRelativePath) || detection.explicitBasenames.has(basename)) {
      return true;
    }

    if (!detection.wildcard) {
      return false;
    }

    const previousDraftPath = nodePath.join(nodePath.resolve(this.workspace), DRAFTS_DIR_NAME, nodePath.basename(relativePath));
    return previousSnapshot.has(previousDraftPath);
  }

  /**
   * Get current workspace files snapshot
   * 获取当前工作空间文件快照
   */
  private getWorkspaceFiles(): Map<string, number> {
    const snapshot = new Map<string, number>();

    try {
      // Scan workspace root
      const scanDir = (dir: string, baseDir: string) => {
        if (!fs.existsSync(dir)) return;

        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = nodePath.join(dir, entry.name);
          const relativePath = nodePath.relative(baseDir, fullPath);

          // Skip certain directories
          if (entry.isDirectory()) {
            if (this.shouldSkipWorkspaceTrackingPath(relativePath)) continue;
            scanDir(fullPath, baseDir);
          } else if (entry.isFile()) {
            if (this.shouldSkipWorkspaceTrackingPath(relativePath)) continue;
            try {
              const stat = fs.statSync(fullPath);
              snapshot.set(fullPath, stat.mtimeMs);
            } catch {
              // Ignore stat errors
            }
          }
        }
      };

      scanDir(this.workspace, this.workspace);
    } catch (err) {
      mainError('[AcpAgent]', 'Failed to get workspace files snapshot:', err);
    }

    return snapshot;
  }

  private shouldSkipWorkspaceTrackingPath(relativePath: string): boolean {
    return shouldSkipAcpWorkspaceTrackingPath(relativePath);
  }

  /**
   * Emit user cancelled message as content type
   * 发送用户终止消息（作为 content 类型，会显示在对话历史中）
   */
  private emitUserCancelledMessage(): void {
    // Emit as 'content' type so it appears in conversation history
    // and user can continue the conversation
    const msg: IResponseMessage = {
      type: 'content',
      conversation_id: this.conversation_id,
      msg_id: uuid(),
      data: '请求已被用户终止',
    };

    // Direct emit to bypass handleStreamEvent's userCancelled check
    ipcBridge.acpConversation.responseStream.emit(msg);

    // Persist to local DB
    const tMessage: TMessage = {
      id: msg.msg_id,
      msg_id: msg.msg_id,
      type: 'text',
      position: 'left',
      conversation_id: this.conversation_id,
      content: { content: msg.data as string },
      createdAt: Date.now(),
    };
    addOrUpdateMessage(this.conversation_id, tMessage);
  }

  kill(): Promise<void> {
    this.streamTextBuffer.flushAll();
    this.toolCallMeta.clear();
    this.workspaceFileSnapshot.clear();

    const HARD_TIMEOUT_MS = 3000;

    const waiters = this.acpAvailableSlashWaiters.splice(0, this.acpAvailableSlashWaiters.length);
    for (const resolve of waiters) {
      resolve([]);
    }
    this.acpAvailableSlashCommands = [];

    // Return a promise that resolves when the child process is terminated.
    // This allows callers (e.g. WorkerManage.clear → before-quit) to await
    // cleanup and prevents orphaned scode processes on Windows.
    return new Promise<void>((resolve) => {
      const hardTimer = setTimeout(() => {
        mainWarn('[AcpAgent]', 'kill(): hard timeout reached, resolving anyway');
        resolve();
      }, HARD_TIMEOUT_MS);

      (this.connection?.disconnect?.() || Promise.resolve())
        .catch((err) => {
          mainWarn('[AcpAgent]', 'connection.disconnect() failed during kill', err);
        })
        .finally(() => {
          clearTimeout(hardTimer);
          resolve();
        });
    });
  }

  /**
   * Restart the underlying ACP connection and reconnect.
   * Disconnects current connection, clears bootstrap, then re-initializes.
   */
  async restartAndConnect(): Promise<void> {
    // Disconnect current connection (kills process, clears session state)
    this.plannedRestartInProgress = true;
    try {
      await this.connection.disconnect();
      // Clear bootstrap so initAgent creates a fresh connection
      this.bootstrap = undefined;
      // Clear pending state
      this.pendingPermissions.clear();
      this.permissionRequestMeta.clear();
      this.approvalStore.clear();
      this.pendingNavigationTools.clear();
      this.statusMessageId = null;
      // Re-initialize agent connection
      await this.initAgent();
    } finally {
      this.plannedRestartInProgress = false;
    }
  }

  async ensureYoloMode(): Promise<boolean> {
    if (this.options.yoloMode) {
      return true;
    }
    this.options.yoloMode = true;
    if (this.connection?.isConnected && this.connection?.hasActiveSession) {
      try {
        this.extra.yoloMode = true;
        const yoloModeMap: Partial<Record<AcpBackend, string>> = {
          claude: CLAUDE_YOLO_SESSION_MODE,
          qwen: QWEN_YOLO_SESSION_MODE,
        };
        const sessionMode = yoloModeMap[this.extra.backend];
        if (sessionMode) {
          await this.connection.setSessionMode(sessionMode);
        }
        return true;
      } catch (error) {
        mainError('[AcpAgent]', 'Failed to enable yoloMode dynamically', error);
        return false;
      }
    }
    return true;
  }

  // ========== Model / Mode / Config API ==========

  getModelInfo(): AcpModelInfo | null {
    let modelInfo: AcpModelInfo | null = null;
    if (!this.connection?.isConnected) {
      if (this.persistedModelId) {
        modelInfo = {
          source: 'models',
          currentModelId: this.persistedModelId,
          currentModelLabel: this.persistedModelId,
          canSwitch: false,
          availableModels: [],
        };
      }
    } else {
      modelInfo = buildAcpModelInfo(this.connection.getConfigOptions(), this.connection.getModels());
    }

    if (this.options.backend === 'scode') {
      return mergeScodeProxyModelInfo(modelInfo, this.persistedModelId);
    }

    return modelInfo;
  }

  async setModel(modelId: string): Promise<AcpModelInfo | null> {
    const normalizedModelId = modelId.trim();
    if (!normalizedModelId) {
      return this.getModelInfo();
    }

    if (!this.connection?.isConnected) {
      try {
        await this.initAgent(this.options);
      } catch {
        return null;
      }
    }

    if (this.options.backend === 'scode') {
      this.persistedModelId = normalizedModelId;
      this.userModelOverride = normalizedModelId;
      this.pendingModelSwitchNotice = normalizedModelId;
      saveModelId(this.conversation_id, normalizedModelId);
      this.options.currentModelId = normalizedModelId;
      this.extra.customEnv = {
        ...this.extra.customEnv,
        SUDOCODE_CURRENT_MODEL_ID: normalizedModelId,
      };
    }

    // The live `session/set_model` RPC is the single authoritative model-switch
    // path: scode's handle_acp_model_switch rebuilds the runtime with the new
    // model + auth mode in place, keeping the session intact (the "not connected"
    // guard above already reconnects a dropped socket first). A failure here is a
    // real switch failure and surfaces to the caller — we no longer respawn the
    // engine as a fallback. That legacy fallback existed only to make the process
    // re-read the model from env at startup; the live RPC now applies model + auth
    // in place, so it was redundant. Recovering a hung/dead connection is a
    // separate concern with its own path (conversation.restart-and-connect / the
    // "Restart & Connect" action), and the resume fix (session/load) means a
    // switch never needs a restart to keep context.
    const result = await this.setModelByConfigOption(normalizedModelId);

    if (result) {
      this.persistedModelId = result.currentModelId || normalizedModelId;
      saveModelId(this.conversation_id, this.persistedModelId);
      if (result.availableModels?.length > 0) {
        void this.cacheModelList(result);
      }
    }
    return result;
  }

  private async setModelByConfigOption(modelId: string): Promise<AcpModelInfo | null> {
    const modelInfo = this.getModelInfo();
    if (!modelInfo) {
      throw new Error('No model info available');
    }

    try {
      await this.connection.setModel(modelId);
    } catch (setModelError) {
      if (modelInfo.source === 'configOption' && modelInfo.configOptionId) {
        await this.connection.setConfigOption(modelInfo.configOptionId, modelId);
      } else {
        throw setModelError;
      }
    }

    this.userModelOverride = modelId;
    this.pendingModelSwitchNotice = modelId;
    this.persistedModelId = modelId;
    return this.getModelInfo();
  }

  getConfigOptions(): AcpSessionConfigOption[] {
    const all = this.connection.getConfigOptions();
    if (!all) return [];
    return all.filter((opt) => opt.category !== 'model' && opt.category !== 'mode');
  }

  async setConfigOption(configId: string, value: string): Promise<AcpSessionConfigOption[]> {
    if (!this.connection?.isConnected) {
      try {
        await this.initAgent(this.options);
      } catch {
        return [];
      }
    }
    await this.connection.setConfigOption(configId, value);
    return this.getConfigOptions();
  }

  getMode(): { mode: string; initialized: boolean } {
    return { mode: this.currentMode, initialized: this.connection?.isConnected ?? false };
  }

  async setMode(mode: string): Promise<{ success: boolean; msg?: string; data?: { mode: string } }> {
    if (this.options.backend === 'codex' || this.options.backend === 'scode') {
      const prev = this.currentMode;
      this.currentMode = mode;
      this.yoloMode = this.isYoloMode(mode);
      saveSessionMode(this.conversation_id, mode);
      if (this.isYoloMode(prev) && !this.isYoloMode(mode)) {
        void this.clearLegacyYoloConfig();
      }
      return { success: true, data: { mode: this.currentMode } };
    }

    if (!this.connection?.isConnected) {
      try {
        await this.initAgent(this.options);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return { success: false, msg: `Agent initialization failed: ${errorMsg}` };
      }
    }

    try {
      await this.connection.setSessionMode(mode);
      const prev = this.currentMode;
      this.currentMode = mode;
      this.yoloMode = this.isYoloMode(mode);
      saveSessionMode(this.conversation_id, mode);
      if (this.isYoloMode(prev) && !this.isYoloMode(mode)) {
        void this.clearLegacyYoloConfig();
      }
      return { success: true, data: { mode: this.currentMode } };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { success: false, msg: errorMsg };
    }
  }

  // ========== Slash Commands ==========

  getAcpSlashCommands(): SlashCommandItem[] {
    return this.acpAvailableSlashCommands.map((item) => ({ ...item }));
  }

  async loadAcpSlashCommands(timeoutMs: number = 6000): Promise<SlashCommandItem[]> {
    if (this.acpAvailableSlashCommands.length > 0) {
      return this.getAcpSlashCommands();
    }

    if (!this.bootstrap) {
      return [];
    }

    try {
      await this.bootstrap;
    } catch (error) {
      mainWarn('AcpAgent', 'Agent initialization failed while loading ACP slash commands:', error);
      return this.getAcpSlashCommands();
    }

    if (this.acpAvailableSlashCommands.length > 0) {
      return this.getAcpSlashCommands();
    }

    return await new Promise<SlashCommandItem[]>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const wrappedResolve = (commands: SlashCommandItem[]) => {
        if (timer) {
          clearTimeout(timer);
        }
        resolve(commands);
      };
      timer = setTimeout(() => {
        this.acpAvailableSlashWaiters = this.acpAvailableSlashWaiters.filter((waiter) => waiter !== wrappedResolve);
        resolve(this.getAcpSlashCommands());
      }, timeoutMs);

      this.acpAvailableSlashWaiters.push(wrappedResolve);
    });
  }

  // ========== Connection Event Handlers ==========

  private handleSessionUpdate(data: AcpSessionUpdate): void {
    // Ignore most session updates if user has cancelled
    // But still process Bash tool completions to track generated files for cleanup
    // 用户取消后忽略大部分 session 更新，但仍然处理 Bash 工具完成事件以追踪生成的文件用于清理
    if (this.userCancelled) {
      // Special handling: still track Bash-generated files even after cancel
      // 特殊处理：即使取消后仍然追踪 Bash 生成的文件
      if (data.update?.sessionUpdate === 'tool_call_update') {
        const statusUpdate = data as ToolCallUpdateStatus;
        const toolCallId = statusUpdate.update?.toolCallId;
        const toolStatus = statusUpdate.update?.status;
        const rawInput = statusUpdate.update?.rawInput;

        if (toolStatus === 'completed' && rawInput) {
          // Check if this is a Bash tool
          const meta = this.toolCallMeta.get(toolCallId);
          if (meta && meta.toolName.toLowerCase() === 'bash') {
            mainLog('[AcpAgent]', `[TRACK-BASH-CANCEL] Bash completed after cancel, tracking generated files`);
            const command = (rawInput?.command ?? meta.rawInput?.command) as string | undefined;
            this.trackBashGeneratedFiles(command);
          }
        }
      }

      mainLog('[AcpAgent]', `Ignoring session update after user cancel: sessionUpdate=${data.update?.sessionUpdate}`);
      return;
    }

    try {
      if (data.update?.sessionUpdate === 'available_commands_update') {
        const commandUpdate = data as AvailableCommandsUpdate;
        const commands: AcpAvailableCommand[] = [];
        for (const command of commandUpdate.update?.availableCommands || []) {
          const name = command.name?.trim();
          if (!name) continue;
          const description = (command.description || command.name || '').trim();
          commands.push({
            name,
            description: description || name,
            hint: command.input?.hint?.trim(),
          });
        }
        this.handleAvailableCommandsUpdate(commands);
      }

      if (data.update?.sessionUpdate === 'tool_call') {
        const toolCallUpdate = data as ToolCallUpdate;
        const toolName = toolCallUpdate.update?.title || '';
        const toolCallId = toolCallUpdate.update?.toolCallId;
        console.log(`[AcpAgent] tool_call event: toolName=${toolName}, toolCallId=${toolCallId}`);

        // Breadcrumb: MCP/tool call started
        mcpBreadcrumbs.toolCall(toolName, 'acp', this.conversation_id);

        // Telemetry: start tool call step tracking
        const turnId = getCurrentTurnId(this.conversation_id);
        if (turnId && toolCallId) {
          // Determine tool kind based on tool name
          const toolKind = this.getToolKind(toolName);
          startToolCallTracking(this.conversation_id, turnId, toolCallId, toolName, toolKind, this.options.backend);
        }

        // Store tool call meta for file_send detection
        if (toolCallId) {
          this.toolCallMeta.set(toolCallId, {
            toolName,
            rawInput: toolCallUpdate.update?.rawInput as Record<string, unknown> | undefined,
          });
        }

        // Structured form so ai-dev-browser invocations whose outer tool
        // title is "Bash"/"Shell" (with the real `aidb page_goto --url …`
        // buried in `rawInput.command`) also trigger the preview-open.
        const navData: NavigationToolData = {
          toolName,
          rawInput: toolCallUpdate.update?.rawInput as Record<string, unknown> | undefined,
          content: toolCallUpdate.update?.content as NavigationToolData['content'],
        };
        if (NavigationInterceptor.isNavigationTool(navData)) {
          if (toolCallId) {
            this.pendingNavigationTools.add(toolCallId);
          }
          const url = NavigationInterceptor.extractUrl(navData);
          if (url) {
            const previewMessage = NavigationInterceptor.createPreviewMessage(url, this.conversation_id);
            this.handleStreamEvent(previewMessage);
          }
        }

        if (this.extra.backend !== 'scode') {
          const questionMessage = this.adapter.buildQuestionMessageFromToolCall(toolCallUpdate);
          if (questionMessage) {
            this.emitMessage(questionMessage);
          }
        }
      }

      if (data.update?.sessionUpdate === 'tool_call_update') {
        const statusUpdate = data as ToolCallUpdateStatus;
        const toolCallId = statusUpdate.update?.toolCallId;
        const toolStatus = statusUpdate.update?.status;
        if (toolStatus === 'completed' || toolStatus === 'failed') {
          this.lastToolCompletionSequence = ++this.turnEventSequence;
        }

        // Breadcrumb: MCP/tool call result
        if (toolStatus === 'completed' || toolStatus === 'failed') {
          mcpBreadcrumbs.toolResult(toolCallId || 'unknown', toolStatus === 'completed');
        }

        // Telemetry: end tool call step tracking
        if (toolStatus === 'completed' || toolStatus === 'failed') {
          if (toolCallId) {
            endToolCallTracking(toolCallId, toolStatus === 'completed' ? 'success' : 'error');
          }
        }

        // Generate user message for SendUserMessage/AskUserQuestion tool results
        if (toolStatus === 'completed') {
          const userMessage = this.adapter.generateUserMessageFromToolCall(statusUpdate);
          if (userMessage) {
            this.emitMessage(userMessage);
          }
        }

        // Intercept file-creation tool calls: send generated files to channel clients (e.g., WeChat, Lark)
        if (toolStatus === 'completed' && toolCallId) {
          const meta = this.toolCallMeta.get(toolCallId);
          console.log(`[AcpAgent] tool_call_update completed: toolCallId=${toolCallId}, hasMeta=${!!meta}, meta=${meta ? JSON.stringify({ toolName: meta.toolName, rawInput: meta.rawInput }) : 'null'}`);
          if (meta) {
            const toolName = meta.toolName;
            const rawInput = meta.rawInput;
            console.log(`[AcpAgent] Processing tool call: toolName=${toolName}, lastUserMessage=${this.lastUserMessage?.substring(0, 50)}...`);

            // ★ Track file operations for precise cleanup on cancel
            const n = toolName.toLowerCase();
            if (n === 'write_file' || n === 'edit_file') {
              const inputPath = rawInput?.path as string | undefined;
              const content = rawInput?.content as string | undefined;
              if (inputPath) {
                this.trackTurnFile({
                  requestedPath: inputPath,
                  content,
                  source: n === 'write_file' ? 'write' : 'edit',
                  kind: n === 'write_file' ? 'create' : 'edit',
                });
              }
            }

            // ★ Track files generated by Bash tool (scan workspace for new files)
            // 追踪 Bash 工具产生的文件（扫描工作空间新增文件）
            if (n === 'bash') {
              mainLog('[AcpAgent]', `[TRACK-BASH] Bash tool detected, status: ${toolStatus}`);
              if (toolStatus === 'completed') {
                this.trackBashGeneratedFiles(rawInput?.command as string | undefined);
                this.deliverBashGeneratedFilesToChannel();
              }
            }

            // Strategy 1: SendUserMessage tool - Agent explicitly sends files to user
            // This is the preferred way for Agent to send files
            if (n === 'sendusermessage' || n === 'brief') {
              const attachments = rawInput?.attachments as Array<string> | undefined;
              if (attachments && attachments.length > 0) {
                for (const attachmentPath of attachments) {
                  if (typeof attachmentPath === 'string' && attachmentPath.trim()) {
                    this.sendFileToChannels(attachmentPath.trim());
                  }
                }
                this.refreshWorkspaceFileSnapshot();
              }
            }
            // Strategy 2: write_file tool - Auto-send files when user requested them
            // This handles cases where Agent creates files but doesn't use SendUserMessage
            else if (/write|edit|create/.test(n)) {
              console.log(`[AcpAgent] Detected write/edit/create tool: ${toolName}`);
              const filePath = this.extractFilePathFromToolCall(toolName, rawInput);
              console.log(`[AcpAgent] extractFilePathFromToolCall result: ${filePath}`);
              if (filePath) {
                // If the AI wrote an .html / .htm file, surface it in the
                // right-panel browser. Independent of the channel-auto-send
                // decision below — the browser view is opt-in user-visible,
                // not a network action.
                if (/\.html?$/i.test(filePath)) {
                  try {
                    ipcBridge.rightPanelBrowser.open.emit({ url: `file://${filePath}`, switchTab: true, conversationId: this.conversation_id });
                  } catch (err) {
                    console.log(`[AcpAgent] rightPanelBrowser.open emit failed: ${String(err)}`);
                  }
                }

                // Check if user's original message indicates they want the file sent
                const userMessage = this.lastUserMessage?.toLowerCase() || '';
                const userWantsFileSent = /发我|发给我|发送给我|发给我|发到|发送到|发来|发过来|send me|send to me/i.test(userMessage);
                console.log(`[AcpAgent] userWantsFileSent=${userWantsFileSent}, userMessage="${userMessage.substring(0, 100)}"`);
                // Also check if file is NOT a draft (intermediate file)
                const ext = nodePath.extname(filePath).toLowerCase();
                const isDraftExtension = ext === '.md' && (filePath.includes('temp') || filePath.includes('payload') || filePath.includes('draft'));
                const isIntermediateScript = ext === '.py' && (filePath.includes('create_') || filePath.includes('generate_') || filePath.includes('convert_'));
                console.log(`[AcpAgent] ext=${ext}, isDraftExtension=${isDraftExtension}, isIntermediateScript=${isIntermediateScript}`);

                if (userWantsFileSent && !isDraftExtension && !isIntermediateScript) {
                  console.log(`[AcpAgent] User requested file, auto-sending: ${filePath}`);
                  this.sendFileToChannels(filePath);
                  this.refreshWorkspaceFileSnapshot();
                } else {
                  console.log(`[AcpAgent] Skipping file send: userWantsFileSent=${userWantsFileSent}, isDraft=${isDraftExtension}, isIntermediate=${isIntermediateScript}`);
                }
              }
            } else {
              console.log(`[AcpAgent] Tool ${toolName} does not match write/edit/create pattern`);
            }
          }
          // Clean up tool call meta after processing
          this.toolCallMeta.delete(toolCallId);
        }

        if (toolCallId && this.pendingNavigationTools.has(toolCallId)) {
          if (statusUpdate.update?.status === 'completed' && statusUpdate.update?.content) {
            for (const item of statusUpdate.update.content) {
              const text = item.content?.text || '';
              const urlMatch = text.match(/https?:\/\/[^\s<>"]+/i);
              if (urlMatch) {
                const previewMessage = NavigationInterceptor.createPreviewMessage(urlMatch[0], this.conversation_id);
                this.handleStreamEvent(previewMessage);
                break;
              }
            }
          }
          this.pendingNavigationTools.delete(toolCallId);
        }
      }

      if (data.update?.sessionUpdate === 'usage_update') {
        this.hasReceivedUsageUpdate = true;
        const usageUpdate = data.update as { used: number; size: number; cost?: { amount: number; currency: string } };
        this.handleStreamEvent({
          type: 'acp_context_usage',
          conversation_id: this.conversation_id,
          msg_id: uuid(),
          data: {
            used: usageUpdate.used,
            size: usageUpdate.size,
            cost: usageUpdate.cost,
          },
        });
      }

      if (data.update?.sessionUpdate === 'config_option_update') {
        this.emitModelInfoEvent();
      }

      this.handleStreamedContextLimitError(data);

      const messages = this.adapter.convertSessionUpdate(data);
      for (let i = 0; i < messages.length; i++) {
        this.emitMessage(messages[i]);
      }
    } catch (error) {
      this.emitErrorMessage(`Failed to process session update: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private handleStreamedContextLimitError(data: AcpSessionUpdate): void {
    if (data.update?.sessionUpdate !== 'agent_message_chunk') return;

    const content = data.update.content as { text?: string } | undefined;
    const text = content?.text;
    if (!text) return;

    this.streamedContextErrorBuffer = (this.streamedContextErrorBuffer + text).slice(-4000);
    const classification = classifyLlmError(this.streamedContextErrorBuffer);
    if (!CONTEXT_OVERFLOW_REASONS.has(classification.type)) return;

    // Defer the "should session be torn down?" decision to the classifier's SSOT.
    // single_request_too_large and request_body_too_large both have
    // recoverableByNewSession=false because they're per-request size errors —
    // poisoning the session would silently drop chat history on every
    // oversized-attach attempt. Only context_window_exceeded sets the flag true.
    if (!classification.recoverableByNewSession) return;

    const reason = classification.type === 'request_body_too_large' ? 'request_body_too_large' : classification.type === 'single_request_too_large' ? 'single_request_too_large' : 'context_window_exceeded';
    void this.markRuntimeContextPoisoned(classification.userMessage, reason, { disconnectNow: false });
  }

  private handlePermissionRequest(data: AcpPermissionRequest): Promise<{ optionId: string }> {
    return new Promise((resolve, reject) => {
      if (data.toolCall && !data.toolCall.toolCallId) {
        data.toolCall.toolCallId = uuid();
      }
      const requestId = data.toolCall.toolCallId;

      // Telemetry: start permission request step tracking
      const turnId = getCurrentTurnId(this.conversation_id);
      let stepId: string | undefined;
      if (turnId && data.toolCall.kind) {
        stepId = startPermissionRequestTracking(this.conversation_id, turnId, data.toolCall.kind, this.options.backend);
      }

      // In yolo/bypassPermissions mode, auto-approve all permission requests
      if (this.yoloMode) {
        // Telemetry: end permission request step tracking (auto-approved)
        if (stepId) {
          endPermissionRequestTracking(stepId, true);
        }
        resolve({ optionId: 'allow_always' });
        return;
      }

      const approvalKey = createAcpApprovalKey(data.toolCall);
      if (this.approvalStore.isApprovedForSession(approvalKey)) {
        // Telemetry: end permission request step tracking (pre-approved)
        if (stepId) {
          endPermissionRequestTracking(stepId, true);
        }
        resolve({ optionId: 'allow_always' });
        return;
      }

      if (this.permissionRequestMeta.has(requestId)) {
        this.permissionRequestMeta.delete(requestId);
      }

      this.permissionRequestMeta.set(requestId, {
        kind: data.toolCall.kind,
        title: data.toolCall.title,
        rawInput: data.toolCall.rawInput,
        stepId, // Store stepId for ending tracking on confirm
      });

      const toolName = data.toolCall?.title || '';
      const permissionNavData: NavigationToolData = {
        toolName,
        rawInput: data.toolCall?.rawInput as Record<string, unknown> | undefined,
        content: data.toolCall?.content as NavigationToolData['content'],
      };
      if (NavigationInterceptor.isNavigationTool(permissionNavData)) {
        const url = NavigationInterceptor.extractUrl(permissionNavData);
        if (url) {
          const previewMessage = NavigationInterceptor.createPreviewMessage(url, this.conversation_id);
          this.handleStreamEvent(previewMessage);
        }
        this.pendingNavigationTools.add(requestId);
      }

      if (this.pendingPermissions.has(requestId)) {
        const oldRequest = this.pendingPermissions.get(requestId);
        if (oldRequest) {
          oldRequest.reject(new Error('Replaced by new permission request'));
        }
        this.pendingPermissions.delete(requestId);
      }

      this.pendingPermissions.set(requestId, { resolve, reject });

      try {
        this.emitPermissionRequest(data);
      } catch (error) {
        this.pendingPermissions.delete(requestId);
        reject(error);
        return;
      }

      setTimeout(
        () => {
          if (this.pendingPermissions.has(requestId)) {
            this.pendingPermissions.delete(requestId);
            reject(new Error('Permission request timed out'));
          }
        },
        10 * 60 * 1000
      );
    });
  }

  private handleQuestionRequest(data: AcpQuestionRequest): Promise<{ answers: AcpQuestionResponseAnswer[] }> {
    return new Promise((resolve, reject) => {
      const requestId = this.resolveQuestionRequestId(data.toolCallId);

      if (this.pendingQuestions.has(requestId)) {
        const oldRequest = this.pendingQuestions.get(requestId);
        if (oldRequest) {
          oldRequest.reject(new Error('Replaced by new question request'));
        }
        this.pendingQuestions.delete(requestId);
      }

      const msgId = `${requestId}-user-msg`;
      this.pendingQuestions.set(requestId, { resolve, reject, msgId });

      try {
        this.emitMessage({
          id: uuid(),
          type: 'acp_question',
          msg_id: msgId,
          conversation_id: this.conversation_id,
          createdAt: Date.now(),
          position: 'left',
          content: {
            question: data.title || data.description || data.questions[0]?.prompt || 'Question',
            intro: data.description,
            options: [],
            items: data.questions.map((question) => ({
              id: question.id,
              prompt: question.prompt,
              kind: question.kind,
              options: question.options.map((option) => ({
                label: option.label,
                value: option.value,
                description: option.description,
                recommended: option.recommended === true,
              })),
              allowCustomInput: question.allowCustomInput === true,
              customInputHint: question.customInputHint,
              optional: !question.required,
            })),
            conversationId: this.conversation_id,
            toolCallId: requestId,
            answered: false,
          },
        });
      } catch (error) {
        this.pendingQuestions.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }

      setTimeout(
        () => {
          if (this.pendingQuestions.has(requestId)) {
            this.pendingQuestions.delete(requestId);
            mainWarn('AcpAgent', `Question request timed out: requestId=${requestId}`);
            this.emitQuestionCancelled(msgId);
            reject(new Error('Question request timed out'));
          }
        },
        10 * 60 * 1000
      );
    });
  }

  /**
   * Emit an acp_question update that records the user's answers so the card
   * stays in the "answered" state after DB persistence / tab switches.
   * 发送一个 acp_question 更新，将用户答案持久化到消息存储，避免切换会话后回显丢失。
   */
  private emitQuestionAnswered(msgId: string, answers: AcpQuestionResponseAnswer[]): void {
    const answerItems = answers.map((answer, idx) => {
      const submissionValue = answer.value ?? '';
      const labelValue = typeof answer.label === 'string' ? answer.label : '';
      const skipped = submissionValue === '[skipped]';
      const displayValue = skipped ? '' : labelValue || submissionValue;
      return {
        id: answer.id,
        index: idx + 1,
        submissionValue,
        displayValue,
        skipped,
      };
    });

    let selectedAnswer: string;
    if (answerItems.length === 1) {
      const only = answerItems[0];
      selectedAnswer = only.displayValue || '[skipped]';
    } else {
      selectedAnswer = answerItems.map((item) => `${item.index}. ${item.skipped ? '[skipped]' : item.displayValue}`).join('\n');
    }

    // Only include the fields that change: question/options/items/intro must be
    // omitted so chatLib.composeMessage's shallow merge does not clobber the
    // original prompt text on tab-switch reload.
    // 只发送变化字段；composeMessage 用浅合并，若包含 question/options 会覆盖原始题面。
    const partialContent = {
      conversationId: this.conversation_id,
      answered: true,
      selectedAnswer,
      answerItems,
    } as unknown as AcpQuestionData;

    this.emitMessage({
      id: uuid(),
      type: 'acp_question',
      msg_id: msgId,
      conversation_id: this.conversation_id,
      createdAt: Date.now(),
      position: 'left',
      content: partialContent,
    });
  }

  /**
   * Emit an acp_question update that marks the card as cancelled, so the renderer
   * can switch out of the interactive state when stop() or the timeout fires.
   * 发送一个 acp_question 更新，将卡片标记为已取消，便于渲染端退出交互态。
   */
  private emitQuestionCancelled(msgId: string): void {
    try {
      this.emitMessage({
        id: uuid(),
        type: 'acp_question',
        msg_id: msgId,
        conversation_id: this.conversation_id,
        createdAt: Date.now(),
        position: 'left',
        content: {
          // Required by AcpQuestionData; the renderer merges partial updates by msg_id.
          question: '',
          options: [],
          conversationId: this.conversation_id,
          answered: true,
          cancelled: true,
        },
      });
    } catch {
      // Best-effort UI hint; never let emit errors mask the underlying rejection.
    }
  }

  private resolveQuestionRequestId(requestToolCallId: string): string {
    if (requestToolCallId && this.toolCallMeta.has(requestToolCallId)) {
      return requestToolCallId;
    }

    const latestAskUserQuestion = Array.from(this.toolCallMeta.entries())
      .reverse()
      .find(([, meta]) => meta.toolName === 'AskUserQuestion');

    return latestAskUserQuestion?.[0] || requestToolCallId;
  }

  private async handleEndTurn(): Promise<void> {
    if (!this.userCancelled) {
      // Telemetry: end turn tracking (success)
      endTurnSuccess(this.conversation_id);

      // Telemetry: end conversation tracking (success)
      endConversationSuccess(this.conversation_id);

      // Breadcrumb: conversation ended (success)
      conversationBreadcrumbs.end(this.conversation_id, 'success');
    }

    if (!this.userCancelled) {
      await this.installTrackedWorkspaceSkills();
      // Turn-end fallback: discover root-level deliverables the per-tool tracking
      // missed and both forward them to channels AND track them, so they enter
      // currentTurnFiles → the deliverables marker (not only the temp space /
      // channel). Must run before the final-file summary + archive below.
      this.deliverWorkspaceFilesAtTurnEnd();
      const finalFiles = this.getCurrentTurnFinalFileSummaries();
      // Archive FIRST, then build the marker from the returned final paths, so
      // the recorded path matches the file's real post-archive location.
      const generatedEntries = await this.archiveCurrentTurnFiles();
      this.emitFallbackCompletionMessage(finalFiles);
      this.emitGeneratedFilesMarkerMessage(generatedEntries);
    }

    const msg: IResponseMessage = {
      type: 'finish',
      conversation_id: this.conversation_id,
      msg_id: uuid(),
      data: null,
    };
    void this.handleSignalEvent(msg);
  }

  private async installTrackedWorkspaceSkills(): Promise<void> {
    if (!this.workspace) {
      return;
    }

    try {
      const results = await installWorkspaceSkillsFromTrackedFiles(this.workspace, this.currentTurnFiles, {
        getCustomSkillsDir,
        existingCustomSkillNames: this.customSkillsSnapshot,
        clearSkillsCache,
        resetAcpSkillManager: () => AcpSkillManager.resetInstance(),
      });
      const installed = results.filter((result) => result.status === 'installed');
      const registered = results.filter((result) => result.status === 'registered');
      const updated = results.filter((result) => result.status === 'updated');
      const changed = [...installed, ...registered, ...updated];

      if (changed.length === 0) {
        if (results.length > 0) {
          mainLog('[AcpAgent]', '[SKILL-INSTALL] No workspace skills installed', {
            skipped: results.map((result) => ({
              sourceDir: result.sourceDir,
              reason: result.status === 'skipped' ? result.reason : undefined,
              skillName: result.skillName,
            })),
          });
        }
        return;
      }

      for (const result of changed) {
        const action = result.status === 'installed' ? 'Installed' : result.status === 'updated' ? 'Updated' : 'Registered';
        mainLog('[AcpAgent]', `[SKILL-INSTALL] ${action} workspace skill "${result.skillName}"`, {
          sourceDir: result.sourceDir,
          targetDir: result.targetDir,
          installedVersion: result.installedVersion,
          status: result.status,
        });
        ipcBridge.skillHub.changed.emit({
          skillName: result.skillName,
          source: 'workspace',
        });
      }
      this.emitWorkspaceSkillInstallMessage(changed);
    } catch (error) {
      mainWarn('[AcpAgent]', '[SKILL-INSTALL] Failed to install workspace skills', error);
    }
  }

  private emitWorkspaceSkillInstallMessage(skills: Array<{ skillName: string; targetDir: string; status?: 'installed' | 'registered' | 'updated' }>): void {
    const skillNames = Array.from(new Set(skills.map((skill) => skill.skillName))).filter(Boolean);
    if (skillNames.length === 0) {
      return;
    }

    const skillList = skillNames.map((skillName) => `- ${skillName}`).join('\n');
    const allUpdated = skills.every((skill) => skill.status === 'updated');
    const actionText = allUpdated ? '更新' : '安装/更新';
    const content = skillNames.length === 1 ? `技能已${actionText}到自定义技能：${skillNames[0]}\n\n你可以在“技能商店 > 我的技能 > 自定义技能”中查看。` : `以下技能已${actionText}到自定义技能：\n\n${skillList}\n\n你可以在“技能商店 > 我的技能 > 自定义技能”中查看。`;

    this.emitMessage({
      id: uuid(),
      msg_id: uuid(),
      conversation_id: this.conversation_id,
      type: 'text',
      position: 'left',
      createdAt: Date.now(),
      status: 'finish',
      content: { content },
    });
  }

  private handlePromptUsage(usage: AcpPromptResponseUsage): void {
    // Telemetry: update turn token usage
    updateTurnTokens(this.conversation_id, usage);

    const tokenUsage = normalizePromptUsageForMessage(usage);
    if (tokenUsage) {
      if (this.lastAssistantTextMsgId) {
        // Assistant text already arrived - patch usage directly
        this.patchAssistantTokenUsage(this.lastAssistantTextMsgId, tokenUsage, { flush: true });
      } else {
        // Usage arrived before assistant text - store as pending
        this.pendingTokenUsage = tokenUsage;
        mainLog('[AcpAgent]', `[PENDING-USAGE] Stored pending usage: total=${tokenUsage.totalTokens}`);
      }
    }

    if (this.hasReceivedUsageUpdate) return;
    const used = usage.estimatedSessionTokens ?? usage.totalTokens;
    const size = usage.contextWindowTokens ?? 0;
    this.handleStreamEvent({
      type: 'acp_context_usage',
      conversation_id: this.conversation_id,
      msg_id: uuid(),
      data: {
        used,
        size,
      },
    });
  }

  private handleFileOperation(operation: { method: string; path: string; content?: string; sessionId: string }): void {
    // Telemetry: record file operation step
    const turnId = getCurrentTurnId(this.conversation_id);
    if (turnId) {
      const operationType = operation.method.includes('write') ? 'write' : operation.method.includes('read') ? 'read' : 'delete';
      recordFileOperationStep(this.conversation_id, turnId, operationType, operation.path, 'success', this.options.backend);
    }

    this.trackWrittenWorkspaceFile(operation);

    let text: string;
    switch (operation.method) {
      case 'fs/write_text_file':
        text = `📝 File written: \`${operation.path}\`\n\n\`\`\`\n${operation.content || ''}\n\`\`\``;
        break;
      case 'fs/read_text_file':
        text = `📖 File read: \`${operation.path}\``;
        break;
      default:
        text = `🔧 File operation: \`${operation.path}\``;
    }

    const message: TMessage = {
      id: uuid(),
      conversation_id: this.conversation_id,
      type: 'text',
      position: 'left',
      createdAt: Date.now(),
      content: { content: text },
    };
    this.emitMessage(message);
  }

  private getCustomSkillNames(): Set<string> {
    const names = new Set<string>();
    const customSkillsDir = getCustomSkillsDir();

    try {
      if (!fs.existsSync(customSkillsDir)) {
        return names;
      }

      for (const entry of fs.readdirSync(customSkillsDir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          names.add(entry.name);
        }
      }
    } catch (error) {
      mainWarn('[AcpAgent]', '[SKILL-INSTALL] Failed to snapshot custom skills', error);
    }

    return names;
  }

  private trackWrittenWorkspaceFile(operation: { method: string; path: string; content?: string }): void {
    if (!this.workspace || operation.method !== 'fs/write_text_file') {
      return;
    }

    const workspaceRoot = nodePath.resolve(this.workspace);
    const actualPath = nodePath.isAbsolute(operation.path) ? nodePath.resolve(operation.path) : nodePath.resolve(workspaceRoot, operation.path);
    const relativePath = nodePath.relative(workspaceRoot, actualPath);
    if (!relativePath || relativePath.startsWith('..') || nodePath.isAbsolute(relativePath)) {
      return;
    }

    this.trackTurnFile({
      requestedPath: operation.path,
      actualPath,
      content: operation.content,
      source: 'write',
      kind: fs.existsSync(actualPath) ? 'edit' : 'create',
    });
  }

  private handleDisconnect(error: { code: number | null; signal: NodeJS.Signals | null }): void {
    if (this.plannedRestartInProgress) {
      mainLog('[AcpAgent]', `Ignoring planned ${this.extra.backend} disconnect during restart (code: ${error.code}, signal: ${error.signal})`);
      this.emitStatusMessage('disconnected');
      this.pendingPermissions.clear();
      this.permissionRequestMeta.clear();
      this.approvalStore.clear();
      this.pendingNavigationTools.clear();
      this.statusMessageId = null;
      this.bootstrap = undefined;
      return;
    }

    this.emitStatusMessage('disconnected');

    const errorMsg = `${this.extra.backend} process disconnected unexpectedly ` + `(code: ${error.code}, signal: ${error.signal}). ` + `Please try sending a new message to reconnect.`;
    this.logAgentError('process disconnected unexpectedly', new Error(errorMsg), {
      code: error.code,
      signal: error.signal,
    });
    this.emitErrorMessage(errorMsg, false); // Skip finish, will send below

    // Telemetry: end turn tracking (error)
    endTurnError(this.conversation_id, 'E001');

    // Telemetry: end conversation tracking (connection error)
    endConversationError(this.conversation_id, 'E001');

    // Breadcrumb: conversation ended (disconnect)
    conversationBreadcrumbs.error(this.conversation_id, 'E001', errorMsg);

    const finishMsg: IResponseMessage = {
      type: 'finish',
      conversation_id: this.conversation_id,
      msg_id: uuid(),
      data: null,
    };
    void this.handleSignalEvent(finishMsg);

    this.pendingPermissions.clear();
    this.permissionRequestMeta.clear();
    this.approvalStore.clear();
    this.pendingNavigationTools.clear();
    this.statusMessageId = null;

    // Clear bootstrap so next sendMessage re-initializes
    this.bootstrap = undefined;
  }

  // ========== Stream & Signal Pipeline (merged from Manager) ==========

  private handleStreamEvent(message: IResponseMessage): void {
    // Ignore messages if user has cancelled
    if (this.userCancelled) {
      mainLog('[AcpAgent]', `Ignoring message after user cancel: type=${message.type}`);
      return;
    }

    const pipelineStart = Date.now();

    if (message.type === 'agent_status') {
      const status = (message.data as { status?: string } | null)?.status;
      if (status === 'disconnected') {
        this.bootstrap = undefined;
      }
      const shouldDisplayStatus = this.isFirstMessage || status === 'error' || status === 'disconnected';
      if (!shouldDisplayStatus) {
        // Still emit agent_status to renderer so the connection status indicator
        // (AgentStatusDot) updates in real time after restart/reconnect.
        // Only skip adding to chat history to avoid visual clutter.
        ipcBridge.acpConversation.responseStream.emit(message);
        return;
      }
    }

    if (handlePreviewOpenEvent(message)) {
      return;
    }

    const contentTypes = ['content', 'agent_status', 'acp_tool_call', 'plan'];
    if (contentTypes.includes(message.type)) {
      this.status = 'finished';
    }

    if (message.type === 'start') {
      const modelInfo = this.getModelInfo();
      const traceData = {
        agentType: 'acp' as const,
        backend: this.options.backend,
        modelId: modelInfo?.currentModelId || this.persistedModelId || 'unknown',
        cliPath: this.options?.cliPath,
        sessionMode: this.currentMode,
        timestamp: Date.now(),
      };
      ipcBridge.acpConversation.responseStream.emit({
        type: 'request_trace',
        conversation_id: this.conversation_id,
        msg_id: uuid(),
        data: traceData,
      });
    }

    if (message.type === 'acp_context_usage') {
      const usageData = message.data as { used: number; size: number };
      saveContextUsage(this.conversation_id, usageData);
    }

    const filteredMessage = preprocessContentMessage(message as IResponseMessage);

    if (message.type === 'content' && filteredMessage.type === 'content' && filteredMessage.data === '') {
      return;
    }

    if (filteredMessage.type === 'content' && this.hasVisibleAssistantContent(filteredMessage.data)) {
      this.turnHadVisibleAssistantContent = true;
      this.lastVisibleAssistantContentSequence = ++this.turnEventSequence;
    }

    if (filteredMessage.type !== 'thought' && filteredMessage.type !== 'acp_model_info' && filteredMessage.type !== 'acp_context_usage') {
      const tMessage = transformMessage(filteredMessage as IResponseMessage);

      if (tMessage) {
        const isStreamTextChunk = tMessage.type === 'text' && filteredMessage.type === 'content';
        if (isStreamTextChunk) {
          this.streamTextBuffer.queue(tMessage, this.options.backend);
        } else {
          this.streamTextBuffer.flushAll();
          addOrUpdateMessage(message.conversation_id, tMessage);
        }

        if (isStreamTextChunk) {
          const textContent = extractTextFromMessage(tMessage);
          this.cronAccumulator.accumulate(tMessage.msg_id, textContent);
        }
      }
    }

    ipcBridge.acpConversation.responseStream.emit(filteredMessage);

    channelEventBus.emitAgentMessage(this.conversation_id, {
      ...filteredMessage,
      conversation_id: this.conversation_id,
    });

    const totalDuration = Date.now() - pipelineStart;
    if (totalDuration > 10) {
      if (ACP_PERF_LOG) mainLog('ACP-PERF', `stream: onStreamEvent pipeline ${totalDuration}ms type=${message.type}`);
    }
  }

  private async handleSignalEvent(v: IResponseMessage): Promise<void> {
    // Ignore messages if user has cancelled
    if (this.userCancelled && v.type !== 'finish') {
      mainLog('[AcpAgent]', `Ignoring signal event after user cancel: type=${v.type}`);
      return;
    }

    this.streamTextBuffer.flushAll();

    if (v.type === 'acp_permission') {
      const { toolCall, options } = v.data as AcpPermissionRequest;
      this.addConfirmation({
        title: toolCall.title || 'messages.permissionRequest',
        action: 'messages.command',
        id: v.msg_id,
        description: toolCall.rawInput?.description || 'messages.agentRequestingPermission',
        callId: toolCall.toolCallId || v.msg_id,
        options: options.map((option) => ({
          label: option.name,
          value: option,
        })),
      });

      channelEventBus.emitAgentMessage(this.conversation_id, {
        type: 'error',
        conversation_id: this.conversation_id,
        msg_id: v.msg_id,
        data: 'Permission required. Please open Sudowork and confirm the pending request in the conversation panel.',
      });
      return;
    }

    if (v.type === 'finish') {
      cronBusyGuard.setProcessing(this.conversation_id, false);
      this.turnActive = false;

      // Delay clearing processingStartTime to match frontend's 1-second finish delay
      // This ensures timer can be restored if user switches conversations during the delay
      // 延迟清除 processingStartTime 以匹配前端 1 秒的 finish 延迟
      // 这确保在延迟期间切换会话时计时器可以恢复
      setTimeout(() => {
        this.processingStartTime = undefined;
      }, 1500);

      await this.archiveCurrentTurnFiles().catch((err) => {
        mainError('AcpAgent', 'Turn archive failed:', err);
      });

      // Post-cleanup: move intermediate files from workspace root to .drafts/
      if (this.workspace && shouldRunCurrentTurnPostCleanup(this.pendingCurrentTurnPostCleanup)) {
        cleanupIntermediateFiles(this.workspace, { protectedFinalPaths: this.currentTurnProtectedFinalPaths })
          .catch((err) => {
            mainError('AcpAgent', 'Post-cleanup failed:', err);
          })
          .finally(() => {
            this.currentTurnProtectedFinalPaths.clear();
            this.pendingCurrentTurnPostCleanup = false;
          });
      } else {
        this.currentTurnProtectedFinalPaths.clear();
        this.pendingCurrentTurnPostCleanup = false;
      }
    }

    // On finish, process any skill commands (cron, channel-info) from accumulated content.
    // Capture the content, then reset the accumulator IMMEDIATELY — before any await.
    // Processing a command sends a feedback prompt via sendToConnection, whose ACP
    // `session/prompt` only resolves when the *nested* feedback turn ends. The skill
    // mandates LIST-then-CREATE, so the follow-up [CRON_CREATE] always streams inside
    // that nested turn and accumulates here. If we reset only after the await, the
    // parent finish wipes the nested turn's freshly-accumulated command before the
    // nested turn's own finish handler can read it — so the create silently never ran.
    if (v.type === 'finish' && this.cronAccumulator.currentMsgContent) {
      const savedContent = this.cronAccumulator.currentMsgContent;
      const savedMsgId = this.cronAccumulator.currentMsgId;
      this.cronAccumulator.reset();

      // Process cron commands
      if (hasCronCommands(savedContent)) {
        const message: TMessage = {
          id: savedMsgId || uuid(),
          msg_id: savedMsgId || uuid(),
          type: 'text',
          position: 'left',
          conversation_id: this.conversation_id,
          content: { content: savedContent },
          status: 'finish',
          createdAt: Date.now(),
        };
        const collectedResponses: string[] = [];
        await processCronInMessage(this.conversation_id, this.options.backend as any, message, (sysMsg) => {
          collectedResponses.push(sysMsg);
          const systemMessage: IResponseMessage = {
            type: 'system',
            conversation_id: this.conversation_id,
            msg_id: uuid(),
            data: sysMsg,
          };
          ipcBridge.acpConversation.responseStream.emit(systemMessage);
        });
        if (collectedResponses.length > 0) {
          const feedbackMessage = `[System Response]\n${collectedResponses.join('\n')}`;
          await this.sendToConnection(feedbackMessage);
        }
      }
    }

    ipcBridge.acpConversation.responseStream.emit(v);

    channelEventBus.emitAgentMessage(this.conversation_id, {
      ...(v as any),
      conversation_id: this.conversation_id,
    });
  }

  // ========== Message Emission Helpers ==========

  get lastConnectionStatus(): string | null {
    return this._lastConnectionStatus;
  }

  private emitStatusMessage(status: 'connecting' | 'connected' | 'authenticated' | 'session_active' | 'disconnected' | 'error'): void {
    this._lastConnectionStatus = status;

    if (!this.statusMessageId) {
      this.statusMessageId = uuid();
    }

    const statusMessage: TMessage = {
      id: this.statusMessageId,
      msg_id: this.statusMessageId,
      conversation_id: this.conversation_id,
      type: 'agent_status',
      position: 'center',
      createdAt: Date.now(),
      content: {
        backend: this.extra.backend,
        status,
        agentName: this.extra.agentName,
      },
    };

    this.emitMessage(statusMessage);
  }

  private logAgentError(context: string, error: unknown, attributes: Record<string, unknown> = {}): void {
    const message = error instanceof Error ? error.message : String(error);
    mainError('AcpAgent', `${context}: ${message}`, {
      name: error instanceof Error ? error.name : 'Error',
      message,
      stack: error instanceof Error ? error.stack : undefined,
      conversation_id: this.conversation_id,
      backend: this.extra.backend,
      ...attributes,
    });
  }

  private emitPermissionRequest(data: AcpPermissionRequest): void {
    if (data.toolCall) {
      const mapKindToValidType = (kind?: string): 'read' | 'edit' | 'execute' => {
        switch (kind) {
          case 'read':
            return 'read';
          case 'edit':
            return 'edit';
          case 'execute':
            return 'execute';
          default:
            return 'execute';
        }
      };

      const toolCallUpdate: ToolCallUpdate = {
        sessionId: data.sessionId,
        update: {
          sessionUpdate: 'tool_call' as const,
          toolCallId: data.toolCall.toolCallId,
          status: normalizeToolCallStatus(data.toolCall.status),
          title: data.toolCall.title || 'Tool Call',
          kind: mapKindToValidType(data.toolCall.kind),
          content: data.toolCall.content || [],
          locations: data.toolCall.locations || [],
        },
      };

      this.adapter.convertSessionUpdate(toolCallUpdate);
    }

    void this.handleSignalEvent({
      type: 'acp_permission',
      conversation_id: this.conversation_id,
      msg_id: uuid(),
      data: data,
    });
  }

  private emitErrorMessage(error: string, withFinish: boolean = true, classification?: { errorClass: string; errorBytes?: number }): void {
    const errorMessage: TMessage = {
      id: uuid(),
      conversation_id: this.conversation_id,
      type: 'tips',
      position: 'center',
      createdAt: Date.now(),
      content: {
        content: error,
        type: 'error',
        ...(classification?.errorClass ? { errorClass: classification.errorClass } : {}),
        ...(classification?.errorBytes !== undefined ? { errorBytes: classification.errorBytes } : {}),
      },
    };
    this.emitMessage(errorMessage);

    // Emit finish event to reset frontend processing state (unless skipped)
    // Clear processingStartTime immediately on error (no delay)
    // 发送 finish 事件以重置前端处理状态（除非跳过），错误时立即清除 processingStartTime（不延迟）
    if (withFinish) {
      // Immediately clear processingStartTime on error
      // 错误时立即清除 processingStartTime
      this.processingStartTime = undefined;

      const finishMessage: IResponseMessage = {
        type: 'finish',
        conversation_id: this.conversation_id,
        msg_id: uuid(),
        data: null,
      };
      ipcBridge.acpConversation.responseStream.emit(finishMessage);
    }
  }

  private emitModelInfoEvent(): void {
    const modelInfo = this.getModelInfo();
    if (modelInfo) {
      if (this.extra.backend === 'codex') {
        mainLog('[ACP codex]', 'Emitting model info', summarizeAcpModelInfo(modelInfo));
      }
      this.handleStreamEvent({
        type: 'acp_model_info',
        conversation_id: this.conversation_id,
        msg_id: uuid(),
        data: modelInfo,
      });
    }
  }

  private emitMessage(message: TMessage): void {
    const responseMessage: IResponseMessage = {
      type: '',
      data: null,
      conversation_id: this.conversation_id,
      msg_id: message.msg_id || message.id,
    };

    switch (message.type) {
      case 'text':
        if (message.position === 'left') {
          this.lastAssistantTextMsgId = message.msg_id || message.id;
          // Apply pending token usage if it arrived before the assistant text
          if (this.pendingTokenUsage) {
            const pendingUsage = this.pendingTokenUsage;
            this.pendingTokenUsage = null;
            mainLog('[AcpAgent]', `[PENDING-USAGE] Applying pending usage to msg_id=${this.lastAssistantTextMsgId}: total=${pendingUsage.totalTokens}`);
            this.patchAssistantTokenUsage(this.lastAssistantTextMsgId, pendingUsage);
          }
        }
        responseMessage.type = 'content';
        responseMessage.data = message.content.content;
        break;
      case 'agent_status':
        responseMessage.type = 'agent_status';
        responseMessage.data = message.content;
        break;
      case 'acp_permission':
        responseMessage.type = 'acp_permission';
        responseMessage.data = message.content;
        break;
      case 'acp_question':
        responseMessage.type = 'acp_question';
        responseMessage.data = message.content;
        break;
      case 'tips': {
        const content = message.content as { type?: string; content: string };
        if (content.type === 'warning' && message.position === 'center') {
          const subject = this.extractThoughtSubject(content.content);
          responseMessage.type = 'thought';
          responseMessage.data = { subject, description: content.content };
        } else {
          responseMessage.type = 'error';
          responseMessage.data = content.content;
        }
        break;
      }
      case 'acp_tool_call':
        responseMessage.type = 'acp_tool_call';
        responseMessage.data = message.content;
        break;
      case 'plan':
        responseMessage.type = 'plan';
        responseMessage.data = message.content;
        break;
      case 'available_commands':
        return;
      default:
        responseMessage.type = 'content';
        responseMessage.data = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
    }
    this.handleStreamEvent(responseMessage);
  }

  private extractThoughtSubject(content: string): string {
    const lines = content.split('\n');
    const firstLine = lines[0].trim();
    const subjectMatch = firstLine.match(/^\*\*(.+?)\*\*$/);
    if (subjectMatch) return subjectMatch[1];
    if (firstLine.length < 80 && !firstLine.endsWith('.')) return firstLine;
    const firstSentence = content.split('.')[0];
    if (firstSentence.length < 100) return firstSentence;
    return 'Thinking';
  }

  /**
   * Determine tool kind for telemetry tracking
   * - read: tools that read files or data
   * - edit: tools that modify files
   * - execute: tools that run commands or other operations
   */
  private getToolKind(toolName: string): 'read' | 'edit' | 'execute' {
    const name = toolName.toLowerCase();
    // Read tools
    if (/read|get|fetch|list|search|find|glob|grep|cat|head|tail|view/.test(name)) {
      return 'read';
    }
    // Edit tools
    if (/write|edit|create|delete|remove|move|copy|rename|mkdir|rmdir/.test(name)) {
      return 'edit';
    }
    // Default to execute for bash, permission, and other tools
    return 'execute';
  }

  // ========== Private Helpers ==========

  private handleAvailableCommandsUpdate(commands: AcpAvailableCommand[]): void {
    const nextCommands: SlashCommandItem[] = [];
    const seen = new Set<string>();
    for (const command of commands) {
      const name = command.name.trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      nextCommands.push({
        name,
        description: command.description || name,
        hint: command.hint,
        kind: 'template',
        source: 'acp',
      });
    }
    if (!seen.has('model')) {
      nextCommands.push({
        name: 'model',
        description: 'Show or switch the current model',
        hint: '[model-id]',
        kind: 'template',
        source: 'acp',
      });
    }
    this.acpAvailableSlashCommands = nextCommands;
    const waiters = this.acpAvailableSlashWaiters.splice(0, this.acpAvailableSlashWaiters.length);
    for (const resolve of waiters) {
      resolve(this.getAcpSlashCommands());
    }
  }

  private async handleModelCommand(modelMatch: RegExpMatchArray): Promise<AcpResult> {
    const modelArg = (modelMatch[1] || '').trim();
    const responseMsgId = uuid();

    await this.initAgent(this.options);

    ipcBridge.acpConversation.responseStream.emit({
      type: 'start',
      conversation_id: this.conversation_id,
      msg_id: responseMsgId,
      data: { processingStartTime: this.processingStartTime },
    });

    if (!modelArg) {
      const modelInfo = this.getModelInfo();
      let output: string;
      if (modelInfo) {
        const current = modelInfo.currentModelLabel || modelInfo.currentModelId || 'unknown';
        const available =
          modelInfo.availableModels
            ?.map((m) => {
              const marker = m.id === modelInfo.currentModelId ? ' (current)' : '';
              return `- \`${m.id}\` ${m.label ? `— ${m.label}` : ''}${marker}`;
            })
            .join('\n') || '(none)';
        output = `**Current model:** ${current}\n\n**Available models:**\n${available}\n\nTo switch, type \`/model <model-id>\` or use the model selector in the toolbar.`;
      } else {
        output = 'Model info not available. The session may not be fully initialized.';
      }
      ipcBridge.acpConversation.responseStream.emit({
        type: 'content',
        conversation_id: this.conversation_id,
        msg_id: responseMsgId,
        data: output,
      });
    } else {
      const modelInfo = this.getModelInfo();
      const availableIds = modelInfo?.availableModels?.map((m) => m.id) || [];

      if (availableIds.length > 0 && !availableIds.includes(modelArg)) {
        const suggestions = availableIds.map((id) => `\`${id}\``).join(', ');
        ipcBridge.acpConversation.responseStream.emit({
          type: 'content',
          conversation_id: this.conversation_id,
          msg_id: responseMsgId,
          data: `Unknown model: \`${modelArg}\`\n\nAvailable models: ${suggestions}`,
        });
      } else {
        try {
          const result = await this.setModelByConfigOption(modelArg);
          const newModel = result?.currentModelLabel || result?.currentModelId || modelArg;
          const newId = result?.currentModelId || modelArg;
          ipcBridge.acpConversation.responseStream.emit({
            type: 'content',
            conversation_id: this.conversation_id,
            msg_id: responseMsgId,
            data: `Model switched to **${newModel}** (\`${newId}\`).`,
          });
          if (result?.currentModelId) {
            this.persistedModelId = result.currentModelId;
            saveModelId(this.conversation_id, result.currentModelId);
          }
          ipcBridge.acpConversation.responseStream.emit({
            type: 'acp_model_info',
            conversation_id: this.conversation_id,
            msg_id: uuid(),
            data: result,
          });
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          ipcBridge.acpConversation.responseStream.emit({
            type: 'content',
            conversation_id: this.conversation_id,
            msg_id: responseMsgId,
            data: `Failed to switch model: ${errorMsg}`,
          });
        }
      }
    }

    ipcBridge.acpConversation.responseStream.emit({
      type: 'finish',
      conversation_id: this.conversation_id,
      msg_id: responseMsgId,
      data: null,
    });
    this.turnActive = false;
    this.status = 'idle';
    cronBusyGuard.setProcessing(this.conversation_id, false);
    return { success: true, data: null };
  }

  private async handleImageCommand(args: string): Promise<AcpResult> {
    const responseMsgId = uuid();
    const saveDir = this.workspace || '.';

    ipcBridge.acpConversation.responseStream.emit({
      type: 'start',
      conversation_id: this.conversation_id,
      msg_id: responseMsgId,
      data: { processingStartTime: this.processingStartTime },
    });

    try {
      if (!args) {
        ipcBridge.acpConversation.responseStream.emit({
          type: 'content',
          conversation_id: this.conversation_id,
          msg_id: responseMsgId,
          data: 'Usage: `/image <prompt>`, `/image generate <prompt>`, `/image edit <path> <prompt>`, or `/image analyze <path> <prompt>`.',
        });
      } else {
        // Parse sub-command: analyze, edit, gen/generate
        const analyzeMatch = args.match(/^analyze\s+(?:"([^"]+)"|'([^']+)'|(\S+))\s+([\s\S]+)$/);

        if (analyzeMatch) {
          // Image analysis: use chat model + /chat/completions
          const rawPath = analyzeMatch[1] ?? analyzeMatch[2] ?? analyzeMatch[3];
          const srcPath = nodePath.isAbsolute(rawPath) ? rawPath : nodePath.join(saveDir, rawPath);
          const prompt = analyzeMatch[4].trim();

          const creds = readSudorouterCredentials();
          const chatModel = resolveChatModel();
          if (!creds || !chatModel) {
            ipcBridge.acpConversation.responseStream.emit({
              type: 'content',
              conversation_id: this.conversation_id,
              msg_id: responseMsgId,
              data: '未找到可用的模型配置，请检查 sudoclaw 配置。',
            });
          } else {
            const analysisResult = await callChatCompletionsWithImage(creds.baseUrl, creds.apiKey, chatModel, srcPath, prompt);
            const contentMsg = {
              type: 'content' as const,
              conversation_id: this.conversation_id,
              msg_id: responseMsgId,
              data: analysisResult,
            };
            ipcBridge.acpConversation.responseStream.emit(contentMsg);
            ipcBridge.conversation.responseStream.emit(contentMsg);
            const tMessage = transformMessage(contentMsg);
            if (tMessage) addOrUpdateMessage(this.conversation_id, tMessage);
          }
        } else {
          // Image generation/edit: use image model
          const config = await resolveImageConfig();
          if (!config) {
            ipcBridge.acpConversation.responseStream.emit({
              type: 'content',
              conversation_id: this.conversation_id,
              msg_id: responseMsgId,
              data: '未找到可用的图像生成模型配置，请在工具设置中配置图像模型。',
            });
          } else {
            const genMatch = args.match(/^(?:gen|generate)\s+([\s\S]+)$/);
            const editMatch = args.match(/^edit\s+(?:"([^"]+)"|'([^']+)'|(\S+))\s+([\s\S]+)$/);

            let imageUrls: string[];

            if (editMatch) {
              const rawPath = editMatch[1] ?? editMatch[2] ?? editMatch[3];
              const srcPath = nodePath.isAbsolute(rawPath) ? rawPath : nodePath.join(saveDir, rawPath);
              const prompt = editMatch[4].trim();
              const imageUrl = await callImagesEdits(config.baseUrl, config.apiKey, config.model, srcPath, prompt, '1024x1024', 1);
              imageUrls = [imageUrl];
            } else {
              const prompt = genMatch ? genMatch[1].trim() : args;
              const imageUrl = await callImagesGenerations(config.baseUrl, config.apiKey, config.model, prompt, '1024x1024', 1);
              imageUrls = [imageUrl];
            }

            const savedImages = await Promise.all(imageUrls.map((url) => saveImageResult(url, saveDir)));
            const imgContent = savedImages.map(({ imgUrl }) => `![](${imgUrl})`).join('\n');
            const contentMsg = {
              type: 'content' as const,
              conversation_id: this.conversation_id,
              msg_id: responseMsgId,
              data: imgContent,
            };
            ipcBridge.acpConversation.responseStream.emit(contentMsg);
            ipcBridge.conversation.responseStream.emit(contentMsg);
            const tMessage = transformMessage(contentMsg);
            if (tMessage) addOrUpdateMessage(this.conversation_id, tMessage);
          }
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      mainError('[AcpAgent]', `Image command failed: ${msg}`);
      ipcBridge.acpConversation.responseStream.emit({
        type: 'content',
        conversation_id: this.conversation_id,
        msg_id: responseMsgId,
        data: `图像处理失败: ${msg}`,
      });
    }

    ipcBridge.acpConversation.responseStream.emit({
      type: 'finish',
      conversation_id: this.conversation_id,
      msg_id: responseMsgId,
      data: null,
    });
    this.turnActive = false;
    this.status = 'idle';
    cronBusyGuard.setProcessing(this.conversation_id, false);
    return { success: true, data: null };
  }

  /**
   * `/browser <subcommand>` — user-initiated control of the right-panel
   * BrowserPanel. AI never sees these commands (the slash whitelist routes
   * them straight here). Subcommands:
   *
   *   /browser open <url>      — open url in the right-panel browser
   *   /browser status          — show recent network responses for the
   *                              currently active tab (status codes + URLs)
   *   /browser eval <js>       — run JS in the active tab, stream result back
   *   /browser screenshot      — capture the active tab and return as image
   */
  private async handleBrowserCommand(args: string): Promise<AcpResult> {
    const responseMsgId = uuid();
    ipcBridge.acpConversation.responseStream.emit({
      type: 'start',
      conversation_id: this.conversation_id,
      msg_id: responseMsgId,
      data: { processingStartTime: this.processingStartTime },
    });

    const emit = (text: string): void => {
      ipcBridge.acpConversation.responseStream.emit({
        type: 'content',
        conversation_id: this.conversation_id,
        msg_id: responseMsgId,
        data: text,
      });
    };

    try {
      if (!args) {
        emit('Usage: `/browser open <url>`, `/browser status`, `/browser eval <js>`, or `/browser screenshot`.');
      } else {
        const { browserPanelCdpService } = await import('@process/services/browserPanel/BrowserPanelCdpService');
        const subMatch = args.match(/^(open|status|eval|screenshot)(?:\s+([\s\S]+))?$/i);
        if (!subMatch) {
          emit(`Unknown /browser subcommand. Usage: \`/browser open <url>\`, \`/browser status\`, \`/browser eval <js>\`, \`/browser screenshot\`.`);
        } else {
          const sub = subMatch[1].toLowerCase();
          const rest = (subMatch[2] || '').trim();
          const targetId = browserPanelCdpService.resolveWebContentsId();

          if (sub === 'open') {
            if (!rest) {
              emit('Usage: `/browser open <url>`');
            } else {
              ipcBridge.rightPanelBrowser.open.emit({ url: rest, switchTab: true, conversationId: this.conversation_id });
              emit(`Opened ${rest} in the right-panel browser.`);
            }
          } else if (targetId === null) {
            emit('No active browser tab. Open one with `/browser open <url>` or click the 浏览器 tab on the right.');
          } else if (sub === 'status') {
            const recent = browserPanelCdpService.listNetworkRequests(targetId, { limit: 25 });
            if (recent.length === 0) {
              emit('No network responses captured for the active tab yet.');
            } else {
              const lines = recent.map((r) => `${r.status ?? '   '} ${r.method ?? ''} ${r.type ?? ''} ${r.url.slice(0, 200)}`);
              emit(['```', ...lines, '```'].join('\n'));
            }
          } else if (sub === 'eval') {
            if (!rest) {
              emit('Usage: `/browser eval <js-expression>`');
            } else {
              const result = await browserPanelCdpService.evaluateScript(targetId, { expression: rest });
              if (!result.ok) {
                emit(`Eval failed: ${result.errorText ?? 'unknown error'}${result.errorDetail ? `\n${result.errorDetail}` : ''}`);
              } else {
                const text = typeof result.value === 'string' ? result.value : JSON.stringify(result.value, null, 2);
                emit(['```', String(text ?? result.description ?? '(no return value)'), '```'].join('\n'));
              }
            }
          } else if (sub === 'screenshot') {
            const shot = await browserPanelCdpService.takeScreenshot(targetId, { format: 'png' });
            ipcBridge.acpConversation.responseStream.emit({
              type: 'content',
              conversation_id: this.conversation_id,
              msg_id: responseMsgId,
              data: `![browser screenshot](data:image/png;base64,${shot.base64})`,
            });
          }
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      mainError('[AcpAgent]', `Browser command failed: ${msg}`);
      emit(`Browser command failed: ${msg}`);
    }

    ipcBridge.acpConversation.responseStream.emit({
      type: 'finish',
      conversation_id: this.conversation_id,
      msg_id: responseMsgId,
      data: null,
    });
    this.turnActive = false;
    this.status = 'idle';
    cronBusyGuard.setProcessing(this.conversation_id, false);
    return { success: true, data: null };
  }

  private async handleChannelQueryIntent(command: ChannelQueryCommand): Promise<AcpResult> {
    const responseMsgId = uuid();

    ipcBridge.acpConversation.responseStream.emit({
      type: 'start',
      conversation_id: this.conversation_id,
      msg_id: responseMsgId,
      data: { processingStartTime: this.processingStartTime },
    });

    try {
      const result = await executeChannelInfoCommand(command);

      const contentMsg = {
        type: 'content' as const,
        conversation_id: this.conversation_id,
        msg_id: responseMsgId,
        data: result,
      };
      // 只发送一次，acpConversation.responseStream 和 conversation.responseStream 是同一流
      ipcBridge.acpConversation.responseStream.emit(contentMsg);
      // 消息落库
      const tMessage = transformMessage(contentMsg);
      if (tMessage) addOrUpdateMessage(this.conversation_id, tMessage);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      mainError('[AcpAgent]', `Channel query failed: ${msg}`);
      ipcBridge.acpConversation.responseStream.emit({
        type: 'content',
        conversation_id: this.conversation_id,
        msg_id: responseMsgId,
        data: `获取渠道信息失败: ${msg}`,
      });
    }

    ipcBridge.acpConversation.responseStream.emit({
      type: 'finish',
      conversation_id: this.conversation_id,
      msg_id: responseMsgId,
      data: null,
    });
    this.turnActive = false;
    this.status = 'idle';
    cronBusyGuard.setProcessing(this.conversation_id, false);
    return { success: true, data: null };
  }

  private isYoloMode(mode: string): boolean {
    return mode === 'yolo' || mode === 'bypassPermissions';
  }

  private async clearLegacyYoloConfig(): Promise<void> {
    try {
      const config = await ProcessConfig.get('acp.config');
      const backendConfig = config?.[this.options.backend];
      if ((backendConfig as any)?.yoloMode) {
        await ProcessConfig.set('acp.config', {
          ...config,
          [this.options.backend]: { ...backendConfig, yoloMode: false },
        });
      }
    } catch (error) {
      mainError('[AcpAgent]', 'Failed to clear legacy yoloMode config', error);
    }
  }

  private async cacheModelList(modelInfo: AcpModelInfo): Promise<void> {
    try {
      const cached = (await ProcessConfig.get('acp.cachedModels')) || {};
      const nextCachedInfo = {
        ...modelInfo,
        currentModelId: cached[this.options.backend]?.currentModelId ?? modelInfo.currentModelId,
        currentModelLabel: cached[this.options.backend]?.currentModelLabel ?? modelInfo.currentModelLabel,
      };
      await ProcessConfig.set('acp.cachedModels', {
        ...cached,
        [this.options.backend]: nextCachedInfo,
      });
      if (this.options.backend === 'codex') {
        mainLog('[AcpAgent]', 'Cached Codex model list', {
          backend: this.options.backend,
          currentModelId: nextCachedInfo.currentModelId,
          availableModelCount: nextCachedInfo.availableModels?.length || 0,
          sampleModelIds: (nextCachedInfo.availableModels || []).slice(0, 8).map((model) => model.id),
        });
      }
    } catch (error) {
      mainWarn('[AcpAgent]', 'Failed to cache model list', error);
    }
  }

  get isConnected(): boolean {
    return this.connection.isConnected;
  }

  get hasActiveSession(): boolean {
    return this.connection.hasActiveSession;
  }

  // ========== Workspace File Tracking for Channel Clients ==========

  /** Document extensions that should trigger file sending to channel clients */
  private static readonly DOCUMENT_EXTENSIONS = new Set([
    // Office documents
    '.pdf',
    '.doc',
    '.docx',
    '.xls',
    '.xlsx',
    '.ppt',
    '.pptx',
    // Text/data formats
    '.csv',
    '.txt',
    '.md',
    '.html',
    '.htm',
    '.xml',
    '.json',
    '.yaml',
    '.yml',
    '.toml',
    // Code files (common programming languages)
    '.js',
    '.ts',
    '.jsx',
    '.tsx',
    '.py',
    '.rb',
    '.go',
    '.rs',
    '.java',
    '.kt',
    '.swift',
    '.c',
    '.cpp',
    '.h',
    '.hpp',
    '.cs',
    '.php',
    '.lua',
    '.r',
    '.sql',
    // Shell/scripts
    '.sh',
    '.bash',
    '.zsh',
    '.ps1',
    '.bat',
    '.cmd',
    '.vbs',
    // Config files
    '.conf',
    '.config',
    '.ini',
    '.env',
    '.properties',
    // Markup/styles
    '.css',
    '.scss',
    '.sass',
    '.less',
    '.vue',
    '.svelte',
    // Archive/compressed
    '.zip',
    '.tar',
    '.gz',
    '.bz2',
    '.xz',
    '.7z',
    '.rar',
    // Other common formats
    '.log',
    '.rst',
    '.adoc',
    '.tex',
    '.org',
  ]);

  /** Image extensions */
  private static readonly IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.tiff', '.bmp', '.ico', '.svg', '.heic', '.heif', '.avif']);

  /**
   * Build or refresh the workspace file snapshot.
   * Scans the workspace root (non-recursive, depth=1) and records each deliverable file's mtime.
   * Files inside .drafts/ directory are excluded.
   */
  private refreshWorkspaceFileSnapshot(): void {
    this.workspaceFileSnapshot.clear();
    if (!this.workspace) return;

    try {
      const entries = fs.readdirSync(this.workspace, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (entry.name === '.drafts') continue;

        const ext = nodePath.extname(entry.name).toLowerCase();
        if (!AcpAgent.DOCUMENT_EXTENSIONS.has(ext) && !AcpAgent.IMAGE_EXTENSIONS.has(ext)) continue;

        const fullPath = nodePath.join(this.workspace, entry.name);
        try {
          const stat = fs.statSync(fullPath);
          this.workspaceFileSnapshot.set(entry.name, stat.mtimeMs);
        } catch {
          // stat failed (file deleted between readdir and stat), skip
        }
      }
    } catch {
      // workspace not readable, skip silently
    }
  }

  /**
   * After an execute-class tool completes, scan workspace for newly created or modified deliverable files.
   * Returns absolute paths of files that are new or have a newer mtime than the snapshot.
   */
  private detectNewFilesFromWorkspace(): string[] {
    if (!this.workspace) return [];
    const newFiles: string[] = [];

    try {
      const entries = fs.readdirSync(this.workspace, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (entry.name === '.drafts') continue;

        const ext = nodePath.extname(entry.name).toLowerCase();
        if (!AcpAgent.DOCUMENT_EXTENSIONS.has(ext) && !AcpAgent.IMAGE_EXTENSIONS.has(ext)) continue;

        const fullPath = nodePath.join(this.workspace, entry.name);
        try {
          const stat = fs.statSync(fullPath);
          const prevMtime = this.workspaceFileSnapshot.get(entry.name);

          // New file (not in snapshot) or modified file (mtime changed)
          if (prevMtime === undefined || stat.mtimeMs > prevMtime) {
            newFiles.push(fullPath);
          }
        } catch {
          // stat failed, skip
        }
      }
    } catch {
      // workspace not readable, skip
    }

    return newFiles;
  }

  /**
   * Extract file path from a tool call if it represents a file-creation operation.
   * Returns null if the tool call is not a file-creation operation or the file doesn't exist.
   */
  private extractFilePathFromToolCall(toolName: string, rawInput?: Record<string, unknown>): string | null {
    if (!rawInput) return null;
    const n = toolName.toLowerCase();

    // Handle SendUserMessage tool: extract attachments (array of file paths)
    if (n === 'sendusermessage' || n === 'brief') {
      const attachments = rawInput.attachments as Array<string> | undefined;
      if (attachments && attachments.length > 0) {
        // Return the first valid attachment path
        for (const attachmentPath of attachments) {
          if (typeof attachmentPath === 'string' && attachmentPath.trim()) {
            const resolvedPath = attachmentPath.trim();
            // Verify the file exists
            try {
              if (fs.existsSync(resolvedPath)) {
                return resolvedPath;
              }
            } catch {
              // Continue to next attachment if this one doesn't exist
            }
          }
        }
      }
      return null;
    }

    // Handle file-creation tools (Write/Edit/Create)
    if (!/write|edit|create/.test(n)) return null;

    const filePath = (rawInput.path || rawInput.file_path || rawInput.filename) as string | undefined;
    if (!filePath || typeof filePath !== 'string') return null;

    const ext = nodePath.extname(filePath).toLowerCase();
    if (!AcpAgent.DOCUMENT_EXTENSIONS.has(ext) && !AcpAgent.IMAGE_EXTENSIONS.has(ext)) return null;

    // Verify the file actually exists on disk
    try {
      if (!fs.existsSync(filePath)) return null;
    } catch {
      return null;
    }

    return filePath;
  }

  /** Classify a file path as 'image' or 'file' based on its extension */
  private classifyFileType(filePath: string): 'image' | 'file' {
    const ext = nodePath.extname(filePath).toLowerCase();
    return AcpAgent.IMAGE_EXTENSIONS.has(ext) ? 'image' : 'file';
  }

  /** Infer tool kind from name */
  private inferToolKind(name: string): 'read' | 'edit' | 'execute' | null {
    const n = name.toLowerCase();
    if (/read|view|list|search|grep|glob|find|get|fetch/.test(n)) return 'read';
    if (/write|edit|create|delete|patch|update|insert|remove/.test(n)) return 'edit';
    if (/exec|run|bash|shell|terminal/.test(n)) return 'execute';
    return null;
  }

  /**
   * Send file_send message to channel clients for generated files.
   * Returns true if the file was actually forwarded; false if it was already
   * sent earlier in this turn (deduped via sentChannelFilePaths) or if the
   * file does not exist. Callers MUST NOT add to sentChannelFilePaths before
   * calling this method — the centralized has/add inside this function is the
   * single chokepoint for dedup. Any external add would poison the has-check
   * and cause this method to return false without forwarding.
   */
  private sendFileToChannels(filePath: string): boolean {
    // Resolve relative paths to absolute paths using workspace root
    let resolvedPath = filePath;
    if (!nodePath.isAbsolute(filePath)) {
      resolvedPath = nodePath.resolve(this.workspace, filePath);
    }

    // Verify the file exists before sending
    try {
      if (!fs.existsSync(resolvedPath)) {
        console.warn(`[AcpAgent] sendFileToChannels: file not found: ${resolvedPath}`);
        return false;
      }
    } catch {
      console.warn(`[AcpAgent] sendFileToChannels: error checking file existence: ${resolvedPath}`);
      return false;
    }

    // Centralized dedup: any forwarder reaches this single chokepoint.
    // Strategy 1 / Strategy 2 / bash / turn-end fallback all share the same Set.
    if (this.sentChannelFilePaths.has(resolvedPath)) {
      return false;
    }
    this.sentChannelFilePaths.add(resolvedPath);

    const fileMessage: IResponseMessage = {
      type: 'file_send',
      conversation_id: this.conversation_id,
      msg_id: uuid(),
      data: {
        filePath: resolvedPath,
        fileName: nodePath.basename(resolvedPath),
        fileType: this.classifyFileType(resolvedPath),
      },
    };
    this.handleStreamEvent(fileMessage);
    return true;
  }

  /**
   * Forward bash-generated deliverable files (images/documents placed in the
   * workspace root) to channel clients as file_send messages. Restores the
   * behavior lost in 0a49297b9 where bash-produced deliverables were sent to
   * IM channels. Reads from currentTurnFiles (populated by
   * trackBashGeneratedFiles) so this stays decoupled from cleanup tracking.
   */
  private deliverBashGeneratedFilesToChannel(): void {
    if (this.currentTurnFiles.size === 0) return;
    for (const [relativePath, file] of this.currentTurnFiles) {
      if (file.source !== 'bash-generated') continue;
      // Historical 5501a245 filter: workspace root only + image/document extension
      if (relativePath.includes('/') || relativePath.includes('\\')) continue;
      const ext = nodePath.extname(relativePath).toLowerCase();
      if (!AcpAgent.IMAGE_EXTENSIONS.has(ext) && !AcpAgent.DOCUMENT_EXTENSIONS.has(ext)) continue;
      this.sendFileToChannels(file.actualPath);
    }
  }

  /**
   * Snapshot deliverable files (images/documents) in workspace root with their mtime.
   * Used by turn-start to record baseline; turn-end compares to detect new/modified files.
   */
  private captureDeliverableSnapshot(): Map<string, number> {
    const snap = new Map<string, number>();
    if (!this.workspace) return snap;
    try {
      const entries = fs.readdirSync(this.workspace, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (entry.name === '.drafts') continue;
        const ext = nodePath.extname(entry.name).toLowerCase();
        if (!AcpAgent.IMAGE_EXTENSIONS.has(ext) && !AcpAgent.DOCUMENT_EXTENSIONS.has(ext)) continue;
        const fullPath = nodePath.join(this.workspace, entry.name);
        try {
          const stat = fs.statSync(fullPath);
          snap.set(fullPath, stat.mtimeMs);
        } catch {
          // stat failed, skip
        }
      }
    } catch {
      // workspace not readable, return empty
    }
    return snap;
  }

  /**
   * Turn-end fallback: scan workspace root for deliverable files that are new
   * or modified compared to turnStartDeliverableSnapshot, forward them via
   * sendFileToChannels. Captures images generated by tools that bypass
   * deliverBashGeneratedFilesToChannel (e.g. MCP image_gen, direct write_file png).
   * Shares sentChannelFilePaths with the bash path to prevent duplicates —
   * dedup happens inside sendFileToChannels itself; this method must NOT
   * add to sentChannelFilePaths before calling sendFileToChannels, otherwise
   * the inner has-check would short-circuit and handleStreamEvent never fires.
   *
   * Besides channel forwarding, each new/modified root deliverable that is not
   * already tracked is recorded into currentTurnFiles via trackTurnFile so it
   * also enters the generated-files marker (deliverables panel), keeping the
   * temp-space/channel view and the deliverables view consistent.
   */
  private deliverWorkspaceFilesAtTurnEnd(): void {
    if (!this.workspace) return;
    let candidate = 0;
    let sent = 0;
    let tracked = 0;
    const trackedAbsolute = new Set<string>();
    for (const file of this.currentTurnFiles.values()) {
      trackedAbsolute.add(nodePath.resolve(file.actualPath));
    }
    try {
      const entries = fs.readdirSync(this.workspace, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (entry.name === '.drafts') continue;
        const ext = nodePath.extname(entry.name).toLowerCase();
        if (!AcpAgent.IMAGE_EXTENSIONS.has(ext) && !AcpAgent.DOCUMENT_EXTENSIONS.has(ext)) continue;
        const fullPath = nodePath.join(this.workspace, entry.name);
        try {
          const stat = fs.statSync(fullPath);
          const prevMtime = this.turnStartDeliverableSnapshot.get(fullPath);
          const isNewOrModified = prevMtime === undefined || stat.mtimeMs > prevMtime;
          if (!isNewOrModified) continue;
          candidate++;
          // Dedup is handled inside sendFileToChannels (which returns whether
          // the file was actually forwarded). Do NOT add to sentChannelFilePaths
          // here — that would poison the inner has-check and prevent the file
          // from ever reaching handleStreamEvent.
          if (this.sendFileToChannels(fullPath)) {
            sent++;
          }

          // Also surface in the deliverables panel: track the file into the
          // current turn so archiveCurrentTurnFiles emits a marker entry for it.
          // Skip files already tracked by a tool-call branch to avoid clobbering
          // their richer classification (content/source/operationIntent).
          const resolvedFullPath = nodePath.resolve(fullPath);
          if (!trackedAbsolute.has(resolvedFullPath)) {
            this.trackRootDeliverableFile({
              requestedPath: entry.name,
              actualPath: fullPath,
              kind: prevMtime === undefined ? 'create' : 'edit',
            });
            trackedAbsolute.add(resolvedFullPath);
            tracked++;
          }
        } catch {
          // stat failed, skip
        }
      }
    } catch {
      // workspace not readable, skip
    }
    mainLog('[AcpAgent]', `[TURN-END-DELIVER] candidate=${candidate}, sent=${sent}, tracked=${tracked}`);
  }
}

export default AcpAgent;
