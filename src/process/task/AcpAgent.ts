/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Merged AcpAgentManager + AcpAgent — owns AcpConnection directly.
 */

import { AcpAdapter } from '@/agent/acp/AcpAdapter';
import { AcpApprovalStore, createAcpApprovalKey } from '@/agent/acp/ApprovalStore';
import { AcpConnection } from '@/agent/acp/AcpConnection';
import { CLAUDE_YOLO_SESSION_MODE, CODEBUDDY_YOLO_SESSION_MODE, IFLOW_YOLO_SESSION_MODE, QWEN_YOLO_SESSION_MODE } from '@/agent/acp/constants';
import { acpDetector } from '@/agent/acp/AcpDetector';
import { getClaudeModel } from '@/agent/acp/utils';
import { buildAcpModelInfo, summarizeAcpModelInfo } from '@/agent/acp/modelInfo';
import { channelEventBus } from '@/channels/agent/ChannelEventBus';
import { ipcBridge } from '@/common';
import type { AcpQuestionData, CronMessageMeta, TMessage } from '@/common/chatLib';
import type { SlashCommandItem } from '@/common/slash/types';
import { transformMessage } from '@/common/chatLib';
import { NEXUS_FILES_MARKER } from '@/common/constants';
import { appendNexusFilesMarker } from '@/common/nexusFiles';
import type { IResponseMessage } from '@/common/ipcBridge';
import { NavigationInterceptor } from '@/common/navigation';
import { parseError, uuid } from '@/common/utils';
import type { AcpBackend, AcpError, AcpModelInfo, AcpPermissionOption, AcpPermissionRequest, AcpPromptResponseUsage, AcpQuestionRequest, AcpQuestionResponseAnswer, AcpResult, AcpSessionConfigOption, AcpSessionUpdate, AvailableCommandsUpdate, ToolCallUpdate, ToolCallUpdateStatus } from '@/types/acpTypes';
import { ACP_BACKENDS_ALL, AcpErrorType, createAcpError } from '@/types/acpTypes';
import { ExtensionRegistry } from '@/extensions';
import { spawn } from 'child_process';
import * as fs from 'node:fs';
import * as nodePath from 'node:path';
import { getEnhancedEnv, resolveNpxPath } from '@process/utils/shellEnv';
import { applyPresetRuntime } from '@process/task/presetRuntime';
import { assistantManager } from '@/process/AssistantManager';
import { getDatabase } from '@process/database';
import { ProcessConfig } from '../initStorage';
import { addMessage, addOrUpdateMessage, nextTickToLocalFinish } from '../message';
import { handlePreviewOpenEvent } from '../utils/previewUtils';
import { cronBusyGuard } from '@process/services/cron/CronBusyGuard';
import { mainLog, mainWarn, mainError } from '../utils/mainLogger';
import { translateLLMError } from '@process/utils/llmErrorTranslation';
import { injectSkillsDirectoryHint, prepareFirstMessageWithSkillsIndex } from './agentUtils';
import { cleanupIntermediateFiles, cleanupDraftsOnCancel, detectFileIntent, matchesDraftPattern } from './draftsCleanup';
import { mergeScodeProxyModelInfo, isModelVisionCapable, getScodeProxyModelInfoSync } from '@process/services/scode/scodeProxyModels';
import BaseAgent from './BaseAgent';

// Telemetry imports for conversation tracking
import { startConversationTracking, endConversationSuccess, endConversationError, endConversationUserCancel } from '../telemetry';

// Telemetry imports for turn/step tracking
import { startTurnTracking, updateTurnTokens, endTurnSuccess, endTurnError, getCurrentTurnId } from '../telemetry';
import { startToolCallTracking, endToolCallTracking, startPermissionRequestTracking, endPermissionRequestTracking, recordFileOperationStep, startThinkingTracking, endThinkingTracking } from '../telemetry';

// CrashReporter imports for breadcrumb tracking
import { conversationBreadcrumbs, apiBreadcrumbs, systemBreadcrumbs, mcpBreadcrumbs } from '../telemetry/BreadcrumbTracker';

/** Default prompt timeout in seconds */
const DEFAULT_PROMPT_TIMEOUT_SECONDS = 300;

/** Prompt timeout range (seconds) */
const PROMPT_TIMEOUT_MIN_SECONDS = 30;
const PROMPT_TIMEOUT_MAX_SECONDS = 3600;
import { hasCronCommands } from './CronCommandDetector';
import { detectChannelQueryIntent, executeChannelInfoCommand, type ChannelQueryCommand } from './ChannelInfoDetector';
import { extractTextFromMessage, processCronInMessage } from './MessageMiddleware';
import { processAtFileReferences } from './acp/AcpAtFileProcessor';
import { StreamTextBuffer, CronTextAccumulator, filterThinkTagsFromMessage, preprocessContentMessage } from './acp/AcpMessagePipeline';
import { saveAcpSessionId, saveSessionMode, saveModelId, saveContextUsage } from './acp/AcpPersistence';
import { resolveImageConfig, callImagesGenerations, callImagesEdits, saveImageResult, resolveChatModel, callChatCompletionsWithImage, readSudorouterCredentials } from '../bridge/imageGenerationBridge';
import { resolveWorkspaceSkillsDir } from '../utils/workspaceSkillsDir';
import { readAssistantResource, ruleFilePattern } from '@process/utils/assistantResources';
import { app } from 'electron';

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
  private lastUserMessage: string | null = null;

  // Slash commands
  private acpAvailableSlashCommands: SlashCommandItem[] = [];
  private acpAvailableSlashWaiters: Array<(commands: SlashCommandItem[]) => void> = [];

  // Message pipeline
  private readonly streamTextBuffer = new StreamTextBuffer();
  private readonly cronAccumulator = new CronTextAccumulator();

  // Workspace file tracking for channel file_send messages
  private workspaceFileSnapshot = new Map<string, number>();

  // Turn-level file tracking for precise cleanup on cancel
  private currentTurnFiles: Map<string, { path: string; intent: 'draft' | 'final'; kind: 'create' | 'edit' }> = new Map();

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
      this.handleEndTurn();
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
      let cdpPort = 9230;
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        cdpPort = require('@/utils/configureChromium').cdpPort || 9230;
      } catch {
        /* use default */
      }
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
              this.emitErrorMessage(`Model "${configuredModel}" is not available on your API relay service. ` + `Please add this model to your relay's channel configuration, ` + `or update ANTHROPIC_MODEL in ~/.claude/settings.json to a supported model name. ` + `Falling back to the relay's default model.`);
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

    if (resumeSessionId) {
      try {
        let response: { sessionId?: string };

        if (this.extra.backend === 'codex') {
          response = await this.connection.loadSession(resumeSessionId, this.extra.workspace);
        } else {
          response = await this.connection.newSession(this.extra.workspace, {
            resumeSessionId,
            forkSession: false,
          });
        }

        if (response.sessionId && response.sessionId !== resumeSessionId) {
          this.extra.acpSessionId = response.sessionId;
          saveAcpSessionId(this.conversation_id, response.sessionId);
        }
        return;
      } catch (resumeError) {
        mainWarn('AcpAgent', `Failed to resume session ${resumeSessionId}, creating fresh session:`, resumeError instanceof Error ? resumeError.message : String(resumeError));
      }
    }

    const response = await this.connection.newSession(this.extra.workspace);
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
      } catch (_err) {
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
      } catch (error) {
        this.emitStatusMessage('error');
      }
    } catch (error) {
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

    // ★ Reset turn-level file tracking for new turn
    // 重置 Turn 级别文件追踪，开始新的 Turn
    this.currentTurnFiles.clear();
    this.workspaceFileSnapshot = this.getWorkspaceFiles();
    mainLog('[AcpAgent]', `[TURN-START] Reset file tracking, snapshot size: ${this.workspaceFileSnapshot.size}`);

    try {
      // Apply prompt timeout from config before sending
      this.applyPromptTimeoutFromConfig();

      // Start telemetry conversation tracking
      const modelInfo = this.getModelInfo();
      const modelId = modelInfo?.currentModelId || this.persistedModelId || 'unknown';
      // Map openclaw-gateway to sudoclaw for telemetry
      const modelProvider = this.options.backend === 'openclaw-gateway' ? 'sudoclaw' : this.options.backend;
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

      // Intercept /model slash command
      const modelMatch = data.content.trim().match(/^\/model(?:\s+(.*))?$/);
      if (modelMatch !== null) {
        return await this.handleModelCommand(modelMatch, data);
      }

      // Intercept /image sub-commands
      const imageMatch = data.content.trim().match(/^\/image\s+([\s\S]+)$/);
      if (imageMatch !== null) {
        return await this.handleImageCommand(imageMatch[1].trim(), data);
      }

      // Intercept channel query intent (natural language)
      const channelQueryCommand = detectChannelQueryIntent(data.content);
      if (channelQueryCommand) {
        return await this.handleChannelQueryIntent(channelQueryCommand, data.msg_id);
      }

      const initStart = Date.now();
      await this.initAgent(this.options);
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

          // Update presetContext with the fresh rules (for subsequent use)
          this.options.presetContext = loadedRules;

          // Re-append the preset runtime context appendix (auto-discovered
          // scripts/ absolute paths + ops entry point). This block reloads the
          // rule file on every message and would otherwise overwrite the
          // appendix that applyPresetRuntime injected at init — leaving the
          // assistant unable to locate its own scripts and forcing a `find`.
          try {
            let cdpPort = 9230;
            try {
              // eslint-disable-next-line @typescript-eslint/no-var-requires
              cdpPort = require('@/utils/configureChromium').cdpPort || 9230;
            } catch {
              /* use default */
            }
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
      }

      if (data.msg_id && data.content) {
        let contentToSend = data.content;
        if (contentToSend.includes(NEXUS_FILES_MARKER)) {
          contentToSend = contentToSend.split(NEXUS_FILES_MARKER)[0].trimEnd();
        }

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

        const processed = await processAtFileReferences(contentToSend, this.workspace, data.files);
        contentToSend = processed.text;
        if (processed.images.length > 0) {
          mainLog('AcpAgent', `sendMessage: sending ${processed.images.length} image(s) as content blocks, mimeTypes=[${processed.images.map((i) => i.mimeType).join(', ')}]`);
        }

        let finalImages: typeof processed.images = processed.images;

        if (processed.images.length > 0 && this.options.backend === 'scode') {
          const currentModel = this.persistedModelId || this.getModelInfo()?.currentModelId;
          if (!isModelVisionCapable(currentModel)) {
            const modelLabel = this.getModelInfo()?.currentModelLabel || currentModel || 'unknown';
            const visionModels = getScodeProxyModelInfoSync()
              ?.availableModels?.filter((m) => isModelVisionCapable(m.id))
              ?.map((m) => m.label || m.id)
              ?.join(', ');
            const tip = `The current model "${modelLabel}" does not support image analysis. Please switch to a model that supports vision${visionModels ? ` (e.g., ${visionModels})` : ''} to analyze images.`;
            this.emitErrorMessage(tip);
            finalImages = [];
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
          // For subsequent messages, inject identity override to ensure latest assistant name
          // 后续消息时，注入身份声明以确保使用最新的助手名称
          // Only inject if the presetContext contains Identity Override block
          if (this.options.presetContext.includes('[Identity Override')) {
            // Extract the Identity Override block and prepend it
            // Match from [Identity Override to the end of that block (before next [ or end)
            const identityStart = this.options.presetContext.indexOf('[Identity Override');
            const identityEnd = this.options.presetContext.indexOf('\n\n', identityStart);
            if (identityStart >= 0 && identityEnd > identityStart) {
              const identityBlock = this.options.presetContext.slice(identityStart, identityEnd);
              contentToSend = identityBlock + '\n\n[User Request]\n' + contentToSend;
            }
          }
        }

        const agentSendStart = Date.now();
        const result = await this.sendToConnection(contentToSend, data.msg_id, finalImages);
        if (ACP_PERF_LOG) mainLog('ACP-PERF', `manager: sendMessage completed ${Date.now() - agentSendStart}ms (total: ${Date.now() - managerSendStart}ms)`);
        if (this.isFirstMessage) {
          this.isFirstMessage = false;
        }
        // Handle sendToConnection error result (not thrown)
        if (!result.success) {
          const acpError = (result as { success: false; error: AcpError }).error;
          endConversationError(this.conversation_id);
          conversationBreadcrumbs.error(this.conversation_id, acpError.type.toString() || 'unknown', acpError.message);
        }
        return result;
      }
      const agentSendStart = Date.now();
      const result = await this.sendToConnection(data.content, data.msg_id);
      if (ACP_PERF_LOG) mainLog('ACP-PERF', `manager: sendMessage completed ${Date.now() - agentSendStart}ms (total: ${Date.now() - managerSendStart}ms)`);
      // Handle sendToConnection error result (not thrown)
      if (!result.success) {
        const acpError = (result as { success: false; error: AcpError }).error;
        endConversationError(this.conversation_id);
        conversationBreadcrumbs.error(this.conversation_id, acpError.type.toString() || 'unknown', acpError.message);
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
      let errorCode: string | undefined;
      if (errorMsg.includes('timeout') || errorMsg.includes('Timeout') || errorMsg.includes('timed out')) {
        errorCode = 'E002';
        endConversationError(this.conversation_id, 'E002');
      } else if (errorMsg.includes('authentication') || errorMsg.includes('认证失败')) {
        errorCode = 'E006';
        endConversationError(this.conversation_id, 'E006');
      } else if (errorMsg.includes('interrupted') || errorMsg.includes('SSE') || errorMsg.includes('stream')) {
        errorCode = 'E003';
        endConversationError(this.conversation_id, 'E003');
      } else if (errorMsg.includes('parse') || errorMsg.includes('JSON') || errorMsg.includes('invalid response')) {
        errorCode = 'E005';
        endConversationError(this.conversation_id, 'E005');
      } else if (errorMsg.includes('connection') || errorMsg.includes('Connection')) {
        errorCode = 'E001';
        endConversationError(this.conversation_id, 'E001');
      } else {
        errorCode = 'E009';
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

  private async sendToConnection(content: string, msg_id?: string, images?: Array<{ type: 'image'; data: string; mimeType: string }>): Promise<AcpResult> {
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
          return {
            success: false,
            error: createAcpError(AcpErrorType.CONNECTION_NOT_READY, `Failed to reconnect: ${errorMsg}`, true),
          };
        }
      }

      // Emit start event
      this.handleStreamEvent({
        type: 'start',
        conversation_id: this.conversation_id,
        msg_id: msg_id || uuid(),
        data: { processingStartTime: this.processingStartTime },
      });

      this.adapter.resetMessageTracking();
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
        const staleIdentityHint = this.extra.backend === 'claude' ? 'The ANTHROPIC_MODEL environment variable and the earlier "You are powered by" text in the system prompt are stale (cached from session start) and no longer reflect the actual model.' : 'Your built-in assistant identity or branding text may still mention Claude or Anthropic even when the actual active model is different.';
        const modelNotice = `<system-reminder>\n` + `Active model: ${activeModelNoticeId}. ` + `You are currently running as ${activeModelNoticeId}. ` + `${staleIdentityHint} ` + `When asked which model you are, answer ${activeModelNoticeId}.\n` + `</system-reminder>\n\n`;
        processedContent = modelNotice + processedContent;
        this.pendingModelSwitchNotice = null;
      }

      const promptStart = Date.now();
      // Breadcrumb: API request
      apiBreadcrumbs.request(`session/prompt`, 'POST', this.conversation_id);

      await this.connection.sendPrompt(processedContent, images, msg_id);
      if (ACP_PERF_LOG) mainLog('ACP-PERF', `send: sendPrompt completed ${Date.now() - promptStart}ms (total send: ${Date.now() - sendStart}ms)`);

      // Breadcrumb: API response success
      apiBreadcrumbs.responseSuccess(`session/prompt`, 200, Date.now() - sendStart);

      this.statusMessageId = null;
      return { success: true, data: null };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
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
      if (errorMsg.includes('authentication') || errorMsg.includes('认证失败') || errorMsg.includes('[ACP-AUTH-')) {
        errorType = AcpErrorType.AUTHENTICATION_FAILED;
      } else if (errorMsg.includes('timeout') || errorMsg.includes('Timeout') || errorMsg.includes('timed out')) {
        errorType = AcpErrorType.TIMEOUT;
        retryable = true;
      } else if (errorMsg.includes('permission') || errorMsg.includes('Permission')) {
        errorType = AcpErrorType.PERMISSION_DENIED;
      } else if (errorMsg.includes('connection') || errorMsg.includes('Connection')) {
        errorType = AcpErrorType.NETWORK_ERROR;
        retryable = true;
      }

      this.emitErrorMessage(translateLLMError(errorMsg));

      // Breadcrumb: API response error
      apiBreadcrumbs.responseError(`session/prompt`, errorType === AcpErrorType.TIMEOUT ? 408 : 500, errorMsg);

      return {
        success: false,
        error: createAcpError(errorType, errorMsg, retryable),
      };
    }
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
    for (const [callId, pending] of this.pendingPermissions) {
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
          mainLog('[AcpAgent]', `[STOP] Tracked file: ${path}, intent: ${file.intent}`);
        }
        this.cleanupTrackedFiles().catch((err) => {
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
   * Clean up all tracked files from current turn (both draft and final)
   * 清理当前 Turn 追踪到的所有文件（包括 draft 和 final）
   */
  private async cleanupTrackedFiles(): Promise<number> {
    let removedCount = 0;

    for (const [requestedPath, file] of this.currentTurnFiles) {
      try {
        const fullPath = file.path;
        if (fs.existsSync(fullPath)) {
          await fs.promises.unlink(fullPath);
          removedCount++;
          mainLog('[AcpAgent]', `[CLEANUP] Removed tracked file: ${requestedPath} (intent: ${file.intent}, actual: ${fullPath})`);
        } else {
          mainLog('[AcpAgent]', `[CLEANUP] File already removed: ${fullPath}`);
        }
      } catch (err) {
        mainError('[AcpAgent]', `Failed to remove file ${requestedPath}:`, err);
      }
    }

    // Clear tracking
    this.currentTurnFiles.clear();

    if (removedCount > 0) {
      mainLog('[AcpAgent]', `[CLEANUP] Total tracked files removed: ${removedCount}`);
    }

    return removedCount;
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
  private trackBashGeneratedFiles(): void {
    try {
      const currentSnapshot = this.getWorkspaceFiles();

      // Compare with previous snapshot to find new files
      const previousSnapshot = this.workspaceFileSnapshot;
      const newFiles: string[] = [];

      for (const [file, time] of currentSnapshot) {
        if (!previousSnapshot.has(file)) {
          newFiles.push(file);
        }
      }

      // Track new files
      for (const file of newFiles) {
        const fileName = nodePath.basename(file);
        const relativePath = nodePath.relative(this.workspace, file);

        // Skip excluded files and directories
        const EXCLUDED = new Set(['.git', '.gitignore', '.env', '.env.local', 'node_modules', '.DS_Store', 'Thumbs.db', '.nexus']);
        if (EXCLUDED.has(fileName) || fileName.startsWith('.nexus')) continue;

        // Detect intent based on file name pattern
        const intent = matchesDraftPattern(fileName) ? 'draft' : 'final';

        // Track the file
        this.currentTurnFiles.set(relativePath, {
          path: file,
          intent,
          kind: 'create',
        });
        mainLog('[AcpAgent]', `[TRACK-BASH] New file detected: ${relativePath}, intent: ${intent}`);
      }

      // Update snapshot for next comparison
      this.workspaceFileSnapshot = currentSnapshot;

      if (newFiles.length > 0) {
        mainLog('[AcpAgent]', `[TRACK-BASH] Total new files tracked: ${newFiles.length}`);
      }
    } catch (err) {
      mainError('[AcpAgent]', 'Failed to track Bash generated files:', err);
    }
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

          // Skip certain directories
          if (entry.isDirectory()) {
            const skipDirs = new Set(['.git', 'node_modules', '.nexus', '__pycache__', '.venv', 'venv']);
            if (skipDirs.has(entry.name)) continue;
            scanDir(fullPath, baseDir);
          } else if (entry.isFile()) {
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
    addOrUpdateMessage(this.conversation_id, tMessage, this.options.backend);
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
    if (!this.connection?.isConnected) {
      try {
        await this.initAgent(this.options);
      } catch {
        return null;
      }
    }
    const result = await this.setModelByConfigOption(modelId);
    if (result) {
      this.persistedModelId = result.currentModelId;
      saveModelId(this.conversation_id, result.currentModelId);
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
            this.trackBashGeneratedFiles();
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

        if (NavigationInterceptor.isNavigationTool(toolName)) {
          if (toolCallId) {
            this.pendingNavigationTools.add(toolCallId);
          }
          const url = NavigationInterceptor.extractUrl(toolCallUpdate.update);
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
                // Detect file intent
                let intent: 'draft' | 'final' = 'final';
                if (content) {
                  const intentResult = detectFileIntent(inputPath, content);
                  if (intentResult.intent === 'draft') {
                    intent = 'draft';
                  } else if (intentResult.intent === 'final') {
                    intent = 'final';
                  } else {
                    // Use pattern matching as fallback
                    intent = matchesDraftPattern(inputPath) ? 'draft' : 'final';
                  }
                } else {
                  intent = matchesDraftPattern(inputPath) ? 'draft' : 'final';
                }

                // Track the file
                const actualPath = intent === 'draft' ? nodePath.join(this.workspace, '.drafts', nodePath.basename(inputPath)) : nodePath.join(this.workspace, inputPath);

                this.currentTurnFiles.set(inputPath, {
                  path: actualPath,
                  intent,
                  kind: n === 'write_file' ? 'create' : 'edit',
                });
                mainLog('[AcpAgent]', `[TRACK] File: ${inputPath}, intent: ${intent}, actualPath: ${actualPath}`);
              }
            }

            // ★ Track files generated by Bash tool (scan workspace for new files)
            // 追踪 Bash 工具产生的文件（扫描工作空间新增文件）
            if (n === 'bash') {
              mainLog('[AcpAgent]', `[TRACK-BASH] Bash tool detected, status: ${toolStatus}`);
              if (toolStatus === 'completed') {
                this.trackBashGeneratedFiles();
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

      const messages = this.adapter.convertSessionUpdate(data);
      for (let i = 0; i < messages.length; i++) {
        this.emitMessage(messages[i]);
      }
    } catch (error) {
      this.emitErrorMessage(`Failed to process session update: ${error instanceof Error ? error.message : String(error)}`);
    }
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
      if (NavigationInterceptor.isNavigationTool(toolName)) {
        const url = NavigationInterceptor.extractUrl(data.toolCall);
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

  private handleEndTurn(): void {
    if (!this.userCancelled) {
      // Telemetry: end turn tracking (success)
      endTurnSuccess(this.conversation_id);

      // Telemetry: end conversation tracking (success)
      endConversationSuccess(this.conversation_id);

      // Breadcrumb: conversation ended (success)
      conversationBreadcrumbs.end(this.conversation_id, 'success');
    }

    // Clear turn-level file tracking for next turn
    // 清空 Turn 级别文件追踪，为下一个 Turn 做准备
    this.currentTurnFiles.clear();
    mainLog('[AcpAgent]', '[END_TURN] Cleared currentTurnFiles for next turn');

    const msg: IResponseMessage = {
      type: 'finish',
      conversation_id: this.conversation_id,
      msg_id: uuid(),
      data: null,
    };
    void this.handleSignalEvent(msg);
  }

  private handlePromptUsage(usage: AcpPromptResponseUsage): void {
    // Telemetry: update turn token usage
    updateTurnTokens(this.conversation_id, usage);

    if (this.hasReceivedUsageUpdate) return;
    this.handleStreamEvent({
      type: 'acp_context_usage',
      conversation_id: this.conversation_id,
      msg_id: uuid(),
      data: {
        used: usage.totalTokens,
        size: 0,
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

  private handleDisconnect(error: { code: number | null; signal: NodeJS.Signals | null }): void {
    this.emitStatusMessage('disconnected');

    const errorMsg = `${this.extra.backend} process disconnected unexpectedly ` + `(code: ${error.code}, signal: ${error.signal}). ` + `Please try sending a new message to reconnect.`;
    this.emitErrorMessage(errorMsg);

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

    if (message.type !== 'thought' && message.type !== 'acp_model_info' && message.type !== 'acp_context_usage') {
      const tMessage = transformMessage(message as IResponseMessage);

      if (tMessage) {
        const isStreamTextChunk = tMessage.type === 'text' && message.type === 'content';
        if (isStreamTextChunk) {
          this.streamTextBuffer.queue(tMessage, this.options.backend);
        } else {
          this.streamTextBuffer.flushAll();
          addOrUpdateMessage(message.conversation_id, tMessage, this.options.backend);
        }

        if (isStreamTextChunk) {
          const textContent = extractTextFromMessage(tMessage);
          this.cronAccumulator.accumulate(tMessage.msg_id, textContent);
        }
      }
    }

    const filteredMessage = preprocessContentMessage(message as IResponseMessage);

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

      // Post-cleanup: move intermediate files from workspace root to .drafts/
      if (this.workspace) {
        cleanupIntermediateFiles(this.workspace).catch((err) => {
          mainError('AcpAgent', 'Post-cleanup failed:', err);
        });
      }
    }

    // On finish, process any skill commands (cron, channel-info) from accumulated content
    // Must save content BEFORE reset, then process all command types, then reset at the end
    if (v.type === 'finish' && this.cronAccumulator.currentMsgContent) {
      const savedContent = this.cronAccumulator.currentMsgContent;
      const savedMsgId = this.cronAccumulator.currentMsgId;

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

      // Reset accumulator AFTER all command processing
      this.cronAccumulator.reset();
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

  private emitErrorMessage(error: string): void {
    const errorMessage: TMessage = {
      id: uuid(),
      conversation_id: this.conversation_id,
      type: 'tips',
      position: 'center',
      createdAt: Date.now(),
      content: {
        content: error,
        type: 'error',
      },
    };
    this.emitMessage(errorMessage);
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

  private async handleModelCommand(modelMatch: RegExpMatchArray, data: { msg_id?: string }): Promise<AcpResult> {
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

  private async handleImageCommand(args: string, data: { msg_id?: string }): Promise<AcpResult> {
    const responseMsgId = uuid();
    const saveDir = this.workspace || '.';

    ipcBridge.acpConversation.responseStream.emit({
      type: 'start',
      conversation_id: this.conversation_id,
      msg_id: responseMsgId,
      data: { processingStartTime: this.processingStartTime },
    });

    try {
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

  private async handleChannelQueryIntent(command: ChannelQueryCommand, msg_id?: string): Promise<AcpResult> {
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
      ipcBridge.acpConversation.responseStream.emit(contentMsg);
      ipcBridge.conversation.responseStream.emit(contentMsg);
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
   * Called when a tool call completes successfully.
   */
  private sendFileToChannels(filePath: string): void {
    // Resolve relative paths to absolute paths using workspace root
    let resolvedPath = filePath;
    if (!nodePath.isAbsolute(filePath)) {
      resolvedPath = nodePath.resolve(this.workspace, filePath);
    }

    // Verify the file exists before sending
    try {
      if (!fs.existsSync(resolvedPath)) {
        console.warn(`[AcpAgent] sendFileToChannels: file not found: ${resolvedPath}`);
        return;
      }
    } catch {
      console.warn(`[AcpAgent] sendFileToChannels: error checking file existence: ${resolvedPath}`);
      return;
    }

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
  }
}

export default AcpAgent;
