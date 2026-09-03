/**
 * RendererDataPort — the cross-platform data contract the shared renderer
 * depends on, instead of reaching for Electron `ipcBridge` directly.
 *
 * Two adapters implement it:
 *   - Electron-IPC (apps/desktop) — delegates to the local main process.
 *   - HTTP/WS-to-moss (apps/webui) — delegates to the webui server / moss.
 *
 * Only capabilities both backends can serve live here (auth / sessions /
 * send+stream / agents / skills / cron / mcp / settings / terminal). Desktop-only
 * capabilities (local fs, shell, team orchestration, local KB, native dialogs,
 * updaters, …) are NOT part of this port; the shared renderer reaches them
 * through the separate desktop capability surface and gates them on web via
 * {@link HostCapabilities}.
 */

import type { LoginPasswordRequest, LoginApiKeyRequest, MossMe } from '@sudowork/contracts/auth';
import type { ConversationContextDto, ConversationListItem, CreateConversationRequest, ReorderPinnedRequest, UpdateConversationMetaRequest, ClientOutboundMessage, ServerInboundEvent, MossWorkspaceNode } from '@sudowork/contracts/conversations';

/** Unsubscribe handle returned by every `on*` subscription. */
export type Unsubscribe = () => void;

/** Which optional/desktop-only capability families the current host provides. */
export interface HostCapabilities {
  /** 'desktop' (Electron, full local access) or 'web' (moss-backed, gated). */
  readonly platform: 'desktop' | 'web';
  /** Local filesystem, shell, native dialogs, file watching. */
  readonly localFs: boolean;
  /** Local multi-agent team orchestration (desktop-only today). */
  readonly teams: boolean;
  /** Local knowledge base (embeddings + vector search). */
  readonly localKnowledgeBase: boolean;
  /** Embedded terminal (PTY). */
  readonly terminal: boolean;
  /** BYO-key local model providers (sudocode.json). */
  readonly localModelProviders: boolean;
}

// ── auth ───────────────────────────────────────────────────────────────────
export interface AuthPort {
  me(): Promise<MossMe | null>;
  loginWithPassword(req: LoginPasswordRequest): Promise<MossMe>;
  loginWithApiKey(req: LoginApiKeyRequest): Promise<MossMe>;
  logout(): Promise<void>;
  /** Refresh the access token; resolves the new expiry epoch (ms) or null. */
  refresh(): Promise<number | null>;
  onAuthRequired(cb: (reason: string) => void): Unsubscribe;
}

// ── sessions (conversation lifecycle + history) ─────────────────────────────
export interface SessionsPort {
  list(): Promise<ConversationListItem[]>;
  get(id: string): Promise<ConversationListItem | null>;
  create(req: CreateConversationRequest): Promise<ConversationListItem>;
  updateMeta(req: UpdateConversationMetaRequest): Promise<void>;
  reorderPinned(req: ReorderPinnedRequest): Promise<void>;
  remove(id: string): Promise<void>;
  terminate(id: string): Promise<void>;
  context(id: string): Promise<ConversationContextDto>;
  onListChanged(cb: () => void): Unsubscribe;
  workspaceTree(id: string): Promise<MossWorkspaceNode[]>;
  workspaceFileGet(id: string, path: string): Promise<string>;
  workspaceFilePut(id: string, path: string, content: string): Promise<void>;
  deliverables(id: string): Promise<Array<{ path: string; name: string; mtime: number }>>;
}

// ── send + stream (the chat turn) ───────────────────────────────────────────
export interface SendStreamPort {
  send(msg: ClientOutboundMessage): Promise<void>;
  stop(conversationId: string): Promise<void>;
  answerQuestion(conversationId: string, callId: string, answer: string): Promise<void>;
  onResponseStream(cb: (event: ServerInboundEvent) => void): Unsubscribe;
  onConfirmationAdd(cb: (data: unknown) => void): Unsubscribe;
  onConfirmationUpdate(cb: (data: unknown) => void): Unsubscribe;
  onConfirmationRemove(cb: (data: unknown) => void): Unsubscribe;
  confirm(conversationId: string, callId: string, approved: boolean): Promise<void>;
  onInputQueueUpdate(cb: (data: unknown) => void): Unsubscribe;
  dequeueInput(conversationId: string): Promise<void>;
  getSlashCommands(conversationId: string): Promise<Array<{ name: string; description?: string }>>;
}

// ── agents ──────────────────────────────────────────────────────────────────
export interface AgentsPort {
  listInstalled(): Promise<unknown[]>;
  getAvailable(): Promise<unknown[]>;
  create(meta: unknown): Promise<unknown>;
  updateMeta(id: string, meta: unknown): Promise<void>;
  setEnabled(id: string, enabled: boolean): Promise<void>;
  uninstall(id: string): Promise<void>;
  hubList(): Promise<unknown[]>;
  install(id: string): Promise<void>;
}

// ── skills ──────────────────────────────────────────────────────────────────
export interface SkillsPort {
  listInstalled(): Promise<unknown[]>;
  hubList(): Promise<unknown[]>;
  install(name: string): Promise<void>;
  setEnabled(name: string, enabled: boolean): Promise<void>;
  uninstall(name: string): Promise<void>;
  getAvailableForSession(conversationId: string): Promise<unknown[]>;
  onChanged(cb: () => void): Unsubscribe;
}

// ── cron ──────────────────────────────────────────────────────────────────--
export interface CronPort {
  list(): Promise<unknown[]>;
  listByConversation(conversationId: string): Promise<unknown[]>;
  get(id: string): Promise<unknown | null>;
  add(job: unknown): Promise<unknown>;
  update(id: string, patch: unknown): Promise<void>;
  remove(id: string): Promise<void>;
  trigger(id: string): Promise<void>;
  onCreated(cb: (job: unknown) => void): Unsubscribe;
  onUpdated(cb: (job: unknown) => void): Unsubscribe;
  onRemoved(cb: (id: string) => void): Unsubscribe;
}

// ── mcp ───────────────────────────────────────────────────────────────────--
export interface McpPort {
  servers(): Promise<unknown[]>;
  install(template: unknown): Promise<void>;
  setEnabled(name: string, enabled: boolean): Promise<void>;
  test(name: string): Promise<{ ok: boolean; message?: string }>;
}

// ── settings (models + display prefs) ───────────────────────────────────────
export interface SettingsPort {
  getAvailableModels(): Promise<unknown[]>;
  getUserModel(): Promise<string | null>;
  setUserModel(modelId: string): Promise<void>;
  getShowToolCalls(): Promise<boolean>;
  setShowToolCalls(value: boolean): Promise<void>;
  changeLanguage(lang: string): Promise<void>;
  onLanguageChanged(cb: (lang: string) => void): Unsubscribe;
}

// ── terminal (PTY) ──────────────────────────────────────────────────────────
export interface TerminalPort {
  create(opts: { cwd?: string; cols?: number; rows?: number }): Promise<string>;
  write(id: string, data: string): Promise<void>;
  resize(id: string, cols: number, rows: number): Promise<void>;
  dispose(id: string): Promise<void>;
  onOutput(cb: (id: string, data: string) => void): Unsubscribe;
  onExit(cb: (id: string, code: number) => void): Unsubscribe;
}

/** The cross-platform data contract the shared renderer depends on. */
export interface RendererDataPort {
  readonly capabilities: HostCapabilities;
  readonly auth: AuthPort;
  readonly sessions: SessionsPort;
  readonly sendStream: SendStreamPort;
  readonly agents: AgentsPort;
  readonly skills: SkillsPort;
  readonly cron: CronPort;
  readonly mcp: McpPort;
  readonly settings: SettingsPort;
  readonly terminal: TerminalPort;
}
