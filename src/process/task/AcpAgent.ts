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
import { getClaudeModel } from '@/agent/acp/utils';
import { buildAcpModelInfo, summarizeAcpModelInfo } from '@/agent/acp/modelInfo';
import { channelEventBus } from '@/channels/agent/ChannelEventBus';
import { ipcBridge } from '@/common';
import type { CronMessageMeta, TMessage } from '@/common/chatLib';
import type { SlashCommandItem } from '@/common/slash/types';
import { transformMessage } from '@/common/chatLib';
import { NEXUS_FILES_MARKER } from '@/common/constants';
import type { IResponseMessage } from '@/common/ipcBridge';
import { NavigationInterceptor } from '@/common/navigation';
import { parseError, uuid } from '@/common/utils';
import type { AcpBackend, AcpModelInfo, AcpPermissionOption, AcpPermissionRequest, AcpPromptResponseUsage, AcpResult, AcpSessionConfigOption, AcpSessionUpdate, AvailableCommandsUpdate, ToolCallUpdate } from '@/types/acpTypes';
import { ACP_BACKENDS_ALL, AcpErrorType, createAcpError } from '@/types/acpTypes';
import { ExtensionRegistry } from '@/extensions';
import { spawn } from 'child_process';
import * as fs from 'node:fs';
import * as nodePath from 'node:path';
import { getEnhancedEnv, resolveNpxPath } from '@process/utils/shellEnv';
import { ASSISTANT_PRESETS } from '@/common/presets/assistantPresets';
import { getDatabase } from '@process/database';
import { ProcessConfig } from '../initStorage';
import { addMessage, addOrUpdateMessage, nextTickToLocalFinish } from '../message';
import { handlePreviewOpenEvent } from '../utils/previewUtils';
import { cronBusyGuard } from '@process/services/cron/CronBusyGuard';
import { mainLog, mainWarn, mainError } from '../utils/mainLogger';
import { prepareFirstMessageWithSkillsIndex } from './agentUtils';
import BaseAgent from './BaseAgent';
import { hasCronCommands } from './CronCommandDetector';
import { extractTextFromMessage, processCronInMessage } from './MessageMiddleware';
import { processAtFileReferences } from './acp/AcpAtFileProcessor';
import { StreamTextBuffer, CronTextAccumulator, filterThinkTagsFromMessage } from './acp/AcpMessagePipeline';
import { saveAcpSessionId, saveSessionMode, saveModelId, saveContextUsage } from './acp/AcpPersistence';

/** Enable ACP performance diagnostics via ACP_PERF=1 */
const ACP_PERF_LOG = process.env.ACP_PERF === '1';

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
  private approvalStore = new AcpApprovalStore();
  private permissionRequestMeta = new Map<string, { kind?: string; title?: string; rawInput?: Record<string, unknown> }>();
  private pendingNavigationTools = new Set<string>();
  private statusMessageId: string | null = null;

  // Model tracking
  private userModelOverride: string | null = null;
  private pendingModelSwitchNotice: string | null = null;
  private hasReceivedUsageUpdate = false;

  // Slash commands
  private acpAvailableSlashCommands: SlashCommandItem[] = [];
  private acpAvailableSlashWaiters: Array<(commands: SlashCommandItem[]) => void> = [];

  // Message pipeline
  private readonly streamTextBuffer = new StreamTextBuffer();
  private readonly cronAccumulator = new CronTextAccumulator();

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
  }

  // ========== Connection Lifecycle ==========

  private setupConnectionHandlers(): void {
    this.connection.onSessionUpdate = (data: AcpSessionUpdate) => {
      this.handleSessionUpdate(data);
    };
    this.connection.onPermissionRequest = (data: AcpPermissionRequest) => {
      return this.handlePermissionRequest(data);
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
        const customAgents = await ProcessConfig.get('acp.customAgents');
        let customAgentConfig = customAgents?.find((agent) => agent.id === data.customAgentId);

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

      // Store resolved config for connection
      this.extra = {
        ...this.extra,
        cliPath,
        customArgs,
        customEnv,
        yoloMode,
      };

      // Write preset modelConfigs to .gemini/settings.json for Gemini backend
      // The Gemini CLI reads this file from the workspace directory on startup
      if (this.extra.backend === 'gemini' && this.extra.presetAssistantId?.startsWith('builtin-')) {
        const presetId = this.extra.presetAssistantId.replace('builtin-', '');
        const preset = ASSISTANT_PRESETS.find((p) => p.id === presetId);
        if (preset?.modelConfigs && this.extra.workspace) {
          try {
            const geminiDir = nodePath.join(this.extra.workspace, '.gemini');
            if (!fs.existsSync(geminiDir)) {
              fs.mkdirSync(geminiDir, { recursive: true });
            }
            const settingsPath = nodePath.join(geminiDir, 'settings.json');
            fs.writeFileSync(settingsPath, JSON.stringify({ modelConfigs: preset.modelConfigs }, null, 2));
            mainLog('[AcpAgent]', `Wrote Gemini model config to ${settingsPath}`);
          } catch (error) {
            mainWarn('[AcpAgent]', 'Failed to write Gemini model config:', error);
          }
        }
      }

      // Connect
      await this.connect();

      // Re-apply persisted mode after session start/resume
      if (this.currentMode && this.currentMode !== 'default') {
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
          console.warn('[ACP] First connect attempt failed, retrying once:', firstError instanceof Error ? firstError.message : String(firstError));
          await this.connection.disconnect();
          await new Promise((resolve) => setTimeout(resolve, 300));
          await tryConnect();
        }
      } finally {
        if (connectTimeoutId) {
          clearTimeout(connectTimeoutId);
        }
      }
      if (ACP_PERF_LOG) console.log(`[ACP-PERF] start: connection.connect() completed ${Date.now() - connectStart}ms`);

      this.emitStatusMessage('connected');

      const authStart = Date.now();
      await this.performAuthentication();
      if (ACP_PERF_LOG) console.log(`[ACP-PERF] start: authentication completed ${Date.now() - authStart}ms`);

      if (!this.connection.hasActiveSession) {
        const sessionStart = Date.now();
        await this.createOrResumeSession();
        if (ACP_PERF_LOG) console.log(`[ACP-PERF] start: session created ${Date.now() - sessionStart}ms`);
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
            if (ACP_PERF_LOG) console.log(`[ACP-PERF] start: session mode set ${Date.now() - modeStart}ms`);
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
            if (ACP_PERF_LOG) console.log(`[ACP-PERF] start: model set ${Date.now() - modelStart}ms`);
          } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            console.warn(`[ACP] Failed to set model from settings: ${errMsg}`);
            if (errMsg.includes('model_not_found') || errMsg.includes('无可用渠道')) {
              this.emitErrorMessage(`Model "${configuredModel}" is not available on your API relay service. ` + `Please add this model to your relay's channel configuration, ` + `or update ANTHROPIC_MODEL in ~/.claude/settings.json to a supported model name. ` + `Falling back to the relay's default model.`);
            }
          }
        }
      }

      this.emitModelInfoEvent();
      this.emitStatusMessage('session_active');
      if (ACP_PERF_LOG) console.log(`[ACP-PERF] start: total ${Date.now() - startTotal}ms`);
    } catch (error) {
      if (ACP_PERF_LOG) console.log(`[ACP-PERF] start: failed after ${Date.now() - startTotal}ms`);
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
        console.warn(`[AcpAgent] Failed to resume session ${resumeSessionId}, creating fresh session:`, resumeError instanceof Error ? resumeError.message : String(resumeError));
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
            console.log(`${backend} authentication refreshed`);
            resolve();
          } else {
            reject(new Error(`${backend} login failed with code ${code}`));
          }
        });
        loginProcess.on('error', reject);
      });
    } catch (error) {
      console.warn(`${backend} auth refresh failed, will try to connect anyway:`, error);
    }
  }

  // ========== Public API (BaseAgent contract) ==========

  async sendMessage(data: { content: string; files?: string[]; msg_id?: string; cronMeta?: CronMessageMeta }): Promise<{
    success: boolean;
    msg?: string;
    message?: string;
  }> {
    const managerSendStart = Date.now();
    cronBusyGuard.setProcessing(this.conversation_id, true);
    this.status = 'running';
    try {
      // Emit/persist user message immediately
      if (data.msg_id && data.content) {
        const userMessage: TMessage = {
          id: data.msg_id,
          msg_id: data.msg_id,
          type: 'text',
          position: 'right',
          conversation_id: this.conversation_id,
          content: {
            content: data.content,
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
        const userResponseMessage: IResponseMessage = {
          type: 'user_content',
          conversation_id: this.conversation_id,
          msg_id: data.msg_id,
          data: data.cronMeta ? { content: userMessage.content.content, cronMeta: data.cronMeta } : userMessage.content.content,
        };
        ipcBridge.acpConversation.responseStream.emit(userResponseMessage);
      }

      // Intercept /model slash command
      const modelMatch = data.content.trim().match(/^\/model(?:\s+(.*))?$/);
      if (modelMatch !== null) {
        return await this.handleModelCommand(modelMatch, data);
      }

      const initStart = Date.now();
      await this.initAgent(this.options);
      if (ACP_PERF_LOG) console.log(`[ACP-PERF] manager: initAgent completed ${Date.now() - initStart}ms`);

      // Guard against stale agent after CLI crash
      if (!this.connection.isConnected) {
        mainWarn('[AcpAgent]', 'Agent not connected after initAgent, re-initializing');
        this.bootstrap = undefined;
        await this.initAgent(this.options);
      }

      if (data.msg_id && data.content) {
        let contentToSend = data.content;
        if (contentToSend.includes(NEXUS_FILES_MARKER)) {
          contentToSend = contentToSend.split(NEXUS_FILES_MARKER)[0].trimEnd();
        }

        if (this.isFirstMessage) {
          contentToSend = await prepareFirstMessageWithSkillsIndex(contentToSend, {
            presetContext: this.options.presetContext,
            enabledSkills: this.options.enabledSkills,
          });
        }

        if (data.files && data.files.length > 0) {
          const fileRefs = data.files.map((filePath) => (filePath.includes(' ') ? `@"${filePath}"` : '@' + filePath)).join(' ');
          contentToSend = fileRefs + ' ' + contentToSend;
        }

        contentToSend = await processAtFileReferences(contentToSend, this.workspace, data.files);

        const agentSendStart = Date.now();
        const result = await this.sendToConnection(contentToSend, data.msg_id);
        if (ACP_PERF_LOG) console.log(`[ACP-PERF] manager: sendMessage completed ${Date.now() - agentSendStart}ms (total: ${Date.now() - managerSendStart}ms)`);
        if (this.isFirstMessage) {
          this.isFirstMessage = false;
        }
        return result;
      }
      const agentSendStart = Date.now();
      const result = await this.sendToConnection(data.content, data.msg_id);
      if (ACP_PERF_LOG) console.log(`[ACP-PERF] manager: sendMessage completed ${Date.now() - agentSendStart}ms (total: ${Date.now() - managerSendStart}ms)`);
      return result;
    } catch (e) {
      this.streamTextBuffer.flushAll();
      cronBusyGuard.setProcessing(this.conversation_id, false);
      this.status = 'finished';
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

  private async sendToConnection(content: string, msg_id?: string): Promise<AcpResult> {
    const sendStart = Date.now();
    try {
      if (!this.connection.isConnected || !this.connection.hasActiveSession) {
        const reconnectStart = Date.now();
        try {
          this.bootstrap = undefined;
          await this.initAgent(this.options);
          if (ACP_PERF_LOG) console.log(`[ACP-PERF] send: auto-reconnect completed ${Date.now() - reconnectStart}ms`);
        } catch (reconnectError) {
          if (ACP_PERF_LOG) console.log(`[ACP-PERF] send: auto-reconnect failed ${Date.now() - reconnectStart}ms`);
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
        data: null,
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
            console.warn(`[ACP] Pre-prompt model re-assert failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }

      // Inject model switch notice
      if (this.pendingModelSwitchNotice && this.extra.backend === 'claude') {
        const modelNotice = `<system-reminder>\n` + `Model switch: The active model has been changed to ${this.pendingModelSwitchNotice} via the /model command. ` + `You are now running as ${this.pendingModelSwitchNotice}. ` + `The ANTHROPIC_MODEL environment variable and the earlier "You are powered by" text in the system prompt are stale (cached from session start) and no longer reflect the actual model. ` + `When asked which model you are, answer ${this.pendingModelSwitchNotice}.\n` + `</system-reminder>\n\n`;
        processedContent = modelNotice + processedContent;
        this.pendingModelSwitchNotice = null;
      }

      const promptStart = Date.now();
      await this.connection.sendPrompt(processedContent);
      if (ACP_PERF_LOG) console.log(`[ACP-PERF] send: sendPrompt completed ${Date.now() - promptStart}ms (total send: ${Date.now() - sendStart}ms)`);

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

      this.emitErrorMessage(errorMsg);
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

      if (data.optionId === 'allow_always') {
        const meta = this.permissionRequestMeta.get(callId);
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

  async stop(): Promise<void> {
    await this.connection.disconnect();
    this.emitStatusMessage('disconnected');
    this.approvalStore.clear();
    this.permissionRequestMeta.clear();
    // Emit finish event
    this.handleStreamEvent({
      type: 'finish',
      conversation_id: this.conversation_id,
      msg_id: uuid(),
      data: null,
    });
  }

  kill() {
    this.streamTextBuffer.flushAll();

    let killed = false;
    const GRACE_PERIOD_MS = 500;
    const HARD_TIMEOUT_MS = 1500;

    const waiters = this.acpAvailableSlashWaiters.splice(0, this.acpAvailableSlashWaiters.length);
    for (const resolve of waiters) {
      resolve([]);
    }
    this.acpAvailableSlashCommands = [];

    const doKill = () => {
      if (killed) return;
      killed = true;
      clearTimeout(hardTimer);
    };

    const hardTimer = setTimeout(doKill, HARD_TIMEOUT_MS);

    void (this.connection?.disconnect?.() || Promise.resolve())
      .catch((err) => {
        mainWarn('[AcpAgent]', 'connection.disconnect() failed during kill', err);
      })
      .then(() => new Promise<void>((r) => setTimeout(r, GRACE_PERIOD_MS)))
      .finally(doKill);
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
    if (!this.connection?.isConnected) {
      if (this.persistedModelId) {
        return {
          source: 'models',
          currentModelId: this.persistedModelId,
          currentModelLabel: this.persistedModelId,
          canSwitch: false,
          availableModels: [],
        };
      }
      return null;
    }
    return buildAcpModelInfo(this.connection.getConfigOptions(), this.connection.getModels());
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
    if (this.options.backend === 'codex') {
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
      console.warn('[AcpAgent] Agent initialization failed while loading ACP slash commands:', error);
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
      }

      if (data.update?.sessionUpdate === 'tool_call_update') {
        const statusUpdate = data as import('@/types/acpTypes').ToolCallUpdateStatus;
        const toolCallId = statusUpdate.update?.toolCallId;
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

      const approvalKey = createAcpApprovalKey(data.toolCall);
      if (this.approvalStore.isApprovedForSession(approvalKey)) {
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

      setTimeout(() => {
        if (this.pendingPermissions.has(requestId)) {
          this.pendingPermissions.delete(requestId);
          reject(new Error('Permission request timed out'));
        }
      }, 70000);
    });
  }

  private handleEndTurn(): void {
    const msg: IResponseMessage = {
      type: 'finish',
      conversation_id: this.conversation_id,
      msg_id: uuid(),
      data: null,
    };
    void this.handleSignalEvent(msg);
  }

  private handlePromptUsage(usage: AcpPromptResponseUsage): void {
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
    const pipelineStart = Date.now();

    if (message.type === 'agent_status') {
      const status = (message.data as { status?: string } | null)?.status;
      if (status === 'disconnected') {
        this.bootstrap = undefined;
      }
      const shouldDisplayStatus = this.isFirstMessage || status === 'error' || status === 'disconnected';
      if (!shouldDisplayStatus) {
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

    const filteredMessage = filterThinkTagsFromMessage(message as IResponseMessage);

    ipcBridge.acpConversation.responseStream.emit(filteredMessage);

    channelEventBus.emitAgentMessage(this.conversation_id, {
      ...filteredMessage,
      conversation_id: this.conversation_id,
    });

    const totalDuration = Date.now() - pipelineStart;
    if (totalDuration > 10) {
      if (ACP_PERF_LOG) console.log(`[ACP-PERF] stream: onStreamEvent pipeline ${totalDuration}ms type=${message.type}`);
    }
  }

  private async handleSignalEvent(v: IResponseMessage): Promise<void> {
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
    }

    if (v.type === 'finish' && this.cronAccumulator.currentMsgContent && hasCronCommands(this.cronAccumulator.currentMsgContent)) {
      const message: TMessage = {
        id: this.cronAccumulator.currentMsgId || uuid(),
        msg_id: this.cronAccumulator.currentMsgId || uuid(),
        type: 'text',
        position: 'left',
        conversation_id: this.conversation_id,
        content: { content: this.cronAccumulator.currentMsgContent },
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
      this.cronAccumulator.reset();
    }

    ipcBridge.acpConversation.responseStream.emit(v);

    channelEventBus.emitAgentMessage(this.conversation_id, {
      ...(v as any),
      conversation_id: this.conversation_id,
    });
  }

  // ========== Message Emission Helpers ==========

  private emitStatusMessage(status: 'connecting' | 'connected' | 'authenticated' | 'session_active' | 'disconnected' | 'error'): void {
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
      data: null,
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
}

export default AcpAgent;
