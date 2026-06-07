/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IConfirmation } from '@/common/chatLib';
import { bridge } from '@office-ai/platform';
import type { OpenDialogOptions } from 'electron';
import type { McpSource } from '../process/services/mcpServices/McpProtocol';
import type { AcpBackend, AcpBackendAll, AcpModelInfo, PresetAgentType } from '../types/acpTypes';
import type { ScodeCustomModelProvider } from './scodeConfig';
import type { SlashCommandItem } from './slash/types';
import type { IMcpServer, IProvider, TChatConversation, TProviderWithModel, ICssTheme } from './storage';
import type { PreviewHistoryTarget, PreviewSnapshotInfo } from './types/preview';
import type { UpdateCheckRequest, UpdateCheckResult, UpdateDownloadProgressEvent, UpdateDownloadRequest, UpdateDownloadResult, AutoUpdateStatus } from './updateTypes';
import type { ProtocolDetectionRequest, ProtocolDetectionResponse } from './utils/protocolDetector';
import type { SyncAllResult } from '../process/sync/remoteToLocalSync';

export const shell = {
  openFile: bridge.buildProvider<void, string>('open-file'), // 使用系统默认程序打开文件
  showItemInFolder: bridge.buildProvider<void, string>('show-item-in-folder'), // 打开文件夹
  openExternal: bridge.buildProvider<void, string>('open-external'), // 使用系统默认程序打开外部链接
};

export interface ITerminalCreateResult {
  sessionId: string;
}

export interface ITerminalOutputEvent {
  sessionId: string;
  data: string;
}

export interface ITerminalExitEvent {
  sessionId: string;
  exitCode: number;
}

export interface ITerminalResizeParams {
  sessionId: string;
  cols: number;
  rows: number;
}

/** Emitted whenever the active PTY count changes for a conversation.
 *  Used by the sidebar to render a "running" spinner next to conversations
 *  that have live terminal processes. */
export interface ITerminalActiveCountEvent {
  conversationId: string;
  count: number;
}

export const terminal = {
  create: bridge.buildProvider<IBridgeResponse<ITerminalCreateResult>, { cwd?: string; shell?: string; conversationId?: string } | undefined>('terminal.create'),
  write: bridge.buildProvider<IBridgeResponse<void>, { sessionId: string; data: string }>('terminal.write'),
  resize: bridge.buildProvider<IBridgeResponse<void>, ITerminalResizeParams>('terminal.resize'),
  dispose: bridge.buildProvider<IBridgeResponse<void>, { sessionId: string }>('terminal.dispose'),
  /** Kill all PTYs whose `conversationId` matches. SIGTERM with a 2s grace then SIGKILL. */
  closeByConversation: bridge.buildProvider<IBridgeResponse<{ killed: number }>, { conversationId: string }>('terminal.closeByConversation'),
  output: bridge.buildEmitter<ITerminalOutputEvent>('terminal.output'),
  exit: bridge.buildEmitter<ITerminalExitEvent>('terminal.exit'),
  activeCountChanged: bridge.buildEmitter<ITerminalActiveCountEvent>('terminal.activeCountChanged'),
};

//通用会话能力
export const conversation = {
  create: bridge.buildProvider<TChatConversation, ICreateConversationParams>('create-conversation'), // 创建对话
  createWithConversation: bridge.buildProvider<TChatConversation, { conversation: TChatConversation; sourceConversationId?: string }>('create-conversation-with-conversation'), // Create new conversation from history (supports migration) / 通过历史会话创建新对话（支持迁移）
  get: bridge.buildProvider<TChatConversation | undefined, { id: string }>('get-conversation'), // 获取对话信息
  getAssociateConversation: bridge.buildProvider<TChatConversation[], { conversation_id: string }>('get-associated-conversation'), // 获取关联对话
  remove: bridge.buildProvider<boolean, { id: string; deleteWorkspace?: boolean }>('remove-conversation'), // 删除对话
  update: bridge.buildProvider<boolean, { id: string; updates: Partial<TChatConversation>; mergeExtra?: boolean }>('update-conversation'), // 更新对话信息
  reset: bridge.buildProvider<void, IResetConversationParams>('reset-conversation'), // 重置对话
  stop: bridge.buildProvider<IBridgeResponse<{}>, { conversation_id: string }>('chat.stop.stream'), // 停止会话
  sendMessage: bridge.buildProvider<IBridgeResponse<{}>, ISendMessageParams>('chat.send.message'), // 发送消息（统一接口）
  getSlashCommands: bridge.buildProvider<IBridgeResponse<{ commands: SlashCommandItem[] }>, { conversation_id: string }>('conversation.get-slash-commands'),
  confirmMessage: bridge.buildProvider<IBridgeResponse, IConfirmMessageParams>('conversation.confirm.message'), // 通用确认消息
  responseStream: bridge.buildEmitter<IResponseMessage>('chat.response.stream'), // 接收消息（统一接口）
  getWorkspace: bridge.buildProvider<IDirOrFile[], { conversation_id: string; workspace: string; path: string; search?: string }>('conversation.get-workspace'),
  getRemoteWorkspace: bridge.buildProvider<IRemoteWorkspaceResponse, { conversation_id: string; path?: string; search?: string }>('conversation.get-remote-workspace'),
  previewRemoteWorkspaceFile: bridge.buildProvider<IBridgeResponse<MossWorkspaceFilePreview>, { conversation_id: string; path: string }>('conversation.preview-remote-workspace-file'),
  getRemoteAvailableSkills: bridge.buildProvider<IRemoteAvailableSkillsResponse, { conversation_id: string }>('conversation.get-remote-available-skills'),
  responseSearchWorkSpace: bridge.buildProvider<void, { file: number; dir: number; match?: IDirOrFile }>('conversation.response.search.workspace'),
  reloadContext: bridge.buildProvider<IBridgeResponse, { conversation_id: string }>('conversation.reload-context'),
  getConnectionStatus: bridge.buildProvider<IBridgeResponse<{ status: string | null }>, { conversation_id: string }>('conversation.get-connection-status'),
  restartAndConnect: bridge.buildProvider<IBridgeResponse<{}>, { conversation_id: string }>('conversation.restart-and-connect'),
  syncWorkspaceSkills: bridge.buildProvider<IBridgeResponse<void>, { conversation_id: string }>('conversation.sync-workspace-skills'),
  // Flush all pending messages to database immediately (used before reading from DB)
  flushPendingMessages: bridge.buildProvider<void, { conversation_id: string }>('conversation.flush-pending-messages'),
  // Add a single message to the database (used for saving pending messages before unmount)
  addMessage: bridge.buildProvider<void, { conversation_id: string; message: import('@/common/chatLib').TMessage }>('conversation.add-message'),
  // Sync messages from Moss Server to local DB (enterprise mode, triggered on conversation click)
  syncMessages: bridge.buildProvider<IBridgeResponse<{ syncedCount: number; nameUpdated: boolean; conversationStatus?: string }>, { conversation_id: string }>('conversation.sync-messages'),
  confirmation: {
    add: bridge.buildEmitter<IConfirmation<any> & { conversation_id: string }>('confirmation.add'),
    update: bridge.buildEmitter<IConfirmation<any> & { conversation_id: string }>('confirmation.update'),
    confirm: bridge.buildProvider<IBridgeResponse, { conversation_id: string; msg_id: string; data: any; callId: string }>('confirmation.confirm'),
    list: bridge.buildProvider<IConfirmation<any>[], { conversation_id: string }>('confirmation.list'),
    remove: bridge.buildEmitter<{ conversation_id: string; id: string }>('confirmation.remove'),
  },
  // Session-level approval memory for "always allow" decisions
  // 会话级别的权限记忆，用于 "always allow" 决策
  approval: {
    // Check if action is approved (keys are parsed from action+commandType in backend)
    // 检查操作是否已批准（keys 由后端从 action+commandType 解析）
    check: bridge.buildProvider<boolean, { conversation_id: string; action: string; commandType?: string }>('approval.check'),
  },
};

// CDP status interface
export interface ICdpStatus {
  /** Whether CDP is currently enabled */
  enabled: boolean;
  /** Current CDP port (null if disabled or not started) */
  port: number | null;
  /** Whether CDP was enabled at startup (requires restart to change) */
  startupEnabled: boolean;
  /** All active CDP instances from registry */
  instances: Array<{
    pid: number;
    port: number;
    cwd: string;
    startTime: number;
  }>;
  /** Whether the app is running in development mode */
  isDevMode: boolean;
}

// CDP config interface
export interface ICdpConfig {
  /** Whether CDP is enabled */
  enabled?: boolean;
  /** Preferred port number */
  port?: number;
}

export const application = {
  restart: bridge.buildProvider<void, void>('restart-app'), // 重启应用
  /** Start consumer-mode services (serviceManager + ChannelManager) without restarting the app. */
  startConsumerServices: bridge.buildProvider<IBridgeResponse<void>, void>('start-consumer-services'),
  openDevTools: bridge.buildProvider<boolean, void>('open-dev-tools'), // 打开/关闭开发者工具，返回操作后的状态
  isDevToolsOpened: bridge.buildProvider<boolean, void>('is-dev-tools-opened'), // 获取 DevTools 当前状态
  systemInfo: bridge.buildProvider<{ cacheDir: string; workDir: string; platform: string; arch: string }, void>('system.info'), // 获取系统信息
  getPath: bridge.buildProvider<string, { name: 'desktop' | 'home' | 'downloads' }>('app.get-path'), // 获取系统路径
  updateSystemInfo: bridge.buildProvider<IBridgeResponse, { cacheDir: string; workDir: string }>('system.update-info'), // 更新系统信息
  getZoomFactor: bridge.buildProvider<number, void>('app.get-zoom-factor'),
  setZoomFactor: bridge.buildProvider<number, { factor: number }>('app.set-zoom-factor'),
  // CDP (Chrome DevTools Protocol) management
  getCdpStatus: bridge.buildProvider<IBridgeResponse<ICdpStatus>, void>('app.get-cdp-status'), // 获取 CDP 状态
  updateCdpConfig: bridge.buildProvider<IBridgeResponse<ICdpConfig>, Partial<ICdpConfig>>('app.update-cdp-config'), // 更新 CDP 配置
  // Bridge Main Process logs to Renderer F12 Console
  logStream: bridge.buildEmitter<{ level: 'log' | 'warn' | 'error'; tag: string; message: string; data?: unknown }>('app.log-stream'),
  // DevTools state change notification
  devToolsStateChanged: bridge.buildEmitter<{ isOpen: boolean }>('app.devtools-state-changed'),
  // Execute shell command
  execCommand: bridge.buildProvider<IBridgeResponse<{ stdout?: string; stderr?: string }>, { command: string; cwd?: string }>('app.exec-command'),
};

// Manual (opt-in) updates via GitHub Releases
export const update = {
  /** Ask the renderer to open the update UI (e.g. from app menu). */
  open: bridge.buildEmitter<{ source?: 'menu' | 'about' }>('update.open'),
  /** Check GitHub releases and return latest version info. */
  check: bridge.buildProvider<IBridgeResponse<UpdateCheckResult>, UpdateCheckRequest>('update.check'),
  /** Download a chosen release asset (explicit user action). */
  download: bridge.buildProvider<IBridgeResponse<UpdateDownloadResult>, UpdateDownloadRequest>('update.download'),
  /** Download progress events emitted by main process. */
  downloadProgress: bridge.buildEmitter<UpdateDownloadProgressEvent>('update.download.progress'),
};

// Auto-updater (electron-updater) API
export const autoUpdate = {
  /** Check for updates using electron-updater */
  check: bridge.buildProvider<IBridgeResponse<{ updateInfo?: { version: string; releaseDate?: string; releaseNotes?: string } }>, { includePrerelease?: boolean }>('auto-update.check'),
  /** Download update using electron-updater */
  download: bridge.buildProvider<IBridgeResponse, void>('auto-update.download'),
  /** Quit and install the downloaded update */
  quitAndInstall: bridge.buildProvider<void, void>('auto-update.quit-and-install'),
  /** Get the path to the downloaded update file, if any */
  getDownloadedFilePath: bridge.buildProvider<IBridgeResponse<{ path: string | null }>, void>('auto-update.get-downloaded-file-path'),
  /** Auto-update status events */
  status: bridge.buildEmitter<AutoUpdateStatus>('auto-update.status'),
  /** Get current mirror source status (for Chinese users) */
  getMirrorStatus: bridge.buildProvider<IBridgeResponse<{ useMirror: boolean; reason: string }>, void>('auto-update.get-mirror-status'),
};

export const starOffice = {
  detectUrl: bridge.buildProvider<IBridgeResponse<{ url: string | null }>, { preferredUrl?: string; force?: boolean; timeoutMs?: number }>('star-office.detect-url'),
};

export interface IOpenDialogResult {
  canceled: boolean;
  filePaths: string[];
}

export const dialog = {
  showOpen: bridge.buildProvider<IBridgeResponse<IOpenDialogResult>, { defaultPath?: string; properties?: OpenDialogOptions['properties']; filters?: OpenDialogOptions['filters'] } | undefined>('show-open'), // 打开文件/文件夹选择窗口
};

export interface BdpanFileEntry {
  filename: string;
  path: string;
  isdir: boolean;
  size: number;
  server_mtime: number;
}

export const bdpan = {
  whoami: bridge.buildProvider<IBridgeResponse<{ authenticated: boolean; has_valid_token: boolean; username?: string; error?: string }>, void>('bdpan.whoami'),
  loginGetAuthUrl: bridge.buildProvider<IBridgeResponse<{ auth_url?: string; error?: string }>, void>('bdpan.loginGetAuthUrl'),
  loginSetCode: bridge.buildProvider<IBridgeResponse<{ type: string; message?: string }>, { code: string }>('bdpan.loginSetCode'),
  ls: bridge.buildProvider<IBridgeResponse<{ files: BdpanFileEntry[]; error?: string }>, { path: string }>('bdpan.ls'),
  logout: bridge.buildProvider<IBridgeResponse<{ success: boolean }>, void>('bdpan.logout'),
  download: bridge.buildProvider<IBridgeResponse<{ localPath: string }>, { remotePath: string; destDir: string }>('bdpan.download'),
  upload: bridge.buildProvider<IBridgeResponse<{ error?: string }>, { localPath: string; remotePath: string }>('bdpan.upload'),
  mkdir: bridge.buildProvider<IBridgeResponse<{ error?: string }>, { path: string }>('bdpan.mkdir'),
  downloadResult: bridge.buildEmitter<{ success: boolean; error?: string }>('bdpan.downloadResult'),
};
export const fs = {
  getFilesByDir: bridge.buildProvider<Array<IDirOrFile>, { dir: string; root: string }>('get-file-by-dir'), // 获取指定文件夹下所有文件夹和文件列表
  listDir: bridge.buildProvider<string[], { dir: string }>('fs.list-dir'), // 列出目录下的直接子项名称（不递归）
  getImageBase64: bridge.buildProvider<string, { path: string }>('get-image-base64'), // 获取图片base64
  fetchRemoteImage: bridge.buildProvider<string, { url: string }>('fetch-remote-image'), // 远程图片转base64
  readFile: bridge.buildProvider<string, { path: string }>('read-file'), // 读取文件内容（UTF-8）
  readFileBuffer: bridge.buildProvider<ArrayBuffer, { path: string }>('read-file-buffer'), // 读取二进制文件为 ArrayBuffer
  readFileBase64: bridge.buildProvider<string, { path: string }>('read-file-base64'), // 读取二进制文件为 Base64 字符串（适用于 IPC JSON 序列化场景）
  createTempFile: bridge.buildProvider<string, { fileName: string }>('create-temp-file'), // 创建临时文件
  createDir: bridge.buildProvider<boolean, { path: string }>('create-dir'), // 创建目录
  writeFile: bridge.buildProvider<boolean, { path: string; data: Uint8Array | string }>('write-file'), // 写入文件
  createZip: bridge.buildProvider<
    boolean,
    {
      path: string;
      requestId?: string;
      files: Array<{
        /** Path inside zip (supports nested paths like "topic-1/workspace/a.txt") */
        name: string;
        /** Text or binary content to write into zip */
        content?: string | Uint8Array;
        /** Absolute file path on disk, zip bridge will read and pack it */
        sourcePath?: string;
      }>;
    }
  >('create-zip-file'), // 创建 zip 文件
  cancelZip: bridge.buildProvider<boolean, { requestId: string }>('cancel-zip-file'), // 取消 zip 创建任务
  getFileMetadata: bridge.buildProvider<IFileMetadata, { path: string }>('get-file-metadata'), // 获取文件元数据
  copyFilesToWorkspace: bridge.buildProvider<
    // 返回成功与部分失败的详细状态，便于前端提示用户 / Return details for successful and failed copies for better UI feedback
    IBridgeResponse<{ copiedFiles: string[]; failedFiles?: Array<{ path: string; error: string }> }>,
    { filePaths: string[]; workspace: string; sourceRoot?: string }
  >('copy-files-to-workspace'), // 复制文件到工作空间 (Copy files into workspace)
  removeEntry: bridge.buildProvider<IBridgeResponse, { path: string }>('remove-entry'), // 删除文件或文件夹
  renameEntry: bridge.buildProvider<IBridgeResponse<{ newPath: string }>, { path: string; newName: string }>('rename-entry'), // 重命名文件或文件夹
  readBuiltinRule: bridge.buildProvider<string, { fileName: string }>('read-builtin-rule'), // 读取内置 rules 文件
  readBuiltinSkill: bridge.buildProvider<string, { fileName: string }>('read-builtin-skill'), // 读取内置 skills 文件
  // 助手规则文件操作 / Assistant rule file operations
  readAssistantRule: bridge.buildProvider<string, { assistantId: string; locale?: string }>('read-assistant-rule'), // 读取助手规则文件
  writeAssistantRule: bridge.buildProvider<boolean, { assistantId: string; content: string; locale?: string }>('write-assistant-rule'), // 写入助手规则文件
  deleteAssistantRule: bridge.buildProvider<boolean, { assistantId: string }>('delete-assistant-rule'), // 删除助手规则文件
  // 助手技能文件操作 / Assistant skill file operations
  readAssistantSkill: bridge.buildProvider<string, { assistantId: string; locale?: string }>('read-assistant-skill'), // 读取助手技能文件
  writeAssistantSkill: bridge.buildProvider<boolean, { assistantId: string; content: string; locale?: string }>('write-assistant-skill'), // 写入助手技能文件
  deleteAssistantSkill: bridge.buildProvider<boolean, { assistantId: string }>('delete-assistant-skill'), // 删除助手技能文件
  // 获取可用 skills 列表 / List available skills from skills directory
  listAvailableSkills: bridge.buildProvider<Array<{ name: string; description: string; location: string; isCustom: boolean }>, void>('list-available-skills'),
  // 读取 skill 信息（不导入）/ Read skill info without importing
  readSkillInfo: bridge.buildProvider<IBridgeResponse<{ name: string; description: string }>, { skillPath: string }>('read-skill-info'),
  // 导入 skill 目录 / Import skill directory
  importSkill: bridge.buildProvider<IBridgeResponse<{ skillName: string }>, { skillPath: string }>('import-skill'),
  // 扫描目录下的 skills / Scan directory for skills
  scanForSkills: bridge.buildProvider<IBridgeResponse<Array<{ name: string; description: string; path: string; displayName?: string; icon?: string; iconUrl?: string; color?: string; emoji?: string | null }>>, { folderPath: string }>('scan-for-skills'),
  // 检测常见的 skills 路径 / Detect common skills paths
  detectCommonSkillPaths: bridge.buildProvider<IBridgeResponse<Array<{ name: string; path: string }>>, void>('detect-common-skill-paths'),
};

export const fileWatch = {
  startWatch: bridge.buildProvider<IBridgeResponse, { filePath: string }>('file-watch-start'), // 开始监听文件变化
  stopWatch: bridge.buildProvider<IBridgeResponse, { filePath: string }>('file-watch-stop'), // 停止监听文件变化
  stopAllWatches: bridge.buildProvider<IBridgeResponse, void>('file-watch-stop-all'), // 停止所有文件监听
  fileChanged: bridge.buildEmitter<{ filePath: string; eventType: string }>('file-changed'), // 文件变化事件
  // 目录监听 / Directory watching (inotify-style auto refresh)
  startWatchDir: bridge.buildProvider<IBridgeResponse<{ watchId: string }>, { dirPath: string; recursive?: boolean }>('file-watch-dir-start'),
  stopWatchDir: bridge.buildProvider<IBridgeResponse, { watchId: string }>('file-watch-dir-stop'),
  dirChanged: bridge.buildEmitter<{ watchId: string; dirPath: string; eventType: string; changedPath?: string }>('dir-changed'),
};

// 文件流式更新（Agent 写入文件时实时推送内容）/ File streaming updates (real-time content push when agent writes)
export const fileStream = {
  contentUpdate: bridge.buildEmitter<{
    filePath: string; // 文件绝对路径 / Absolute file path
    content: string; // 新内容 / New content
    workspace: string; // 工作空间根目录 / Workspace root directory
    relativePath: string; // 相对路径 / Relative path
    operation: 'write' | 'delete'; // 操作类型 / Operation type
  }>('file-stream-content-update'), // Agent 写入文件时的流式内容更新 / Streaming content update when agent writes file
};

export const googleAuth = {
  login: bridge.buildProvider<IBridgeResponse<{ account: string }>, { proxy?: string }>('google.auth.login'),
  logout: bridge.buildProvider<void, {}>('google.auth.logout'),
  status: bridge.buildProvider<IBridgeResponse<{ account: string }>, { proxy?: string }>('google.auth.status'),
};

// 订阅状态查询：用于动态决定是否展示 gemini-3.1-pro-preview / subscription check for Gemini models
export const gemini = {
  subscriptionStatus: bridge.buildProvider<IBridgeResponse<{ isSubscriber: boolean; tier?: string; lastChecked: number; message?: string }>, { proxy?: string }>('gemini.subscription-status'),
};

// AWS Bedrock 相关接口 / AWS Bedrock interfaces
export const bedrock = {
  testConnection: bridge.buildProvider<IBridgeResponse<{ msg?: string }>, { bedrockConfig: { authMethod: 'accessKey' | 'profile'; region: string; accessKeyId?: string; secretAccessKey?: string; profile?: string } }>('bedrock.test-connection'),
};

// Moss Server (Enterprise) interfaces - 企业模式下会话由 Moss Server 管理
export interface MossSessionInfo {
  sessionId: string;
  wsUrl: string;
  workDir?: string;
  assistantName?: string;
  status?: 'active' | 'idle' | 'terminated' | 'ended';
  createdAt?: number;
  updatedAt?: number;
}

export interface MossWorkspaceNode {
  name: string;
  relativePath: string;
  fullPath: string;
  isFile: boolean;
  isDir: boolean;
  size?: number;
  mtime?: number;
  children?: MossWorkspaceNode[];
}

export type MossWorkspaceFilePreview =
  | {
      kind: 'text';
      name: string;
      relativePath: string;
      mime: string;
      encoding: 'utf8';
      content: string;
      size: number;
      truncated: boolean;
    }
  | {
      kind: 'base64';
      name: string;
      relativePath: string;
      mime: string;
      contentBase64: string;
      size: number;
    };

export interface MossSessionAvailableSkill {
  name: string;
  displayName?: string;
  description: string;
  icon?: string;
  iconUrl?: string;
  color?: string;
  emoji?: string | null;
  source?: string;
  path?: string;
}

export type IRemoteWorkspaceResponse = IBridgeResponse<{
  files: IDirOrFile[];
  pending?: boolean;
}>;

export type IRemoteAvailableSkillsResponse = IBridgeResponse<{
  skills: MossSessionAvailableSkill[];
  pending?: boolean;
}>;

export const moss = {
  /** Check if enterprise mode is enabled */
  isEnterpriseMode: bridge.buildProvider<boolean, void>('moss.is-enterprise-mode'),
  /** Get Moss Server URL and auth config */
  getConfig: bridge.buildProvider<
    {
      serverUrl: string;
      hasToken: boolean;
    },
    void
  >('moss.get-config'),
  /** Set JWT auth token directly (no conversion needed) */
  setAuthToken: bridge.buildProvider<
    IBridgeResponse,
    {
      authToken: string;
    }
  >('moss.set-auth-token'),
  /** List all sessions from Moss Server */
  listSessions: bridge.buildProvider<IBridgeResponse<MossSessionInfo[]>, void>('moss.list-sessions'),
  /** Create a new session on Moss Server */
  createSession: bridge.buildProvider<
    IBridgeResponse<MossSessionInfo>,
    {
      cwd?: string;
      assistantName?: string;
      dangerouslySkipPermissions?: boolean;
      runtimeType?: 'host' | 'docker';
    }
  >('moss.create-session'),
  /** Get session details */
  getSession: bridge.buildProvider<IBridgeResponse<MossSessionInfo>, { sessionId: string }>('moss.get-session'),
  /** Delete a session */
  deleteSession: bridge.buildProvider<IBridgeResponse, { sessionId: string }>('moss.delete-session'),
  /** Update session metadata (e.g., title) */
  updateSession: bridge.buildProvider<IBridgeResponse<MossSessionInfo>, { sessionId: string; title?: string }>('moss.update-session'),
  /** Resume an existing session to get WebSocket URL */
  resumeSession: bridge.buildProvider<IBridgeResponse<{ wsUrl: string; session: MossSessionInfo }>, { sessionId: string }>('moss.resume-session'),
  /** Send message to session (WebSocket) */
  sendMessage: bridge.buildProvider<
    IBridgeResponse,
    {
      sessionId: string;
      wsUrl: string;
      content: string;
      files?: string[];
    }
  >('moss.send-message'),
  /** Stream response from Moss Server */
  responseStream: bridge.buildEmitter<IResponseMessage>('moss.response-stream'),
  /** Stop/interrupt current operation */
  stop: bridge.buildProvider<IBridgeResponse, { sessionId: string }>('moss.stop'),
  /** Respond to permission request */
  respondPermission: bridge.buildProvider<IBridgeResponse, { sessionId: string; requestId: string; optionId: string }>('moss.respond-permission'),

  // === Model Management ===
  /** Get available models from Moss Server */
  getAvailableModels: bridge.buildProvider<IBridgeResponse<Array<{ id: string; name: string; ratio: number }>>, void>('moss.get-available-models'),
  /** Get user's model preference */
  getUserModel: bridge.buildProvider<IBridgeResponse<{ modelId: string; updatedAt: number; systemDefaultModel: string } | null>, void>('moss.get-user-model'),
  /** Set user's model preference */
  setUserModel: bridge.buildProvider<IBridgeResponse<{ modelId: string; updatedAt: number }>, { modelId: string }>('moss.set-user-model'),
  /** Set model for current session (via WebSocket) */
  setModel: bridge.buildProvider<IBridgeResponse, { sessionId: string; modelId: string }>('moss.set-model'),
  /** Model changed event (emitted when model switch completes) */
  modelChanged: bridge.buildEmitter<{ sessionId: string; model: string }>('moss.model-changed'),
};

export const mode = {
  fetchModelList: bridge.buildProvider<IBridgeResponse<{ mode: Array<string | { id: string; name: string }>; fix_base_url?: string }>, { base_url?: string; api_key: string; try_fix?: boolean; platform?: string; bedrockConfig?: { authMethod: 'accessKey' | 'profile'; region: string; accessKeyId?: string; secretAccessKey?: string; profile?: string } }>('mode.get-model-list'),
  saveModelConfig: bridge.buildProvider<IBridgeResponse, IProvider[]>('mode.save-model-config'),
  getModelConfig: bridge.buildProvider<IProvider[], void>('mode.get-model-config'),
  /** 协议检测接口 - 自动检测 API 端点使用的协议类型 / Protocol detection - auto-detect API protocol type */
  detectProtocol: bridge.buildProvider<IBridgeResponse<ProtocolDetectionResponse>, ProtocolDetectionRequest>('mode.detect-protocol'),
};

// ACP对话相关接口 - 复用统一的conversation接口
export const acpConversation = {
  sendMessage: conversation.sendMessage,
  responseStream: conversation.responseStream,
  answerQuestion: bridge.buildProvider<IBridgeResponse<void>, { conversationId: string; toolCallId: string; answers: Array<{ id: string; value: string; label?: string }> }>('acp.answer-question'),
  detectCliPath: bridge.buildProvider<IBridgeResponse<{ path?: string }>, { backend: AcpBackend }>('acp.detect-cli-path'),
  getAvailableAgents: bridge.buildProvider<
    IBridgeResponse<
      Array<{
        backend: AcpBackendAll;
        name: string;
        cliPath?: string;
        customAgentId?: string;
        isPreset?: boolean;
        context?: string;
        avatar?: string;
        // Allow extension-contributed adapter IDs in addition to built-in PresetAgentType values
        presetAgentType?: PresetAgentType | string;
        supportedTransports?: string[];
        isExtension?: boolean;
        extensionName?: string;
        // Enterprise-specific metadata for remote-agent
        enterpriseMetadata?: {
          mossServerUrl?: string;
          authMode?: 'api_key' | 'password' | 'access_token';
          runtimeType?: 'host' | 'docker';
        };
      }>
    >,
    void
  >('acp.get-available-agents'),
  checkEnv: bridge.buildProvider<{ env: Record<string, string> }, void>('acp.check.env'),
  refreshCustomAgents: bridge.buildProvider<IBridgeResponse, void>('acp.refresh-custom-agents'),
  /** Re-run full CLI agent detection (after install/uninstall) */
  rescanAgents: bridge.buildProvider<IBridgeResponse, void>('acp.rescan-agents'),
  checkAgentHealth: bridge.buildProvider<IBridgeResponse<{ available: boolean; latency?: number; error?: string }>, { backend: AcpBackend }>('acp.check-agent-health'),
  // Set session mode for ACP agents (claude, qwen, etc.)
  // 设置 ACP 代理的会话模式（claude、qwen 等）
  setMode: bridge.buildProvider<IBridgeResponse<{ mode: string }>, { conversationId: string; mode: string }>('acp.set-mode'),
  // Get current session mode for ACP agents
  // 获取 ACP 代理的当前会话模式
  getMode: bridge.buildProvider<IBridgeResponse<{ mode: string; initialized: boolean }>, { conversationId: string }>('acp.get-mode'),
  // Get model info for ACP agents (model name and available models)
  // 获取 ACP 代理的模型信息（模型名称和可用模型）
  getModelInfo: bridge.buildProvider<IBridgeResponse<{ modelInfo: AcpModelInfo | null }>, { conversationId: string }>('acp.get-model-info'),
  // Probe model info for an ACP backend without creating a visible conversation
  // 预探测 ACP 后端的模型信息，不创建可见会话
  probeModelInfo: bridge.buildProvider<IBridgeResponse<{ modelInfo: AcpModelInfo | null }>, { backend: AcpBackend }>('acp.probe-model-info'),
  // Set model for ACP agents
  // 设置 ACP 代理的模型
  setModel: bridge.buildProvider<IBridgeResponse<{ modelInfo: AcpModelInfo | null }>, { conversationId: string; modelId: string }>('acp.set-model'),
  // Get non-model config options for ACP agents (e.g., reasoning effort)
  // 获取 ACP 代理的非模型配置选项（如推理级别）
  getConfigOptions: bridge.buildProvider<IBridgeResponse<{ configOptions: import('../types/acpTypes').AcpSessionConfigOption[] }>, { conversationId: string }>('acp.get-config-options'),
  // Set a config option value for ACP agents (e.g., reasoning effort)
  // 设置 ACP 代理的配置选项值（如推理级别）
  setConfigOption: bridge.buildProvider<IBridgeResponse<{ configOptions: import('../types/acpTypes').AcpSessionConfigOption[] }>, { conversationId: string; configId: string; value: string }>('acp.set-config-option'),
};

// MCP 服务相关接口
export const mcpService = {
  getAgentMcpConfigs: bridge.buildProvider<IBridgeResponse<Array<{ source: McpSource; servers: IMcpServer[] }>>, Array<{ backend: AcpBackend; name: string; cliPath?: string }>>('mcp.get-agent-configs'),
  testMcpConnection: bridge.buildProvider<IBridgeResponse<{ success: boolean; tools?: Array<{ name: string; description?: string }>; error?: string; needsAuth?: boolean; authMethod?: 'oauth' | 'basic'; wwwAuthenticate?: string }>, IMcpServer>('mcp.test-connection'),
  syncMcpToAgents: bridge.buildProvider<IBridgeResponse<{ success: boolean; results: Array<{ agent: string; success: boolean; error?: string }> }>, { mcpServers: IMcpServer[]; agents: Array<{ backend: AcpBackend; name: string; cliPath?: string }> }>('mcp.sync-to-agents'),
  removeMcpFromAgents: bridge.buildProvider<IBridgeResponse<{ success: boolean; results: Array<{ agent: string; success: boolean; error?: string }> }>, { mcpServerName: string; agents: Array<{ backend: AcpBackend; name: string; cliPath?: string }> }>('mcp.remove-from-agents'),
  // OAuth 相关接口
  checkOAuthStatus: bridge.buildProvider<IBridgeResponse<{ isAuthenticated: boolean; needsLogin: boolean; error?: string }>, IMcpServer>('mcp.check-oauth-status'),
  loginMcpOAuth: bridge.buildProvider<IBridgeResponse<{ success: boolean; error?: string }>, { server: IMcpServer; config?: any }>('mcp.login-oauth'),
  logoutMcpOAuth: bridge.buildProvider<IBridgeResponse, string>('mcp.logout-oauth'),
  getAuthenticatedServers: bridge.buildProvider<IBridgeResponse<string[]>, void>('mcp.get-authenticated-servers'),
};

// mcporter 服务相关接口
export interface IMcporterDaemonStatus {
  running: boolean;
  pid?: number;
  socketPath?: string;
  uptime?: number;
}

export const mcporterService = {
  isAvailable: bridge.buildProvider<IBridgeResponse<boolean>, void>('mcporter.is-available'),
  install: bridge.buildProvider<IBridgeResponse<void>, void>('mcporter.install'),
  syncConfig: bridge.buildProvider<IBridgeResponse<void>, IMcpServer[]>('mcporter.sync-config'),
  startDaemon: bridge.buildProvider<IBridgeResponse<void>, void>('mcporter.start-daemon'),
  stopDaemon: bridge.buildProvider<IBridgeResponse<void>, void>('mcporter.stop-daemon'),
  getDaemonStatus: bridge.buildProvider<IBridgeResponse<IMcporterDaemonStatus>, void>('mcporter.get-daemon-status'),
  getConfigPath: bridge.buildProvider<IBridgeResponse<string>, void>('mcporter.get-config-path'),
  initialize: bridge.buildProvider<IBridgeResponse<void>, IMcpServer[]>('mcporter.initialize'),
};

// Database operations
export const database = {
  getConversationMessages: bridge.buildProvider<import('@/common/chatLib').TMessage[], { conversation_id: string; page?: number; pageSize?: number }>('database.get-conversation-messages'),
  getUserConversations: bridge.buildProvider<import('@/common/storage').TChatConversation[], { page?: number; pageSize?: number; sessionMode?: 'remote' | 'local' }>('database.get-user-conversations'),
  /** 渠道对话创建/更新/删除时，主进程通知渲染进程刷新对话列表 */
  conversationChanged: bridge.buildEmitter<{
    conversationId: string;
    source?: string;
    action: 'created' | 'updated' | 'deleted';
  }>('database.conversation-changed'),
};

export const previewHistory = {
  list: bridge.buildProvider<PreviewSnapshotInfo[], { target: PreviewHistoryTarget }>('preview-history.list'),
  save: bridge.buildProvider<PreviewSnapshotInfo, { target: PreviewHistoryTarget; content: string }>('preview-history.save'),
  getContent: bridge.buildProvider<{ snapshot: PreviewSnapshotInfo; content: string } | null, { target: PreviewHistoryTarget; snapshotId: string }>('preview-history.get-content'),
};

// 预览面板相关接口 / Preview panel API
export const preview = {
  // Agent 触发打开预览（如 ai-dev-browser page_goto 导航到 URL）/ Agent triggers open preview (e.g., ai-dev-browser page_goto)
  open: bridge.buildEmitter<{
    content: string; // URL 或内容 / URL or content
    contentType: import('./types/preview').PreviewContentType; // 内容类型 / Content type
    metadata?: {
      title?: string;
      fileName?: string;
    };
  }>('preview.open'),
};

// Right-panel BrowserPanel "open URL" event. Fired from the main process when
// the AI writes an HTML file to workspace, and (later) when /browser slash
// commands or MCP tools request opening a URL in the right-panel browser.
export const rightPanelBrowser = {
  open: bridge.buildEmitter<{ url: string; switchTab?: boolean }>('right-panel.browser.open'),
};

// AI-generated file deliverables for a conversation. The list is built by
// scanning persisted assistant messages for the NEXUS_GENERATED_FILES marker;
// the `changed` emitter fires from the agent at turn finish so the renderer
// can update without a refetch round-trip.
export const deliverables = {
  list: bridge.buildProvider<
    IBridgeResponse<
      Array<{
        path: string;
        relativePath?: string;
        kind: 'create' | 'edit';
        ext: string;
        mime?: string;
        size?: number;
        createdAt: number;
      }>
    >,
    { conversationId: string }
  >('deliverables.list'),
  changed: bridge.buildEmitter<{
    conversationId: string;
    files: Array<{
      path: string;
      relativePath?: string;
      kind: 'create' | 'edit';
      ext: string;
      mime?: string;
      size?: number;
      createdAt: number;
    }>;
  }>('deliverables.changed'),
};

export const document = {
  convert: bridge.buildProvider<import('./types/conversion').DocumentConversionResponse, import('./types/conversion').DocumentConversionRequest>('document.convert'),
  /** 将内容保存为 Word 文档并返回保存路径 / Save content as Word and return path */
  saveAsDocx: bridge.buildProvider<IBridgeResponse<string>, { markdown: string; conversationId: string; fileName?: string }>('document.save-as-docx'),
  libreOffice: {
    isAvailable: bridge.buildProvider<boolean, void>('document.libreoffice.is-available'),
  },
  /** 获取文件最后修改时间 (mtime) / Get file last modification time */
  getFileMtime: bridge.buildProvider<number, { filePath: string }>('document.get-file-mtime'),
};

export interface ICliStatus {
  installed: boolean;
  path?: string;
  version?: string;
  source: 'managed' | 'system' | 'none';
}

// Claude CLI installer / 安装 claude 命令行工具
export const claudeCli = {
  checkInstalled: bridge.buildProvider<IBridgeResponse<ICliStatus>, void>('claude-cli.check-installed'),
  install: bridge.buildProvider<IBridgeResponse<void>, void>('claude-cli.install'),
  uninstall: bridge.buildProvider<IBridgeResponse<void>, void>('claude-cli.uninstall'),
  /** Emitted by main process when installation completes (success or failure) */
  installResult: bridge.buildEmitter<{ success: boolean; msg?: string }>('claude-cli.install-result'),
  /** Emitted during installation to report progress */
  installProgress: bridge.buildEmitter<{ phase: 'downloading' | 'extracting' | 'configuring'; percent?: number }>('claude-cli.install-progress'),
};

// Bundled Node.js runtime
export const nodeRuntime = {
  checkInstalled: bridge.buildProvider<IBridgeResponse<ICliStatus>, void>('node-runtime.check-installed'),
  install: bridge.buildProvider<IBridgeResponse<void>, void>('node-runtime.install'),
  uninstall: bridge.buildProvider<IBridgeResponse<void>, void>('node-runtime.uninstall'),
  /** Emitted by main process when installation completes (success or failure) */
  installResult: bridge.buildEmitter<{ success: boolean; msg?: string }>('node-runtime.install-result'),
};

// ShareOne CLI installer & publish
export type IShareoneResponse = { success: boolean; msg?: string; code?: string };
export const shareoneCli = {
  checkInstalled: bridge.buildProvider<IBridgeResponse<ICliStatus>, void>('shareone.check-installed'),
  install: bridge.buildProvider<IBridgeResponse<void>, void>('shareone.install'),
  installResult: bridge.buildEmitter<{ success: boolean; msg?: string }>('shareone.install-result'),
  installProgress: bridge.buildEmitter<{ phase: 'downloading' | 'extracting' | 'configuring'; percent?: number }>('shareone.install-progress'),
  publishTurn: bridge.buildProvider<IShareoneResponse & IBridgeResponse<{ url: string }>, { markdown: string; title: string }>('shareone.publish-turn'),
  publishFile: bridge.buildProvider<IShareoneResponse & IBridgeResponse<{ url: string }>, { filePath: string }>('shareone.publish-file'),
};

// LibreOffice installer / LibreOffice 在线安装
export type ILibreOfficeInstallPhase = 'downloading' | 'mounting' | 'copying' | 'unmounting' | 'installing' | 'extracting' | 'cleanup';
export type ISudoclawInstallPhase = 'extracting' | 'installing' | 'configuring';

export const libreOffice = {
  checkInstalled: bridge.buildProvider<IBridgeResponse<ICliStatus>, void>('libreoffice.check-installed'),
  install: bridge.buildProvider<IBridgeResponse<void>, void>('libreoffice.install'),
  /** Install LibreOffice from a local file */
  installFromLocalFile: bridge.buildProvider<IBridgeResponse<void>, { filePath: string }>('libreoffice.install-from-local-file'),
  uninstall: bridge.buildProvider<IBridgeResponse<void>, void>('libreoffice.uninstall'),
  /** Returns the current install state so the UI can restore progress after navigation */
  getInstallState: bridge.buildProvider<IBridgeResponse<{ installing: boolean; phase?: ILibreOfficeInstallPhase; percent?: number }>, void>('libreoffice.get-install-state'),
  /** Emitted periodically during installation with current phase and download percent */
  installProgress: bridge.buildEmitter<{ phase: ILibreOfficeInstallPhase; percent?: number }>('libreoffice.install-progress'),
  /** Emitted once when installation completes (success or failure) */
  installResult: bridge.buildEmitter<{ success: boolean; msg?: string }>('libreoffice.install-result'),
};

// Python runtime installer / Python 运行环境安装
export type IPythonInstallPhase = 'downloading' | 'installing' | 'configuring' | 'cleanup';

export const pythonRuntime = {
  checkInstalled: bridge.buildProvider<IBridgeResponse<ICliStatus>, void>('python-runtime.check-installed'),
  install: bridge.buildProvider<IBridgeResponse<void>, void>('python-runtime.install'),
  uninstall: bridge.buildProvider<IBridgeResponse<void>, void>('python-runtime.uninstall'),
  /** Returns the current install state so the UI can restore progress after navigation */
  getInstallState: bridge.buildProvider<IBridgeResponse<{ installing: boolean; phase?: IPythonInstallPhase; percent?: number }>, void>('python-runtime.get-install-state'),
  /** Emitted periodically during installation with current phase and download percent */
  installProgress: bridge.buildEmitter<{ phase: IPythonInstallPhase; percent?: number }>('python-runtime.install-progress'),
  /** Emitted once when installation completes (success or failure) */
  installResult: bridge.buildEmitter<{ success: boolean; msg?: string }>('python-runtime.install-result'),
};

// Sudoclaw config (~/.nexus/sudoclaw) / Sudoclaw 配置
// Matches sudoclaw.json schema: models.providers, agents.defaults, etc.
export type SudoclawProviderModel = { id: string; name?: string; input?: string[] };
export type SudoclawProvider = {
  baseUrl?: string;
  apiKey?: string;
  api?: string; // e.g. openai, anthropic, google-generative-ai
  models?: SudoclawProviderModel[];
};
export type SudoclawConfig = {
  lastRunMode?: string;
  agents?: { defaults?: { model?: { primary?: string; fallbacks?: string[] }; imageModel?: string; imageAnalysisModel?: string; imageGenerationModel?: string; models?: Record<string, { alias?: string }> } };
  models?: {
    mode?: 'merge' | 'replace';
    providers?: Record<string, SudoclawProvider>;
  };
  env?: { vars?: Record<string, string> };
  plugins?: { entries?: Record<string, { enabled?: boolean; config?: Record<string, unknown> }> };
};

export type SudoclawTestGatewayResult = {
  success: boolean;
  port?: number;
  error?: string;
  stdout?: string;
  stderr?: string;
};

export interface ISudoclawStatus {
  installed: boolean;
  configPath: string;
  gatewayRunning?: boolean;
  gatewayPort?: number;
  gatewayHost?: string;
  gatewayUrl?: string;
  isConnected?: boolean;
  hasActiveSession?: boolean;
  sessionKey?: string | null;
  workspace?: string;
  agentName?: string;
  model?: string;
  cliPath?: string;
  version?: string;
  error?: string;
}

export const sudoclaw = {
  /** Get Sudoclaw config from ~/.nexus/sudoclaw/sudoclaw.json */
  getConfig: bridge.buildProvider<IBridgeResponse<SudoclawConfig | null>, void>('sudoclaw.get-config'),
  /** Save Sudoclaw config */
  saveConfig: bridge.buildProvider<IBridgeResponse<void>, { config: SudoclawConfig }>('sudoclaw.save-config'),
  /** Get Sudoclaw install status */
  getStatus: bridge.buildProvider<IBridgeResponse<ISudoclawStatus>, void>('sudoclaw.get-status'),
  /** Test Sudoclaw gateway connection (start gateway, verify ready, then stop) */
  testGateway: bridge.buildProvider<IBridgeResponse<SudoclawTestGatewayResult>, void>('sudoclaw.test-gateway'),
  /** Restart Sudoclaw gateway */
  restartGateway: bridge.buildProvider<IBridgeResponse<void>, void>('sudoclaw.restart-gateway'),
  /** Start Sudoclaw gateway */
  startGateway: bridge.buildProvider<IBridgeResponse<void>, void>('sudoclaw.start-gateway'),
  /** Stop Sudoclaw gateway */
  stopGateway: bridge.buildProvider<IBridgeResponse<void>, void>('sudoclaw.stop-gateway'),
  /** Install Sudoclaw manually from About page */
  install: bridge.buildProvider<IBridgeResponse<void>, void>('sudoclaw.install'),
  uninstall: bridge.buildProvider<IBridgeResponse<void>, void>('sudoclaw.uninstall'),
  /** Returns the current install state so the UI can restore progress after navigation */
  getInstallState: bridge.buildProvider<IBridgeResponse<{ installing: boolean; phase?: ISudoclawInstallPhase; percent?: number }>, void>('sudoclaw.get-install-state'),
  /** Emitted once when installation completes (success or failure) */
  installResult: bridge.buildEmitter<{ success: boolean; msg?: string }>('sudoclaw.install-result'),
  /** Emitted during installation to report progress */
  installProgress: bridge.buildEmitter<{ phase: ISudoclawInstallPhase; percent?: number }>('sudoclaw.install-progress'),
  /** Install WeChat plugin to Sudoclaw via npx CLI */
  installWechatPlugin: bridge.buildProvider<IBridgeResponse<{ output: string }>, void>('sudoclaw.install-wechat-plugin'),
  /** Get WeChat plugin installation status */
  getWechatStatus: bridge.buildProvider<IBridgeResponse<{ installed: boolean }>, void>('sudoclaw.get-wechat-status'),
  /** Emitted during WeChat plugin install — delivers QR code data and progress */
  wechatInstallProgress: bridge.buildEmitter<{ phase: 'installing' | 'qrcode' | 'scanning' | 'success' | 'error'; message?: string; qrData?: string; qrUrl?: string }>('sudoclaw.wechat-install-progress'),
};

// Scode config (~/.nexus/sudocode/sudocode.json)
// Matches sudocode.json schema: auth_modes, models, default_model
export type ScodeModelProvider = {
  provider?: string;
  model?: string;
  api?: string;
};
export type ScodeModelEntry = {
  alias?: string;
  name?: string;
  input?: string[];
  supports_tools?: boolean;
  supports_reasoning?: boolean;
  context?: {
    input?: number;
    output?: number;
  };
  providers?: {
    subscription?: ScodeModelProvider;
    proxy?: ScodeModelProvider;
    'api-key'?: ScodeModelProvider;
  };
};
export type ScodeConfig = {
  auth_modes?: {
    subscription?: Record<string, { baseUrl?: string; token?: string; authFile?: string }>;
    proxy?: Record<string, { baseUrl?: string; apiKey?: string }>;
    'api-key'?: Record<string, { baseUrl?: string; apiKey?: string }>;
  };
  default_model?: string;
  models?: Record<string, ScodeModelEntry>;
  web_search?: {
    provider?: string;
    apiUrl?: string;
    apiKey?: string;
  };
};

export const scode = {
  /** Read scode config from ~/.nexus/sudocode/sudocode.json */
  getConfig: bridge.buildProvider<IBridgeResponse<ScodeConfig>, void>('scode.get-config'),
  /** Save full scode config to ~/.nexus/sudocode/sudocode.json (overwrite) */
  saveConfig: bridge.buildProvider<IBridgeResponse<void>, { config: ScodeConfig }>('scode.save-config'),
  /** Save custom OpenAI-compatible scode model providers for the signed-in user */
  saveCustomModelProviders: bridge.buildProvider<IBridgeResponse<void>, { userId: string; providers: ScodeCustomModelProvider[] }>('scode.save-custom-model-providers'),
  /** Restore signed-in user's custom scode model providers into sudocode.json */
  restoreCustomModelProviders: bridge.buildProvider<IBridgeResponse<ScodeConfig>, { userId: string; baseConfig?: ScodeConfig }>('scode.restore-custom-model-providers'),
  /** Update only the default_model field in sudocode.json */
  setDefaultModel: bridge.buildProvider<IBridgeResponse<void>, { modelId: string }>('scode.set-default-model'),
  /** Fetch live model list from sudorouter specific_pricing, rewrite sudocode.json models, return resolved model info */
  refreshModels: bridge.buildProvider<IBridgeResponse<AcpModelInfo>, void>('scode.refresh-models'),
  /** Sync image generation model to sudocode.json tools.imageGenerationModel */
  setImageModel: bridge.buildProvider<IBridgeResponse<void>, { modelId: string | null }>('scode.set-image-model'),
  /** Get scode installation status */
  getStatus: bridge.buildProvider<IBridgeResponse<{ installed: boolean; version?: string }>, void>('scode.get-status'),
  /** Install or reinstall scode binary */
  install: bridge.buildProvider<IBridgeResponse<void>, void>('scode.install'),
  /** Emitted during installation to report progress */
  installProgress: bridge.buildEmitter<{ phase: string; percent?: number }>('scode.install-progress'),
  /** Emitted once when installation completes (success or failure) */
  installResult: bridge.buildEmitter<{ success: boolean; msg?: string }>('scode.install-result'),
};

// Initialization status for runtime dependencies
export type InitPhase = 'pending' | 'installing' | 'ready' | 'error';
export type InitStepStatus = 'pending' | 'active' | 'done' | 'error';

export interface InitRetryStatus {
  attempt: number;
  maxAttempts: number;
  nextRetryAt: number;
}

export interface InitStatus {
  phase: InitPhase;
  message: string;
  progress: number;
  /** Which loading UI should be rendered. */
  displayMode?: 'full' | 'startup';
  error?: string;
  /** Current installation step id: 'git' | 'node' | 'claude' | 'scode' | 'nexus' | 'bdpan' */
  step?: string;
  /** Detail message for current step */
  detail?: string;
  /** Per-step progress values (0-100) */
  stepProgress?: Partial<Record<string, number>>;
  /** Per-step detail messages for concurrent install/start flows. */
  stepDetails?: Partial<Record<string, string>>;
  /** Per-step state values for concurrent install/start flows. */
  stepStates?: Partial<Record<string, InitStepStatus>>;
  /** Recent log entries (last 100) */
  logs?: string[];
  /** Automatic retry countdown for startup/install failures. */
  retry?: InitRetryStatus;
}

export const init = {
  /** Get initialization status */
  getStatus: bridge.buildProvider<IBridgeResponse<InitStatus>, void>('init.get-status'),
  /** Retry startup checks without reinstalling runtimes */
  retryStartup: bridge.buildProvider<IBridgeResponse<void>, void>('init.retry-startup'),
  /** Manually reinstall a failed runtime component and rerun startup checks */
  reinstallComponent: bridge.buildProvider<IBridgeResponse<void>, { component: 'scode' | 'nexus' }>('init.reinstall-component'),
  /** Subscribe to initialization status changes */
  onStatusChange: bridge.buildEmitter<InitStatus>('init.status-change'),
  /** Quit the entire application */
  quitApp: bridge.buildProvider<void, void>('init.quit-app'),
};

// Nexus Python server / 内置 Python 服务
export type NexusInstallPhase = 'checking' | 'downloading' | 'extracting' | 'unpacking' | 'starting' | 'ready' | 'error';

export const nexus = {
  /** Get the current status of the Nexus server */
  getStatus: bridge.buildProvider<IBridgeResponse<{ running: boolean; port: number; setupStage: string; installed: boolean; version?: string }>, void>('nexus.get-status'),
  /** Check if Nexus is installed */
  checkInstalled: bridge.buildProvider<IBridgeResponse<{ installed: boolean }>, void>('nexus.check-installed'),
  /** Install Nexus server */
  install: bridge.buildProvider<IBridgeResponse<void>, void>('nexus.install'),
  uninstall: bridge.buildProvider<IBridgeResponse<void>, void>('nexus.uninstall'),
  /** Emitted periodically during installation with current phase and optional download percent */
  installProgress: bridge.buildEmitter<{ phase: NexusInstallPhase; message: string; percent?: number }>('nexus.install-progress'),
  /** Emitted once when installation completes (success or failure) */
  installResult: bridge.buildEmitter<{ success: boolean; msg?: string }>('nexus.install-result'),
  /** Install Nexus server from local file */
  installFromLocalFile: bridge.buildProvider<IBridgeResponse<void>, { filePath: string }>('nexus.install-from-local-file'),
  /** Start Nexus server */
  start: bridge.buildProvider<IBridgeResponse<void>, void>('nexus.start'),
  /** Stop Nexus server */
  stop: bridge.buildProvider<IBridgeResponse<void>, void>('nexus.stop'),
};

// Deep link protocol handling / 深度链接协议处理
export const deepLink = {
  /** Emitted when app is opened via aionui:// protocol URL */
  received: bridge.buildEmitter<{
    action: string; // e.g. 'add-provider'
    params: Record<string, string>; // parsed query params
  }>('deep-link.received'),
};

// 窗口控制相关接口 / Window controls API
export const windowControls = {
  minimize: bridge.buildProvider<void, void>('window-controls:minimize'),
  maximize: bridge.buildProvider<void, void>('window-controls:maximize'),
  unmaximize: bridge.buildProvider<void, void>('window-controls:unmaximize'),
  close: bridge.buildProvider<void, void>('window-controls:close'),
  isMaximized: bridge.buildProvider<boolean, void>('window-controls:is-maximized'),
  maximizedChanged: bridge.buildEmitter<{ isMaximized: boolean }>('window-controls:maximized-changed'),
};

// 系统设置接口 / System settings API
export const systemSettings = {
  getCloseToTray: bridge.buildProvider<boolean, void>('system-settings:get-close-to-tray'),
  setCloseToTray: bridge.buildProvider<void, { enabled: boolean }>('system-settings:set-close-to-tray'),
  getShowTokenUsageBadges: bridge.buildProvider<boolean, void>('system-settings:get-show-token-usage-badges'),
  setShowTokenUsageBadges: bridge.buildProvider<void, { enabled: boolean }>('system-settings:set-show-token-usage-badges'),
  showTokenUsageBadgesChanged: bridge.buildEmitter<{ enabled: boolean }>('system-settings:show-token-usage-badges-changed'),
  // Floating desktop avatar window — independent transparent BrowserWindow
  // that reflects active ACP conversation state. See src/process/avatarWindow.ts.
  getAvatarEnabled: bridge.buildProvider<boolean, void>('system-settings:get-avatar-enabled'),
  setAvatarEnabled: bridge.buildProvider<void, { enabled: boolean }>('system-settings:set-avatar-enabled'),
  changeLanguage: bridge.buildProvider<void, { language: string }>('system-settings:change-language'),
  // Broadcast language change to all renderers (desktop + WebUI) for real-time sync
  languageChanged: bridge.buildEmitter<{ language: string }>('system-settings:language-changed'),
  // Default URL for new tabs in the right-panel BrowserPanel
  getBrowserDefaultUrl: bridge.buildProvider<string, void>('system-settings:get-browser-default-url'),
  setBrowserDefaultUrl: bridge.buildProvider<void, { url: string }>('system-settings:set-browser-default-url'),
};

// Right-panel BrowserPanel control API. The panel itself lives in the renderer
// (Electron <webview>); these IPCs let the main process clear its partition
// cache and (later) attach CDP-based agent tooling.
export const browserPanel = {
  clearCache: bridge.buildProvider<IBridgeResponse<void>, void>('browser-panel:clear-cache'),

  // ── Tab registry ────────────────────────────────────────────────────────
  // Renderer reports (tabId ↔ webContentsId) on dom-ready so the main process
  // can target the right webview from agent tool calls.
  registerTab: bridge.buildProvider<IBridgeResponse<void>, { tabId: string; webContentsId: number }>('browser-panel:register-tab'),
  unregisterTab: bridge.buildProvider<IBridgeResponse<void>, { tabId: string }>('browser-panel:unregister-tab'),
  setActiveTab: bridge.buildProvider<IBridgeResponse<void>, { tabId: string }>('browser-panel:set-active-tab'),
  listTabs: bridge.buildProvider<IBridgeResponse<Array<{ webContentsId: number; url: string; title: string; attached: boolean }>>, void>('browser-panel:list-tabs'),

  // ── CDP action API ──────────────────────────────────────────────────────
  // Each call resolves the target webview from `tabId` (renderer tab id) or
  // falls back to the renderer's reported active tab.
  evaluateScript: bridge.buildProvider<IBridgeResponse<{ ok: boolean; value?: unknown; description?: string; errorText?: string; errorDetail?: string }>, { tabId?: string; expression: string; timeoutMs?: number }>('browser-panel:evaluate-script'),
  takeScreenshot: bridge.buildProvider<IBridgeResponse<{ format: 'png' | 'jpeg'; base64: string }>, { tabId?: string; format?: 'png' | 'jpeg'; quality?: number; fullPage?: boolean }>('browser-panel:take-screenshot'),
  navigate: bridge.buildProvider<IBridgeResponse<{ ok: boolean; finalUrl?: string; errorText?: string }>, { tabId?: string; url: string; waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' }>('browser-panel:navigate'),
  getDomSnapshot: bridge.buildProvider<IBridgeResponse<{ snapshot: string | null }>, { tabId?: string; selector?: string; format: 'outerHTML' | 'innerText' }>('browser-panel:get-dom-snapshot'),
  listNetworkRequests: bridge.buildProvider<
    IBridgeResponse<
      Array<{
        requestId: string;
        url: string;
        method?: string;
        type?: string;
        status?: number;
        statusText?: string;
        mimeType?: string;
        startedAt: number;
        durationMs?: number;
        failed?: boolean;
        errorText?: string;
        canceled?: boolean;
      }>
    >,
    { tabId?: string; filter?: { method?: string; urlContains?: string; statusGte?: number; statusLt?: number; type?: string }; limit?: number }
  >('browser-panel:list-network-requests'),
  listConsoleMessages: bridge.buildProvider<
    IBridgeResponse<
      Array<{
        level: 'log' | 'info' | 'warn' | 'error' | 'debug' | 'verbose' | 'other';
        text: string;
        url?: string;
        lineNumber?: number;
        at: number;
        args?: string[];
      }>
    >,
    { tabId?: string; levels?: Array<'log' | 'info' | 'warn' | 'error' | 'debug' | 'verbose' | 'other'>; limit?: number }
  >('browser-panel:list-console-messages'),
  clearBuffers: bridge.buildProvider<IBridgeResponse<void>, { tabId?: string }>('browser-panel:clear-buffers'),
};

// WebUI 服务管理接口 / WebUI service management API
export interface IWebUIStatus {
  running: boolean;
  port: number;
  allowRemote: boolean;
  localUrl: string;
  networkUrl?: string;
  lanIP?: string; // 局域网 IP，用于构建远程访问 URL / LAN IP for building remote access URL
  adminUsername: string;
  initialPassword?: string;
}

export const webui = {
  // 获取 WebUI 状态 / Get WebUI status
  getStatus: bridge.buildProvider<IBridgeResponse<IWebUIStatus>, void>('webui.get-status'),
  // 启动 WebUI / Start WebUI
  start: bridge.buildProvider<IBridgeResponse<{ port: number; localUrl: string; networkUrl?: string; lanIP?: string; initialPassword?: string }>, { port?: number; allowRemote?: boolean }>('webui.start'),
  // 停止 WebUI / Stop WebUI
  stop: bridge.buildProvider<IBridgeResponse, void>('webui.stop'),
  // 修改密码（不需要当前密码）/ Change password (no current password required)
  changePassword: bridge.buildProvider<IBridgeResponse, { newPassword: string }>('webui.change-password'),
  // 重置密码（生成新随机密码）/ Reset password (generate new random password)
  resetPassword: bridge.buildProvider<IBridgeResponse<{ newPassword: string }>, void>('webui.reset-password'),
  // 生成二维码登录 token / Generate QR login token
  generateQRToken: bridge.buildProvider<IBridgeResponse<{ token: string; expiresAt: number; qrUrl: string }>, void>('webui.generate-qr-token'),
  // 验证二维码 token / Verify QR token
  verifyQRToken: bridge.buildProvider<IBridgeResponse<{ sessionToken: string; username: string }>, { qrToken: string }>('webui.verify-qr-token'),
  // 状态变更事件 / Status changed event
  statusChanged: bridge.buildEmitter<{ running: boolean; port?: number; localUrl?: string; networkUrl?: string }>('webui.status-changed'),
  // 密码重置结果事件（绕过 provider 返回值问题）/ Password reset result event (workaround for provider return value issue)
  resetPasswordResult: bridge.buildEmitter<{ success: boolean; newPassword?: string; msg?: string }>('webui.reset-password-result'),
};

// Cron job management API / 定时任务管理接口
export const cron = {
  // Query
  listJobs: bridge.buildProvider<ICronJob[], void>('cron.list-jobs'),
  listJobsByConversation: bridge.buildProvider<ICronJob[], { conversationId: string }>('cron.list-jobs-by-conversation'),
  getJob: bridge.buildProvider<ICronJob | null, { jobId: string }>('cron.get-job'),
  // CRUD
  addJob: bridge.buildProvider<ICronJob, ICreateCronJobParams>('cron.add-job'),
  updateJob: bridge.buildProvider<ICronJob, { jobId: string; updates: Partial<ICronJob> }>('cron.update-job'),
  removeJob: bridge.buildProvider<void, { jobId: string }>('cron.remove-job'),
  triggerJob: bridge.buildProvider<void, { jobId: string }>('cron.trigger-job'),
  // Power management
  getPowerSaveActive: bridge.buildProvider<boolean, void>('cron.get-power-save-active'),
  setPowerSave: bridge.buildProvider<void, { enabled: boolean }>('cron.set-power-save'),
  // Events
  onJobCreated: bridge.buildEmitter<ICronJob>('cron.job-created'),
  onJobUpdated: bridge.buildEmitter<ICronJob>('cron.job-updated'),
  onJobRemoved: bridge.buildEmitter<{ jobId: string }>('cron.job-removed'),
  onJobExecuted: bridge.buildEmitter<{ jobId: string; status: 'ok' | 'error' | 'skipped' | 'missed'; error?: string }>('cron.job-executed'),
};

// Cron job types for IPC
export type ICronSchedule = { kind: 'at'; atMs: number; description: string } | { kind: 'every'; everyMs: number; description: string } | { kind: 'cron'; expr: string; tz?: string; description: string };

export interface ICronJob {
  id: string;
  name: string;
  enabled: boolean;
  schedule: ICronSchedule;
  target: { payload: { kind: 'message'; text: string } };
  metadata: {
    conversationId: string;
    conversationTitle?: string;
    agentType: AcpBackendAll;
    createdBy: 'user' | 'agent';
    createdAt: number;
    updatedAt: number;
    /** Execution mode: 'new' creates a fresh conversation each run (default), 'reuse' appends to the bound conversation */
    conversationMode?: 'new' | 'reuse';
    /** Working directory to use for execution */
    workspace?: string;
    /** Preset assistant ID (e.g. 'builtin-doctor') — rules/skills re-resolved at execution time.
     *  In Partial<ICronJob> updates, pass `null` to explicitly clear (since JSON IPC strips `undefined`). */
    presetAssistantId?: string | null;
  };
  state: {
    nextRunAtMs?: number;
    lastRunAtMs?: number;
    lastStatus?: 'ok' | 'error' | 'skipped' | 'missed';
    lastError?: string;
    runCount: number;
    retryCount: number;
    maxRetries: number;
    /** ID of the most recently created execution conversation (only used when conversationMode === 'new') */
    lastConversationId?: string;
  };
}

export interface ICreateCronJobParams {
  name: string;
  schedule: ICronSchedule;
  message: string;
  conversationId: string;
  conversationTitle?: string;
  agentType: AcpBackendAll;
  createdBy: 'user' | 'agent';
  conversationMode?: 'new' | 'reuse';
  workspace?: string;
  presetAssistantId?: string | null;
}

export interface ISendMessageParams {
  input: string;
  msg_id: string;
  conversation_id: string;
  files?: string[];
  loading_id?: string;
  /** Skill names to activate for this message (used by agents with skill execution ability) */
  skills?: string[];
}

// Unified confirm message params for all agents
export interface IConfirmMessageParams {
  confirmKey: string;
  msg_id: string;
  conversation_id: string;
  callId: string;
}

export interface ICreateConversationParams {
  type: 'acp' | 'remote-agent';
  id?: string;
  name?: string;
  model: TProviderWithModel;
  extra: {
    workspace?: string;
    customWorkspace?: boolean;
    defaultFiles?: string[];
    backend?: AcpBackendAll;
    cliPath?: string;
    webSearchEngine?: 'google' | 'default';
    agentName?: string;
    customAgentId?: string;
    context?: string;
    contextFileName?: string; // For preset agents
    // System rules for smart assistants
    presetRules?: string; // system rules injected at initialization
    /** Enabled skills list for filtering SkillManager skills */
    enabledSkills?: string[];
    /**
     * Preset context/rules to inject into the first message.
     * Used by smart assistants to provide custom prompts/rules.
     * Injected via contextContent or <system_instruction> tag in first message
     */
    presetContext?: string;
    /** 预设助手 ID，用于在会话面板显示助手名称和头像 / Preset assistant ID for displaying name and avatar in conversation panel */
    presetAssistantId?: string;
    /** Initial session mode selected on Guid page (from AgentModeSelector) */
    sessionMode?: string;
    /** Session mode (remote/local) for enterprise mode Provider selection - distinct from sessionMode (yolo/auto) */
    sessionModeParam?: 'remote' | 'local';
    /** Pre-selected ACP model from Guid page (cached model list) */
    currentModelId?: string;
    /** Runtime validation snapshot used for post-switch strong checks */
    runtimeValidation?: {
      expectedWorkspace?: string;
      expectedBackend?: string;
      expectedAgentName?: string;
      expectedCliPath?: string;
      expectedModel?: string;
      expectedIdentityHash?: string | null;
      switchedAt?: number;
    };
    /** Explicit marker for temporary health-check conversations */
    isHealthCheck?: boolean;
    /** Cron job ID that created this conversation (for "new conversation per run" mode) */
    cronJobId?: string;
    /** Cron job name that created this conversation */
    cronJobName?: string;
    /** Cron job ID this conversation is pre-bound to (reuse mode, user-selected existing conversation) */
    cronJobBoundId?: string;
    /** Cron job name this conversation is pre-bound to */
    cronJobBoundName?: string;
    // ========== Remote-agent (Moss Server) specific fields ==========
    /** Moss Server URL (e.g. http://127.0.0.1:43127) */
    mossServerUrl?: string;
    /** Auth token for Moss Server (API Key or JWT access_token) */
    authToken?: string;
    /** Username for password login (when authToken is empty) */
    username?: string;
    /** Password for password login (when authToken is empty) */
    password?: string;
    /** Runtime type for Moss Server */
    runtimeType?: 'host' | 'docker';
    /** Enterprise code */
    enterpriseCode?: string;
    /** Organization ID */
    orgId?: string;
    /** User ID */
    userId?: string;
    /** Skip permission confirmation */
    dangerouslySkipPermissions?: boolean;
    /** WebSocket URL from Moss Server session (for reconnecting) */
    acpWsUrl?: string;
  };
}
interface IResetConversationParams {
  id?: string;
  gemini?: {
    clearCachedCredentialFile?: boolean;
  };
}

// 获取文件夹或文件列表
export interface IDirOrFile {
  name: string;
  fullPath: string;
  relativePath: string;
  isDir: boolean;
  isFile: boolean;
  children?: Array<IDirOrFile>;
}

// 文件元数据接口
export interface IFileMetadata {
  name: string;
  path: string;
  size: number;
  type: string;
  lastModified: number;
  isDirectory?: boolean;
}

export interface IResponseMessage {
  type: string;
  data: unknown;
  msg_id: string;
  conversation_id: string;
}

export interface IBridgeResponse<D = {}> {
  success: boolean;
  data?: D;
  msg?: string;
}

// ==================== Extensions API ====================

export interface IExtensionInfo {
  name: string;
  displayName: string;
  version: string;
  description?: string;
  source: string;
  directory: string;
  /** Whether the extension is currently enabled */
  enabled: boolean;
  /** Overall permission risk level */
  riskLevel: 'safe' | 'moderate' | 'dangerous';
  /** Whether the extension has lifecycle hooks */
  hasLifecycle: boolean;
}

/** Permission summary for extension management UI (Figma-inspired) */
export interface IExtensionPermissionSummary {
  name: string;
  description: string;
  level: 'safe' | 'moderate' | 'dangerous';
  granted: boolean;
}

/** Settings tab contributed by an extension, consumed by settings UI */
export interface IExtensionSettingsTab {
  id: string;
  name: string;
  icon?: string;
  /** aion-asset:// local page or external https:// URL */
  entryUrl: string;
  /** Position anchor relative to a built-in or other extension tab */
  position?: { anchor: string; placement: 'before' | 'after' };
  /** Fallback numeric order when multiple tabs share the same anchor+placement. Lower = first */
  order: number;
  _extensionName: string;
}

/** WebUI contributions exposed for diagnostics/e2e validation */
export interface IExtensionWebuiContribution {
  extensionName: string;
  apiRoutes: Array<{ path: string; auth: boolean }>;
  staticAssets: Array<{ urlPrefix: string; directory: string }>;
}

export type AgentActivityState = 'idle' | 'writing' | 'researching' | 'executing' | 'syncing' | 'error';

export interface IExtensionAgentActivityEvent {
  conversationId: string;
  at: number;
  kind: 'status' | 'tool' | 'message';
  text: string;
}

export interface IExtensionAgentActivityItem {
  id: string;
  backend: string;
  agentName: string;
  state: AgentActivityState;
  runtimeStatus: 'pending' | 'running' | 'finished' | 'unknown';
  conversations: number;
  activeConversations: number;
  lastActiveAt: number;
  lastStatus?: string;
  currentTask?: string;
  recentEvents: IExtensionAgentActivityEvent[];
}

export interface IExtensionAgentActivitySnapshot {
  generatedAt: number;
  totalConversations: number;
  runningConversations: number;
  agents: IExtensionAgentActivityItem[];
}

export const extensions = {
  /** Get all extension-contributed CSS themes */
  getThemes: bridge.buildProvider<ICssTheme[], void>('extensions.get-themes'),
  /** Get summary of all loaded extensions */
  getLoadedExtensions: bridge.buildProvider<IExtensionInfo[], void>('extensions.get-loaded-extensions'),
  /** Get all extension-contributed assistants */
  getAssistants: bridge.buildProvider<Record<string, unknown>[], void>('extensions.get-assistants'),
  /** Get all extension-contributed agents (autonomous agent presets) */
  getAgents: bridge.buildProvider<Record<string, unknown>[], void>('extensions.get-agents'),
  /** Get all extension-contributed ACP adapters */
  getAcpAdapters: bridge.buildProvider<Record<string, unknown>[], void>('extensions.get-acp-adapters'),
  /** Get all extension-contributed MCP servers */
  getMcpServers: bridge.buildProvider<Record<string, unknown>[], void>('extensions.get-mcp-servers'),
  /** Get all extension-contributed skills */
  getSkills: bridge.buildProvider<Array<{ name: string; description: string; location: string }>, void>('extensions.get-skills'),
  /** Get all extension-contributed settings tabs */
  getSettingsTabs: bridge.buildProvider<IExtensionSettingsTab[], void>('extensions.get-settings-tabs'),
  /** Get extension-contributed webui routes/assets metadata */
  getWebuiContributions: bridge.buildProvider<IExtensionWebuiContribution[], void>('extensions.get-webui-contributions'),
  /** Snapshot of all agent activities, for extension settings tabs */
  getAgentActivitySnapshot: bridge.buildProvider<IExtensionAgentActivitySnapshot, void>('extensions.get-agent-activity-snapshot'),
  /** Get merged extension i18n translations for a specific locale (falls back to en-US) */
  getExtI18nForLocale: bridge.buildProvider<Record<string, unknown>, { locale: string }>('extensions.get-ext-i18n-for-locale'),

  // --- Extension Management API (NocoBase-inspired) ---
  /** Enable a disabled extension */
  enableExtension: bridge.buildProvider<IBridgeResponse, { name: string }>('extensions.enable'),
  /** Disable an extension */
  disableExtension: bridge.buildProvider<IBridgeResponse, { name: string; reason?: string }>('extensions.disable'),
  /** Get permission summary for an extension (Figma-inspired) */
  getPermissions: bridge.buildProvider<IExtensionPermissionSummary[], { name: string }>('extensions.get-permissions'),
  /** Get overall risk level for an extension */
  getRiskLevel: bridge.buildProvider<string, { name: string }>('extensions.get-risk-level'),
  /** Extension state change events (push to renderer when enable/disable happens) */
  stateChanged: bridge.buildEmitter<{ name: string; enabled: boolean; reason?: string }>('extensions.state-changed'),
};

// ==================== Skill Hub API ====================

export interface ISkillHubSkill {
  id: string;
  name: string;
  display_name: string;
  description: string;
  category: string;
  categories: string[];
  emoji: string | null;
  icon: string;
  star_count: number;
  homepage: string | null;
  author_id: string;
  applicable_scenarios: string | null;
  core_features: string | null;
  created_at: string;
  updated_at: string;
  /** Enterprise mode: visibility configuration */
  visible_to?: { department_ids: string[] | null } | null;
  /** Enterprise mode: download URL */
  source_url?: string | null;
  /** Enterprise mode: checksum for verification */
  checksum?: string | null;
  /** Enterprise mode: version */
  version?: string;
}

export interface ISkillHubVersion {
  id: string;
  version: string;
  source_url: string;
  changelog: string | null;
  checksum: string;
  readme_content: string | null;
  created_at: string;
  skill_id: string;
}

export interface ISkillInstallResult {
  skillName: string;
  installedVersion: string;
}

export interface ISkillDownloadResult {
  filePath: string;
}

export interface ISkillHubDetail {
  skill: ISkillHubSkill;
  versions: ISkillHubVersion[];
}

export interface ISkillHubListResponse {
  skills: ISkillHubSkill[];
  next_cursor: string | null;
  has_more: boolean;
}

/**
 * Metadata saved to `_sudowork_meta.json` inside an installed skill directory.
 * Prefixed with `_sudowork_` to avoid conflicts with skill content files.
 */
export interface ISkillHubMeta {
  id: string;
  name: string;
  display_name: string;
  description: string;
  icon: string;
  emoji: string | null;
  category: string;
  categories: string[];
  applicable_scenarios: string | null;
  core_features: string | null;
  homepage: string | null;
  author_id: string;
  source_type?: 'hub' | 'upload' | 'custom' | 'tenant';
  is_builtin?: boolean;
  enabled?: boolean;
  installed_version: string;
  installed_at: string;
  /** Visibility configuration for enterprise skills (department_ids filter) */
  visible_to?: { department_ids: string[] | null } | null;
  /** Whether this skill has been uploaded to Moss Server */
  uploaded?: boolean;
  /** Timestamp when uploaded to Moss Server */
  uploaded_at?: string;
  /** Publish status for tenant-exclusive skills */
  publish_status?: 'pending' | 'approved' | 'rejected';
  /** Timestamp when published as tenant-exclusive */
  published_at?: string;
}

/** Info returned for each locally installed skill */
export interface IInstalledSkillInfo {
  /** Directory name (skill identifier) */
  name: string;
  version: string;
  /** Whether this skill was installed from the Skill Hub */
  isHubInstalled: boolean;
  /** Whether this is a built-in skill that cannot be uninstalled */
  isBuiltin: boolean;
  /** Whether this skill comes from the auto-injected _system/_builtin directory */
  isAutoInjectedBuiltin?: boolean;
  /** Whether this skill is currently enabled at runtime */
  enabled: boolean;
  /** Category of the skill (custom, hub, system, tenant) */
  category?: 'custom' | 'hub' | 'system' | 'tenant';
  /** Rich metadata from _sudowork_meta.json (hub-installed only) */
  meta?: ISkillHubMeta;
}

export const skillHub = {
  /** Fetch skills list from Skill Hub API with cursor-based pagination */
  fetchSkills: bridge.buildProvider<IBridgeResponse<ISkillHubListResponse>, { cursor?: string; limit?: number; query?: string; category?: string; tenantId?: string }>('skill-hub.fetch-skills'),
  /** Emitted when installed skills change outside renderer-initiated actions */
  changed: bridge.buildEmitter<{ skillName?: string; source?: 'workspace' | 'hub' | 'import' | 'toggle' | 'uninstall' }>('skill-hub.changed'),
  /** Fetch skill categories from Skill Hub API */
  fetchCategories: bridge.buildProvider<IBridgeResponse<string[]>, void>('skill-hub.fetch-categories'),
  /** Fetch skill detail from Skill Hub API */
  fetchSkillDetail: bridge.buildProvider<IBridgeResponse<ISkillHubDetail>, { skillId: string }>('skill-hub.fetch-skill-detail'),
  /** Download and install skill from URL, saving full metadata */
  downloadAndInstallSkill: bridge.buildProvider<IBridgeResponse<ISkillInstallResult>, { skillName: string; displayName: string; sourceUrl: string; version: string; checksum: string; skillMeta?: ISkillHubSkill }>('skill-hub.download-and-install-skill'),
  /** Download skill zip to local Downloads folder */
  downloadSkillZip: bridge.buildProvider<IBridgeResponse<ISkillDownloadResult>, { skillName: string; version: string; sourceUrl: string; checksum?: string }>('skill-hub.download-skill-zip'),
  /** Import a local skill zip package or directory and synthesize metadata from SKILL.md */
  importLocalSkill: bridge.buildProvider<IBridgeResponse<ISkillInstallResult>, { sourcePath: string }>('skill-hub.import-local-skill'),
  /** Get installed skills with rich metadata */
  getInstalledSkills: bridge.buildProvider<IBridgeResponse<IInstalledSkillInfo[]>, void>('skill-hub.get-installed-skills'),
  /** Enable or disable a custom installed skill. Optionally specify category to disambiguate skills with same name in different directories. */
  setSkillEnabled: bridge.buildProvider<IBridgeResponse<void>, { skillName: string; enabled: boolean; category?: 'custom' | 'hub' | 'system' | 'tenant' }>('skill-hub.set-skill-enabled'),
  /** Uninstall a hub-installed skill by directory name (builtin skills are rejected). Optionally specify category to disambiguate skills with same name in different directories. */
  uninstallSkill: bridge.buildProvider<IBridgeResponse<void>, { skillName: string; category?: 'custom' | 'hub' | 'system' | 'tenant' }>('skill-hub.uninstall-skill'),
  /** Get security audit report for a skill */
  getSkillAuditReport: bridge.buildProvider<IBridgeResponse<import('@/common/skillAuditTypes').SkillAuditReport>, { skillName: string }>('skill-hub.get-skill-audit-report'),
  /** Run security audit for a skill (re-scan) */
  runSkillAudit: bridge.buildProvider<IBridgeResponse<import('@/common/skillAuditTypes').SkillAuditReport>, { skillName: string }>('skill-hub.run-skill-audit'),
};

// ==================== Assistant Hub API ====================

import type { IAssistantMeta } from '@/process/constants/assistantStorage';
import type { IAssistantInfo } from '@/process/AssistantManager';

/** Assistant from Hub API (mirrors ISkillHubSkill pattern) */
export interface IAssistantHubSkill {
  id: string;
  name: string;
  display_name: string;
  description: string;
  avatar: string | null;
  emoji: string | null;
  category: string;
  categories: string[];
  preset_agent_type: string | null;
  /** Associated skill IDs (skills guaranteed to exist in Skill Hub) */
  skills: string[];
  /** Source tag: 'hub' (store), 'custom' (user-created), 'system' (builtin) */
  tag: 'hub' | 'custom' | 'system';
  homepage: string | null;
  author_id: string;
  star_count: number;
  applicable_scenarios: string | null;
  core_features: string | null;
  created_at: string;
  updated_at: string;
  /** Default initial prompt to pre-fill input when selecting this assistant */
  defaultInitPrompt?: string | null;
  /** Internal: download URL from API (mapped from sourceUrl) */
  _sourceUrl?: string;
  /** Enterprise mode: visibility configuration */
  visible_to?: { department_ids: string[] | null } | null;
  /** Enterprise mode: version */
  version?: string;
}

export interface IAssistantHubVersion {
  id: string;
  version: string;
  source_url: string;
  checksum: string;
  changelog: string | null;
  readme_content: string | null;
  created_at: string;
  assistant_id: string;
}

export interface IAssistantHubDetail {
  assistant: IAssistantHubSkill;
  versions: IAssistantHubVersion[];
}

export interface IAssistantHubListResponse {
  assistants: IAssistantHubSkill[];
  next_cursor: string | null;
  has_more: boolean;
}

export interface IAssistantInstallResult {
  assistantName: string;
  installedVersion: string;
  /** Skills installed alongside the assistant (skill names) */
  installedSkills?: string[];
  /** Skills that failed to install (skill names or IDs) */
  failedSkills?: string[];
}

export const assistantHub = {
  /** Get all installed assistants (enabled + disabled) with full metadata */
  getInstalledAssistants: bridge.buildProvider<IBridgeResponse<IAssistantInfo[]>, void>('assistant-hub.get-installed-assistants'),
  /** Enable an assistant (set meta.enabled = true). Optionally specify category to disambiguate assistants with same name in different directories. */
  enableAssistant: bridge.buildProvider<IBridgeResponse<void>, { name: string; category?: 'custom' | 'hub' | 'system' | 'tenant' }>('assistant-hub.enable-assistant'),
  /** Disable an assistant (set meta.enabled = false). Optionally specify category to disambiguate assistants with same name in different directories. */
  disableAssistant: bridge.buildProvider<IBridgeResponse<void>, { name: string; category?: 'custom' | 'hub' | 'system' | 'tenant' }>('assistant-hub.disable-assistant'),
  /** Merge partial updates into an assistant's _sudowork_meta.json */
  updateAssistantMeta: bridge.buildProvider<IBridgeResponse<void>, { name: string; updates: Partial<IAssistantMeta>; category?: 'custom' | 'hub' | 'system' | 'tenant' }>('assistant-hub.update-assistant-meta'),
  /** Read _sudowork_meta.json for a specific assistant */
  getAssistantMeta: bridge.buildProvider<IBridgeResponse<IAssistantMeta | null>, { name: string }>('assistant-hub.get-assistant-meta'),
  /** Create a new custom assistant with metadata and optional rule content */
  createAssistant: bridge.buildProvider<IBridgeResponse<void>, { meta: IAssistantMeta; ruleContent?: string }>('assistant-hub.create-assistant'),
  /** Uninstall an assistant (delete directory; blocks builtins). Optionally specify category to disambiguate assistants with same name in different directories. */
  uninstallAssistant: bridge.buildProvider<IBridgeResponse<void>, { name: string; category?: 'custom' | 'hub' | 'system' | 'tenant' }>('assistant-hub.uninstall-assistant'),

  // === Hub API methods (parallel to skillHub) ===
  /** Fetch assistants list from Assistant Hub API with cursor-based pagination */
  fetchAssistants: bridge.buildProvider<IBridgeResponse<IAssistantHubListResponse>, { cursor?: string; limit?: number; query?: string; category?: string; tenantId?: string; sourceType?: 'hub' | 'tenant' }>('assistant-hub.fetch-assistants'),
  /** Fetch assistant categories from Assistant Hub API (type=1 for assistants) */
  fetchCategories: bridge.buildProvider<IBridgeResponse<string[]>, void>('assistant-hub.fetch-categories'),
  /** Fetch assistant detail from Assistant Hub API */
  fetchAssistantDetail: bridge.buildProvider<IBridgeResponse<IAssistantHubDetail>, { assistantId: string }>('assistant-hub.fetch-assistant-detail'),
  /** Fetch skill details by IDs from Skill Hub API (for installation preview) */
  fetchSkillDetailsByIds: bridge.buildProvider<IBridgeResponse<ISkillHubSkill[]>, { skillIds: string[] }>('assistant-hub.fetch-skill-details-by-ids'),
  /** Download and install assistant from Hub, optionally installing selected associated skills */
  downloadAndInstallAssistant: bridge.buildProvider<IBridgeResponse<IAssistantInstallResult>, { assistantName: string; displayName: string; sourceUrl: string; version: string; checksum: string; assistantMeta: IAssistantHubSkill; selectedSkillIds?: string[] }>('assistant-hub.download-and-install-assistant'),
  /** Upload custom assistant to Hub (create zip and POST to /api/assistants) */
  uploadAssistantToHub: bridge.buildProvider<IBridgeResponse<{ success: boolean; message?: string }>, { name: string; displayName: string; profession: string; description?: string; categories?: string[]; skills?: string[]; tenantId: string }>('assistant-hub.upload-assistant-to-hub'),
};

// ==================== Channel API ====================

import type { IChannelPairingRequest, IChannelPluginStatus, IChannelSession, IChannelUser, IPluginCredentials } from '@/channels/types';

export const channel = {
  // Plugin Management
  getPluginStatus: bridge.buildProvider<IBridgeResponse<IChannelPluginStatus[]>, void>('channel.get-plugin-status'),
  getPluginCredentials: bridge.buildProvider<IBridgeResponse<IPluginCredentials | null>, { pluginId: string }>('channel.get-plugin-credentials'),
  enablePlugin: bridge.buildProvider<IBridgeResponse, { pluginId: string; config: Record<string, unknown> }>('channel.enable-plugin'),
  disablePlugin: bridge.buildProvider<IBridgeResponse, { pluginId: string }>('channel.disable-plugin'),
  testPlugin: bridge.buildProvider<IBridgeResponse<{ success: boolean; botUsername?: string; error?: string }>, { pluginId: string; token: string; extraConfig?: { appId?: string; appSecret?: string } }>('channel.test-plugin'),

  // Pairing Management
  getPendingPairings: bridge.buildProvider<IBridgeResponse<IChannelPairingRequest[]>, void>('channel.get-pending-pairings'),
  approvePairing: bridge.buildProvider<IBridgeResponse, { code: string }>('channel.approve-pairing'),
  rejectPairing: bridge.buildProvider<IBridgeResponse, { code: string }>('channel.reject-pairing'),

  // User Management
  getAuthorizedUsers: bridge.buildProvider<IBridgeResponse<IChannelUser[]>, void>('channel.get-authorized-users'),
  revokeUser: bridge.buildProvider<IBridgeResponse, { userId: string }>('channel.revoke-user'),

  // Session Management (MVP: read-only view)
  getActiveSessions: bridge.buildProvider<IBridgeResponse<IChannelSession[]>, void>('channel.get-active-sessions'),

  // Settings Sync
  syncChannelSettings: bridge.buildProvider<IBridgeResponse, { platform: string; agent: { backend: string; customAgentId?: string; name?: string }; model?: { id: string; useModel: string } }>('channel.sync-channel-settings'),

  // Events
  pairingRequested: bridge.buildEmitter<IChannelPairingRequest>('channel.pairing-requested'),
  pluginStatusChanged: bridge.buildEmitter<{ pluginId: string; status: IChannelPluginStatus }>('channel.plugin-status-changed'),
  userAuthorized: bridge.buildEmitter<IChannelUser>('channel.user-authorized'),

  // WeChat QR Login
  wechatStartQrLogin: bridge.buildProvider<IBridgeResponse<void>, void>('channel.wechat-start-qr-login'),
  wechatCancelQrLogin: bridge.buildProvider<IBridgeResponse<void>, void>('channel.wechat-cancel-qr-login'),
  wechatQrLogin: bridge.buildEmitter<{
    phase: 'qrcode' | 'scanned' | 'confirmed' | 'error' | 'timeout';
    qrUrl?: string;
    botToken?: string;
    accountId?: string;
    message?: string;
  }>('channel.wechat-qr-login'),
};

export interface ISudoworkServerConfig {
  baseUrl: string;
  enterpriseCode?: string;
}

export const sudoworkServer = {
  getConfig: bridge.buildProvider<ISudoworkServerConfig, void>('sudowork-server.get-config'),
  updateConfig: bridge.buildProvider<void, Partial<ISudoworkServerConfig>>('sudowork-server.update-config'),
};

// ==================== Safety Hook API ====================

import type { SafetyStatus, BlacklistConfig } from '@/common/safetyTypes';

// ==================== Tools API ====================

export const tools = {
  /** Generate image via /v1/images/generations API */
  generateImage: bridge.buildProvider<IBridgeResponse<{ img_url: string; relative_path: string }>, { prompt: string; conversation_id: string; workspace: string; size?: string; n?: number }>('tools.generate-image'),
  /** Generate a user-center avatar image; saves to userData and returns local path + dataUrl */
  generateUserAvatar: bridge.buildProvider<IBridgeResponse<{ localPath: string; dataUrl: string }>, { prompt: string }>('tools.generate-user-avatar'),
};

export const safety = {
  /** Get current safety status */
  getStatus: bridge.buildProvider<IBridgeResponse<SafetyStatus>, void>('safety.get-status'),
  /** Get service enabled status */
  getEnabled: bridge.buildProvider<IBridgeResponse<{ enabled: boolean }>, void>('safety.get-enabled'),
  /** User confirmation action (allow/deny) */
  confirm: bridge.buildProvider<IBridgeResponse, { allow: boolean; reason?: string }>('safety.confirm'),
  /** Enable/disable safety hook service */
  setEnabled: bridge.buildProvider<IBridgeResponse, { enabled: boolean }>('safety.set-enabled'),
  /** Safety status change event (Main -> Renderer) */
  onStatusChange: bridge.buildEmitter<SafetyStatus>('safety.status-change'),
  /** Get blacklist configuration */
  getBlacklist: bridge.buildProvider<IBridgeResponse<BlacklistConfig>, void>('safety.get-blacklist'),
  /** Set blacklist configuration */
  setBlacklist: bridge.buildProvider<IBridgeResponse, { config: BlacklistConfig }>('safety.set-blacklist'),
};

// ==================== Health Monitor API ====================

export const healthMonitor = {
  /** Get health monitor status */
  getStatus: bridge.buildProvider<IBridgeResponse<{ enabled: boolean }>, void>('health-monitor.get-status'),
  /** Enable health monitor */
  enable: bridge.buildProvider<IBridgeResponse, void>('health-monitor.enable'),
  /** Disable health monitor */
  disable: bridge.buildProvider<IBridgeResponse, void>('health-monitor.disable'),
};

// ==================== Workspace Management API ====================
// 工作空间管理 API（重命名、草稿箱操作）

export const workspaceManage = {
  /** Rename workspace directory (physical rename + DB update) / 重命名工作空间目录 */
  renameDirectory: bridge.buildProvider<IBridgeResponse<{ newPath: string }>, { oldPath: string; newName: string }>('workspace-manage.rename-directory'),
  /** List drafts files / 列出草稿箱文件 */
  listDrafts: bridge.buildProvider<IBridgeResponse<Array<{ name: string; size: number; modifiedAt: number }>>, { workspace: string }>('workspace-manage.list-drafts'),
  /** Clear all drafts / 清空草稿箱 */
  clearDrafts: bridge.buildProvider<IBridgeResponse, { workspace: string }>('workspace-manage.clear-drafts'),
  /** Delete a specific draft file / 删除指定草稿文件 */
  deleteDraft: bridge.buildProvider<IBridgeResponse, { workspace: string; fileName: string }>('workspace-manage.delete-draft'),
  /** Update workspace display name (no physical rename) / 更新工作空间显示名（不改物理路径） */
  updateDisplayName: bridge.buildProvider<IBridgeResponse, { workspace: string; displayName: string }>('workspace-manage.update-display-name'),
};

// ==================== User Phone Storage API ====================
// Store user phone (RSA encrypted) for skill access
// Skill reads encrypted content and sends to server for decryption

export const sudoworkAuth = {
  /** Save user phone to config file (RSA encrypted with public key) */
  saveUserPhone: bridge.buildProvider<IBridgeResponse, { phone: string }>('sudowork-auth.save-user-phone'),
  /** Get stored user phone (encrypted) from config file */
  getUserPhone: bridge.buildProvider<IBridgeResponse<string | null>, void>('sudowork-auth.get-user-phone'),
  /** Clear stored user phone on logout */
  clearUserPhone: bridge.buildProvider<IBridgeResponse, void>('sudowork-auth.clear-user-phone'),
  /** Get public key for encryption */
  getPublicKey: bridge.buildProvider<IBridgeResponse<string>, void>('sudowork-auth.get-public-key'),
  /** Save user nickname - triggers USER.md update for AI addressing */
  saveUserNickname: bridge.buildProvider<IBridgeResponse, { nickname: string }>('sudowork-auth.save-user-nickname'),
  /** Get stored user nickname */
  getUserNickname: bridge.buildProvider<IBridgeResponse<string | null>, void>('sudowork-auth.get-user-nickname'),
  /** Save consumer mode user ID for telemetry */
  saveConsumerUserId: bridge.buildProvider<IBridgeResponse, { userId: string }>('sudowork-auth.save-consumer-user-id'),
  /** Get stored consumer mode user ID */
  getConsumerUserId: bridge.buildProvider<IBridgeResponse<string | null>, void>('sudowork-auth.get-consumer-user-id'),
  /** Clear stored consumer mode user ID on logout */
  clearConsumerUserId: bridge.buildProvider<IBridgeResponse, void>('sudowork-auth.clear-consumer-user-id'),
};

// ==================== Secret Management API ====================
// Manage service secrets stored in Nexus secret store

export interface ISecretMetadata {
  id: string;
  namespace: string;
  key: string;
  description?: string;
  enabled: boolean;
  currentVersion: number;
  deletedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export const secret = {
  /** Get a secret value by namespace and key */
  get: bridge.buildProvider<IBridgeResponse<string | null>, { namespace: string; key: string }>('secret.get'),
  /** Put (create or update) a secret value */
  put: bridge.buildProvider<IBridgeResponse, { namespace: string; key: string; value: string; description?: string }>('secret.put'),
  /** List all secrets in a namespace */
  list: bridge.buildProvider<IBridgeResponse<ISecretMetadata[]>, { namespace: string }>('secret.list'),
  /** Soft-delete a secret */
  delete: bridge.buildProvider<IBridgeResponse<boolean>, { namespace: string; key: string }>('secret.delete'),
  /** Restore a soft-deleted secret */
  restore: bridge.buildProvider<IBridgeResponse<boolean>, { namespace: string; key: string }>('secret.restore'),
};

/**
 * pwd_login: agent-level auto-login using credentials stored in nexus
 * PasswordVaultService. Plaintext never enters the renderer or the agent
 * LLM context — fetch happens in main process, bytes flow to the browser
 * subprocess as base64 over sidechannel, then Buffer is zeroed.
 *
 * Phase 1: user-initiated via /login <title> slash command.
 * Phase 2: agent-initiated (tool registration TBD).
 */
export interface IPwdLoginParams {
  /** Vault entry title (matches nexus PasswordVaultService primary key) */
  title: string;
  /**
   * Approval decision chosen by the user in the dialog. If missing, the
   * backend checks ApprovalStore for a cached allow_always; otherwise
   * returns {ok: false, error: approval_rejected} and expects the renderer
   * to open the approval modal first.
   */
  optionId?: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';
  /** Conversation context for logging / audit only; no permission scoping */
  conversation_id?: string;
  /**
   * Optional URL override. If absent, the adapter's canonical loginUrl is used.
   */
  url?: string;
}

export interface IPwdLoginResult {
  ok: boolean;
  /** CDP target id returned by ai-dev-browser after successful fill (Phase 1: absent — sidechannel dispatch blocked on browser-ai) */
  tab_id?: string;
  /** Structured error code (string from PwdLoginErrorCode enum) when ok=false */
  error?: string;
  /** Non-sensitive diagnostic detail — MUST NOT contain password bytes or derivatives */
  detail?: string;
}

export const pwdLogin = {
  /** Kick off pwd_login flow. Renderer calls with optionId after the approval modal resolves. */
  start: bridge.buildProvider<IPwdLoginResult, IPwdLoginParams>('pwd.login.start'),
};

// ==================== Telemetry API ====================
// Telemetry data collection and reporting
// 遥测数据收集和上报

export interface ITelemetryStatus {
  enabled: boolean;
  queueSize: number;
  isFlushing: boolean;
}

export interface ITelemetryPerfData {
  metric: 'cold_start' | 'first_screen' | 'first_token';
  value_ms: number;
  session_id?: string;
}

export interface ITelemetryConversationStartData {
  session_id: string;
  model_id: string;
  model_provider?: string;
}

export interface ITelemetryConversationEndData {
  session_id: string;
  status: 'success' | 'error' | 'user_cancel';
  error_code?: string; // 错误码如 E001-E010
  tokens_used?: number;
  input_tokens?: number;
  output_tokens?: number;
}

export interface ITelemetryTokenUpdateData {
  session_id: string;
  tokens_used?: number;
  input_tokens?: number;
  output_tokens?: number;
}

export const telemetry = {
  /** Get telemetry status */
  getStatus: bridge.buildProvider<IBridgeResponse<ITelemetryStatus>, void>('telemetry.get-status'),
  /** Enable/disable telemetry */
  setEnabled: bridge.buildProvider<IBridgeResponse, { enabled: boolean }>('telemetry.set-enabled'),
  /** Check if opt-in dialog has been shown */
  getOptInShown: bridge.buildProvider<IBridgeResponse<boolean>, void>('telemetry.get-opt-in-shown'),
  /** Mark opt-in dialog as shown */
  setOptInShown: bridge.buildProvider<IBridgeResponse, void>('telemetry.set-opt-in-shown'),
  /** Mark renderer ready (first screen time) */
  markRendererReady: bridge.buildProvider<IBridgeResponse, void>('telemetry.mark-renderer-ready'),
  /** Record first token time */
  recordFirstToken: bridge.buildProvider<IBridgeResponse, { session_id: string; duration_ms?: number }>('telemetry.record-first-token'),
  /** Start conversation tracking */
  startConversation: bridge.buildProvider<IBridgeResponse, ITelemetryConversationStartData>('telemetry.start-conversation'),
  /** Update conversation tokens */
  updateConversationTokens: bridge.buildProvider<IBridgeResponse, ITelemetryTokenUpdateData>('telemetry.update-conversation-tokens'),
  /** End conversation tracking */
  endConversation: bridge.buildProvider<IBridgeResponse, ITelemetryConversationEndData>('telemetry.end-conversation'),
  /** Flush all pending telemetry events */
  flush: bridge.buildProvider<IBridgeResponse, void>('telemetry.flush'),
};

// ==================== Auth Proxy API ====================
// Manage Auth Proxy server lifecycle, rules cache, and status

import type { AuthProxyRule } from '@/common/types/authProxy';

export const authProxy = {
  /** Get all cached Config Items rules */
  getRules: bridge.buildProvider<IBridgeResponse<AuthProxyRule[]>, void>('authProxy.getRules'),
  /** Refresh Config Items rules from sudowork-server */
  refreshRules: bridge.buildProvider<IBridgeResponse<void>, { accessToken: string; enabledConfigItemIds: number[] }>('authProxy.refreshRules'),
  /** Get Auth Proxy server running status and port */
  getStatus: bridge.buildProvider<IBridgeResponse<{ running: boolean; port: number | null }>, void>('authProxy.getStatus'),
  /** Emitted when enabled state changes via Auth Proxy secrets API */
  enabledStateChanged: bridge.buildEmitter<void>('authProxy.enabledStateChanged'),
};

// ==================== Crash API ====================
// Crash/Exception reporting for sudowork-qms CrashReporter
// Crash/异常上报 (替代 Sentry SDK)

export interface ICrashExceptionData {
  error_name: string;
  error_message: string;
  stack_trace?: string;
  context?: Record<string, unknown>;
}

export interface ICrashBreadcrumbData {
  category: string;
  message: string;
  data?: Record<string, unknown>;
  level?: 'debug' | 'info' | 'warning' | 'error';
}

export interface ICrashReporterStatus {
  enabled: boolean;
  queueSize: number;
  breadcrumbCount: number;
  isFlushing: boolean;
}

export const crash = {
  /** Report JS exception from renderer */
  reportException: bridge.buildProvider<IBridgeResponse, ICrashExceptionData>('crash.report-exception'),
  /** Add breadcrumb from renderer */
  addBreadcrumb: bridge.buildProvider<IBridgeResponse, ICrashBreadcrumbData>('crash.add-breadcrumb'),
  /** Get crash reporter status */
  getStatus: bridge.buildProvider<IBridgeResponse<ICrashReporterStatus>, void>('crash.get-status'),
  /** Clear breadcrumbs */
  clearBreadcrumbs: bridge.buildProvider<IBridgeResponse, void>('crash.clear-breadcrumbs'),
  /** Flush all pending crash events */
  flush: bridge.buildProvider<IBridgeResponse, void>('crash.flush'),
};

// --- Enterprise mode (eeclaw) IPC namespace ---

export interface TenantConfigData {
  id: string;
  logo: string | null;
  app_name: string | null;
  top_name: string | null;
  about_name: string | null;
  app_company_name: string | null;
  login_desp: string | null;
  updated_at: number;
}

export interface UserProfileUsageData {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  session_count: number;
}

export interface UserProfileData {
  username: string;
  department: string;
  role: string;
  usage: UserProfileUsageData;
}

export const eeclaw = {
  /** Fetch enterprise cloud assistants from the enterprise server */
  getCloudAssistants: bridge.buildProvider<IBridgeResponse<Array<{ key: string; name: string; avatar?: string; emoji?: string; description?: string }>>, void>('eeclaw.get-cloud-assistants'),
  /** Verify enterprise server connectivity via /api/v1/tenant/config (runs in main process to avoid CORS) */
  verifyServer: bridge.buildProvider<IBridgeResponse<TenantConfigData>, { serverUrl: string }>('eeclaw.verify-server'),
  /** Get current user profile from enterprise server (runs in main process to avoid CORS) */
  getUserProfile: bridge.buildProvider<IBridgeResponse<UserProfileData>, void>('eeclaw.get-user-profile'),
  /** Login to MOSS enterprise server (runs in main process to avoid CORS) */
  login: bridge.buildProvider<
    IBridgeResponse<{
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      user: { id: string; name: string; role: string; orgId: string; localAuth: boolean };
      sudorouter_key?: string;
      model_service_url?: string;
      models?: string[];
    }>,
    { serverUrl: string; body: { grant_type: string; username?: string; password?: string; api_key?: string; params?: Record<string, string> }; deviceId: string }
  >('eeclaw.login'),
  /** Check whether OAuth2 login is enabled on the MOSS server and get the ready-to-open authorize URL (runs in main process to avoid CORS) */
  oauth2Config: bridge.buildProvider<IBridgeResponse<{ enabled: boolean; authorize_url?: string; require_state?: boolean }>, { serverUrl: string }>('eeclaw.oauth2-config'),
  /** Set app mode and update main process cache */
  setAppMode: bridge.buildProvider<void, { mode: 'c' | 'e' }>('eeclaw.set-app-mode'),
  /** Set session mode (remote/local) for enterprise mode and update main process cache */
  setSessionMode: bridge.buildProvider<void, { mode: 'remote' | 'local' }>('eeclaw.set-session-mode'),
  /** Logout from enterprise server and clear local credentials */
  logout: bridge.buildProvider<IBridgeResponse<{}>, void>('eeclaw.logout'),
  /** Emitted when the main process refreshes the enterprise auth token */
  tokenRefreshed: bridge.buildEmitter<{ access_token: string; refresh_token: string; expires_at: number }>('eeclaw.token-refreshed'),
  /** Refresh enterprise auth token via main process (single entry point to avoid race conditions) */
  refreshToken: bridge.buildProvider<IBridgeResponse<{ access_token: string; refresh_token?: string; expires_at: number }>, void>('eeclaw.refresh-token'),
  /** Trigger manual sync of remote skills and assistants to local (for Local mode) */
  syncFromRemote: bridge.buildProvider<IBridgeResponse<SyncAllResult>, void>('eeclaw.sync-from-remote'),
  /** Emitted when background sync completes after enterprise login */
  syncCompleted: bridge.buildEmitter<SyncAllResult>('eeclaw.sync-completed'),

  // === Custom Skill/Assistant Upload ===
  /** Upload custom skill to Moss Server */
  uploadCustomSkill: bridge.buildProvider<IBridgeResponse<{ id: string; name: string; status: string }>, { skillName: string; displayName: string; description?: string; version?: string; sourcePath?: string }>('eeclaw.upload-custom-skill'),
  /** Upload custom assistant to Moss Server */
  uploadCustomAssistant: bridge.buildProvider<IBridgeResponse<{ id: string; name: string; status: string }>, { assistantName: string; assistantId: string; displayName: string; description?: string; version?: string; enabledSkills?: string[]; memoryMode?: 'session' | 'user'; sourcePath?: string }>('eeclaw.upload-custom-assistant'),

  // === Tenant Skill/Assistant ===
  /** Fetch tenant-exclusive skills from Moss Server */
  getTenantSkills: bridge.buildProvider<
    IBridgeResponse<
      Array<{
        id: string;
        name: string;
        displayName?: string;
        description?: string;
        version?: string;
        status: 'pending' | 'approved' | 'rejected';
        author?: string;
        authorName?: string;
        approvedAt?: string;
        installed?: boolean;
      }>
    >,
    void
  >('eeclaw.get-tenant-skills'),
  /** Fetch tenant-exclusive assistants from Moss Server */
  getTenantAssistants: bridge.buildProvider<
    IBridgeResponse<
      Array<{
        id: string;
        name: string;
        displayName?: string;
        description?: string;
        version?: string;
        status: 'pending' | 'approved' | 'rejected';
        author?: string;
        authorName?: string;
        enabledSkills?: string[];
        approvedAt?: string;
        installed?: boolean;
      }>
    >,
    void
  >('eeclaw.get-tenant-assistants'),
  /** Install tenant skill to local */
  installTenantSkill: bridge.buildProvider<IBridgeResponse<{ name: string }>, { skillId: string }>('eeclaw.install-tenant-skill'),
  /** Install tenant assistant to local */
  installTenantAssistant: bridge.buildProvider<IBridgeResponse<{ name: string }>, { assistantId: string }>('eeclaw.install-tenant-assistant'),
  /** Publish skill as tenant-exclusive */
  publishTenantSkill: bridge.buildProvider<IBridgeResponse<{ id: string; skillId: string; skillName: string; status: string; message?: string }>, { skillId: string; publishNote?: string }>('eeclaw.publish-tenant-skill'),
  /** Publish assistant as tenant-exclusive */
  publishTenantAssistant: bridge.buildProvider<IBridgeResponse<{ id: string; assistantId: string; assistantName: string; status: string; message?: string }>, { assistantId: string; publishNote?: string }>('eeclaw.publish-tenant-assistant'),
};
