import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'node:http';
import { randomBytes } from 'node:crypto';
import { ipcBridge } from '@/common';
import { channelEventBus } from '@/channels/agent/ChannelEventBus';
import type { ICreateTeamMemberParams, IResponseMessage, ITeam, ITeamAssistantCandidate, ITeamMember, ITeamRunAck, ITeamRunState } from '@/common/ipcBridge';
import type { TChatConversation } from '@/common/storage';
import { uuid } from '@/common/utils';
import { getDatabase } from '@process/database';
import WorkerManage from '@process/WorkerManage';
import { assistantManager } from '@/process/AssistantManager';
import type { IAssistantMeta } from '@/process/constants/assistantStorage';
import { ACP_BACKENDS_ALL, resolvePresetAgentBackend, type AcpBackendAll, type AcpModelInfo, type PresetAgentType } from '@/types/acpTypes';
import { readAssistantResource, ruleFilePattern } from '@process/utils/assistantResources';
import i18n, { i18nReady } from '@process/i18n';
import { mainLog, mainWarn, mainError } from '@process/utils/mainLogger';
import type AcpAgent from '@process/task/AcpAgent';
import { acpDetector } from '@/agent/acp/AcpDetector';
import { getNodeBinaryPath } from '@process/services/claudeCli/NodeRuntimeService';
import { getScodeProxyModelInfoSync } from '@process/services/scode/scodeProxyModels';
import { createConversation } from '../conversationService';
import { reapConversation, isSafeAutoWorkspacePath } from '../conversationReaper';
import { teamStore, type Team, type TeamMail, type TeamMember, type TeamMemberSource, type TeamWorkspaceKind } from './TeamStore';
import { buildGovernancePrompt } from './GovernancePrompt';
import { EventLoop, AUTO_RETRY_HINT_PREFIXES } from './EventLoop';
import { TeamRunManager } from './TeamRun';
import { RecoveryDrain } from './RecoveryDrain';
import { TaskBoard } from './TaskBoard';
import { CrashRecovery, type CrashReason } from './CrashRecovery';
import { mergeTeamAssistants, type DetectedAgentLike, type InstalledAssistantLike } from './assistantMerger';
import { SlotWakeGate } from './SlotWakeGate';
import { detectTeamUserLanguage, type TeamUserLanguage } from './TeamLanguage';
import type { WakeSource } from './WakeSource';

const DEFAULT_LOCALE = 'en-US';
/** Per-frame body cap for the team-mcp HTTP loopback (plan §I.6). */
const MAX_TEAM_MCP_BODY_BYTES = 64 * 1024 * 1024;
const TEAM_MCP_PATH = '/team-mcp';
const TEAM_MCP_SERVER_NAME = 'team-mcp';
const TEAM_SESSION_CLOSE_TIMEOUT_MS = 3000;

/** C：user turn 零产出自动重试提示的正文（前缀在回调内取 AUTO_RETRY_HINT_PREFIXES 拼接——
 * 模块顶层不解引用该常量：部分测试的 vi.mock 工厂只导出 EventLoop，顶层求值会使其加载失败）。
 * 必须跟随会话已检测语言投递：sendMessageToMember 内部会用 hint 文本覆写 session.latestUserLanguage，
 * 且会话重建时也会从最新 user mail 重新检测语言——固定英文文案会把中文会话污染为 'en'，
 * 导致下一轮向中文用户注入英文语言契约。 */
const EMPTY_PROSE_RETRY_HINT_BODY_ZH = '你上一轮没有产生任何可见输出（可能是模型或网络服务的临时问题）。请继续处理并回复上面用户最新的消息。';
const EMPTY_PROSE_RETRY_HINT_BODY_EN = "Your previous turn produced no visible output (possibly a transient model/provider issue). Please continue and respond to the user's latest message above.";

type TeamToolResult = { ok: true; data: unknown } | { ok: false; error: string };

interface TeamAssistantSelection {
  source: TeamMemberSource;
  backend: AcpBackendAll;
  presetAgentType: PresetAgentType | null;
  avatar: string | null;
  lookupName: string;
}

interface MemberRuntime {
  member: TeamMember;
  agent: AcpAgent | null;
  eventLoop: EventLoop | null;
}

interface SpawnMemberParams {
  assistant_id: string;
  name: string;
  conversationName?: string;
  model?: string;
  role?: 'lead' | 'teammate';
  notifyLeaderOnSpawn?: boolean;
}

interface ProvisionInitialMemberParams {
  assistant_id: string;
  name: string;
  conversationName?: string;
  model?: string;
  role: 'lead' | 'teammate';
  isPreset: boolean;
}

type AttachRuntimeFailureMode = 'bootstrap' | 'dynamic';

/**
 * Per-team runtime state. The HTTP loopback server (port + bearer token) is
 * shared across all members of a team; each member injects the same port/token
 * but a unique slot_id into its team-mcp bridge (plan §A1 identity triple).
 */
interface TeamSession {
  members: Map<string, MemberRuntime>;
  wakeGate: SlotWakeGate;
  teamRun: TeamRunManager;
  crashRecovery: CrashRecovery;
  /** Pending shutdown requests: slot_id → reason. Drives the shutdown-protocol interception in team_send_message. */
  pendingShutdowns: Map<string, string | null>;
  latestUserLanguage: TeamUserLanguage | null;
  httpServer: http.Server | null;
  port: number;
  token: string;
}

/** Resolve the bundled team-mcp entry JS in both dev and packaged modes (mirrors browser-panel-mcp). */
function getTeamMcpScriptPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'team-mcp', 'index.js');
  }
  const compiledPath = path.join(app.getAppPath(), 'resources', 'team-mcp', 'index.js');
  if (fs.existsSync(compiledPath)) return compiledPath;
  return path.join(app.getAppPath(), 'resources', 'team-mcp', 'src', 'index.ts');
}

function toMemberIPC(m: TeamMember): ITeamMember {
  return {
    id: m.id,
    team_id: m.team_id,
    role: m.role,
    name: m.name,
    assistant_id: m.assistant_id,
    source: m.source,
    backend: m.backend,
    preset_agent_type: m.preset_agent_type,
    skills: m.skills,
    preset_context: m.preset_context,
    model: m.model,
    avatar: m.avatar,
    conversation_id: m.conversation_id,
    status: m.status,
    created_at: m.created_at,
  };
}

/**
 * TeamService - runtime orchestrator for multi-agent team collaboration.
 * Single instance in the main process (mirrors CronService lifecycle). Each team
 * holds a TeamSession: a shared HTTP loopback endpoint + a map of slot_id ->
 * MemberRuntime (AcpAgent + EventLoop + SlotWakeGate). Member turns are driven by
 * per-member EventLoops (signal-wake, peek-then-mark mailbox); TeamRun / operation
 * lease / recovery drain land in later stages.
 */
class TeamService {
  private initialized = false;
  private sessions = new Map<string, TeamSession>();
  private pendingSessionCreates = new Map<string, Promise<TeamSession>>();
  private pendingRebuilds = new Map<string, Promise<void>>();
  private streamUnsubscribe: (() => void) | null = null;
  private channelUnsubscribe: (() => void) | null = null;

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    // Crash detection (附录 §1.6): subscribe to the shared responseStream — AcpAgent owns its
    // connection callbacks, so TeamService watches the emitted stream for disconnected/error.
    this.streamUnsubscribe = ipcBridge.acpConversation.responseStream.on((msg) => this.handleResponseStream(msg));
    // The IPC emitter only broadcasts to renderer windows (never back to main), so in-main
    // stream events must come from channelEventBus — AcpAgent dual-emits every stream
    // message there (crash detection + watchdog reset; same pattern as ChannelMessageService).
    this.channelUnsubscribe = channelEventBus.onAgentMessage((msg) => this.handleResponseStream(msg));
    mainLog('TeamService', 'initialized');
  }

  cleanup(): void {
    this.initialized = false;
    this.streamUnsubscribe?.();
    this.streamUnsubscribe = null;
    this.channelUnsubscribe?.();
    this.channelUnsubscribe = null;
    void Promise.allSettled([...this.pendingSessionCreates.values(), ...this.pendingRebuilds.values()]);
    for (const [, session] of this.sessions) {
      session.crashRecovery.dispose();
      for (const [, rt] of session.members) {
        if (rt.eventLoop) void rt.eventLoop.stop();
        if (rt.agent)
          rt.agent.kill().catch(() => {
            /* ignore */
          });
      }
      session.httpServer?.close();
    }
    this.sessions.clear();
    this.pendingSessionCreates.clear();
    this.pendingRebuilds.clear();
  }

  /** Route a responseStream event to the owning member's crash recovery (reset watchdog + detect). */
  private terminateSlot(teamId: string, slotId: string, isLeader: boolean, reason: CrashReason): void {
    const rt = this.sessions.get(teamId)?.members.get(slotId);
    if (!rt) return;
    const session = this.sessions.get(teamId)!;
    session.teamRun.handleSlotCrash(slotId, isLeader);
    session.crashRecovery.handleCrash(slotId, reason);
    this.disposeSlotRuntime(session, slotId, rt);
  }

  /**
   * Stop + kill + unregister a slot's runtime and its recovery state (crash / rate-limit /
   * spawn-error termination). Without this, a crashed slot keeps a zombie agent process and a
   * dead runtime that swallows messages (sendMessageToMember finds it, notifyWake hits a stopped
   * loop → mail stays unread forever).
   * crashRecovery.dispose is required: crashedSlots is only removed by dispose(slotId)
   * (CrashRecovery.ts:95,108,171) — leaving it set would silently swallow a SECOND crash after
   * the member is re-attached via retryMemberStart (no testament, no failed status). Precedent:
   * removeMember (TeamService.ts:964). Ordering constraint: duplicate-testament protection after
   * dispose is taken over by the members.delete above (findMemberByConversation can no longer
   * resolve the slot) — do not call dispose before members.delete, nor outside this helper.
   */
  private disposeSlotRuntime(session: TeamSession, slotId: string, rt: MemberRuntime): void {
    if (rt.eventLoop) void rt.eventLoop.stop();
    if (rt.agent)
      rt.agent.kill().catch(() => {
        /* ignore */
      });
    session.members.delete(slotId);
    session.crashRecovery.dispose(slotId);
  }

  private handleResponseStream(msg: IResponseMessage): void {
    let found: { teamId: string; slotId: string } | null = null;
    let enteredCrashPath = false;
    try {
      found = this.findMemberByConversation(msg.conversation_id);
      if (!found) return;
      const session = this.sessions.get(found.teamId);
      if (!session) return;
      session.crashRecovery.resetWakeTimeout(found.slotId);
      // 高2: track tool execution for 工具执行中不降级
      if (msg.type === 'acp_tool_call') {
        const update = (msg.data as { update?: { status?: string; toolCallId?: string } })?.update;
        if (update?.toolCallId) {
          if (update.status === 'pending' || update.status === 'in_progress') {
            session.crashRecovery.trackToolStart(found.slotId, update.toolCallId);
          } else if (update.status === 'completed' || update.status === 'failed') {
            session.crashRecovery.trackToolFinish(found.slotId, update.toolCallId);
          }
        }
      }
      const reason = session.crashRecovery.detectCrash({ type: msg.type, content: (msg.data as { status?: string; error?: string } | null) ?? undefined });
      const isLeader = session.members.get(found.slotId)?.member.role === 'lead';
      if (!reason) {
        // H6: rate-limit 仅在 type==='error' 时判（唯一 rate-limit 文本载体）；其他正文不判
        if (msg.type === 'error') {
          const streamErrorText = this.extractStreamErrorText(msg);
          if (streamErrorText && session.crashRecovery.isRateLimited({ kind: 'Unknown', msg: streamErrorText })) {
            teamStore.updateMember(found.slotId, { status: 'failed' });
            ipcBridge.team.onAgentStatusChanged.emit({ team_id: found.teamId, slot_id: found.slotId, status: 'failed', last_message: 'rate limited' });
            session.crashRecovery.markCrashed(found.slotId);
            session.teamRun.handleSlotCrash(found.slotId, isLeader);
            const rateLimitRt = session.members.get(found.slotId);
            if (rateLimitRt) this.disposeSlotRuntime(session, found.slotId, rateLimitRt);
            enteredCrashPath = true;
          }
        }
        return;
      }
      if (session.crashRecovery.isRateLimited(reason)) {
        teamStore.updateMember(found.slotId, { status: 'failed' });
        ipcBridge.team.onAgentStatusChanged.emit({ team_id: found.teamId, slot_id: found.slotId, status: 'failed', last_message: 'rate limited' });
        session.crashRecovery.markCrashed(found.slotId);
        session.teamRun.handleSlotCrash(found.slotId, isLeader);
        const rateLimitRt = session.members.get(found.slotId);
        if (rateLimitRt) this.disposeSlotRuntime(session, found.slotId, rateLimitRt);
        enteredCrashPath = true;
        return;
      }
      enteredCrashPath = true;
      this.terminateSlot(found.teamId, found.slotId, isLeader, reason);
    } catch (e) {
      mainWarn('TeamService', `handleResponseStream failed for slot ${found?.slotId ?? 'unknown'}:`, e);
    } finally {
      if (enteredCrashPath && found) {
        const rt = this.sessions.get(found.teamId)?.members.get(found.slotId);
        if (rt?.eventLoop) void rt.eventLoop.stop();
      }
    }
  }

  private findMemberByConversation(conversationId: string): { teamId: string; slotId: string } | null {
    for (const [teamId, session] of this.sessions) {
      for (const [slotId, rt] of session.members) {
        if (rt.member.conversation_id === conversationId) return { teamId, slotId };
      }
    }
    return null;
  }

  private extractStreamErrorText(msg: IResponseMessage): string {
    const data = msg.data as unknown;
    if (typeof data === 'string') return data;
    if (!data || typeof data !== 'object') return '';
    const record = data as { error?: unknown; content?: unknown; status?: unknown };
    return [record.error, record.content, record.status].filter((value): value is string => typeof value === 'string').join(' ');
  }

  private isKnownBackend(backend: string): backend is AcpBackendAll {
    return backend in ACP_BACKENDS_ALL;
  }

  private async resolveTeamAssistantSelection(assistantId: string): Promise<TeamAssistantSelection> {
    const lookupName = assistantId.startsWith('builtin-') ? assistantId.slice('builtin-'.length) : assistantId;
    const candidates = await this.listAvailableAssistantsForTeam();
    const candidate = candidates.find((item) => item.assistant_id === assistantId);
    if (candidate) {
      return {
        source: candidate.source,
        backend: candidate.backend as AcpBackendAll,
        presetAgentType: (candidate.preset_agent_type as PresetAgentType | null) ?? null,
        avatar: candidate.avatar ?? null,
        lookupName,
      };
    }

    const meta = await assistantManager.getAssistantMeta(lookupName);
    if (meta) {
      return {
        source: 'assistant',
        backend: resolvePresetAgentBackend(meta.presetAgentType),
        presetAgentType: (meta.presetAgentType as PresetAgentType | undefined) || null,
        avatar: meta.avatar ?? null,
        lookupName,
      };
    }

    if (this.isKnownBackend(assistantId)) {
      return {
        source: 'agent',
        backend: assistantId,
        presetAgentType: null,
        avatar: null,
        lookupName,
      };
    }

    throw new Error(`Unknown team assistant or agent: ${assistantId}`);
  }

  private async resolveAssistantMeta(selection: TeamAssistantSelection): Promise<IAssistantMeta | null> {
    if (selection.source !== 'assistant') return null;
    return await assistantManager.getAssistantMeta(selection.lookupName);
  }

  private normalizeCreateTeamMembers(members: ICreateTeamMemberParams[], teamName: string): ICreateTeamMemberParams[] {
    if (!Array.isArray(members) || members.length === 0) throw new Error('At least one team member is required');
    const normalized: ICreateTeamMemberParams[] = members.map((member) => {
      const role = (member as { role?: unknown }).role;
      if (role !== 'lead' && role !== 'teammate') throw new Error('Team member role must be lead or teammate');
      return {
        ...member,
        role,
        assistant_id: typeof member.assistant_id === 'string' ? member.assistant_id.trim() : '',
        name: typeof member.name === 'string' ? member.name.trim() || (role === 'lead' ? teamName : '') : role === 'lead' ? teamName : '',
      };
    });
    for (const member of normalized) {
      if (!member.assistant_id) throw new Error('Team member assistant_id is required');
      if (!member.name) throw new Error('Team member name is required');
    }
    if (normalized.filter((member) => member.role === 'lead').length !== 1) throw new Error('Exactly one team member must be Leader');
    return normalized;
  }

  async createTeam(userId: string, name: string, workspace: string | null, members: ICreateTeamMemberParams[]): Promise<Team> {
    const trimmedName = name.trim();
    if (!trimmedName) throw new Error('Team name is required');
    name = trimmedName;
    const normalizedMembers = this.normalizeCreateTeamMembers(members, name);
    const leaderInput = normalizedMembers.find((member) => member.role === 'lead');
    if (!leaderInput) throw new Error('Exactly one team member must be Leader');

    const now = Date.now();
    const teamId = uuid(36);
    const workspaceKind: TeamWorkspaceKind | null = workspace ? 'custom' : null;
    const team: Team = {
      id: teamId,
      user_id: userId,
      name,
      workspace,
      workspace_kind: workspaceKind,
      leader_member_id: null,
      session_mode: null,
      pinned: false,
      pinned_at: null,
      created_at: now,
      updated_at: now,
    };
    teamStore.insertTeam(team);

    try {
      const leader = await this.provisionInitialMember(team, {
        assistant_id: leaderInput.assistant_id,
        name: leaderInput.name,
        conversationName: name,
        model: leaderInput.model,
        role: 'lead',
        isPreset: true,
      });
      const updates: Partial<Team> = { leader_member_id: leader.id };
      const leaderConversation = leader.conversation_id ? getDatabase().getConversation(leader.conversation_id).data : null;
      if (!workspace) {
        const resolvedWorkspace = leaderConversation?.extra?.workspace;
        if (!resolvedWorkspace) throw new Error('Leader conversation did not resolve a team workspace');
        updates.workspace = resolvedWorkspace;
        updates.workspace_kind = 'temporary';
      }
      teamStore.updateTeam(teamId, updates);
      team.leader_member_id = leader.id;
      if (updates.workspace !== undefined) team.workspace = updates.workspace;
      if (updates.workspace_kind !== undefined) team.workspace_kind = updates.workspace_kind;

      for (const member of normalizedMembers.filter((item) => item.role === 'teammate')) {
        await this.provisionInitialMember(team, {
          assistant_id: member.assistant_id,
          name: member.name,
          model: member.model,
          role: 'teammate',
          isPreset: true,
        });
      }

      ipcBridge.team.onListChanged.emit({ team_id: teamId, action: 'created' });
      return teamStore.getTeam(teamId) ?? { ...team, updated_at: Date.now() };
    } catch (error) {
      await this.rollbackInsertedTeam(teamId);
      throw error;
    }
  }

  private async provisionInitialMember(team: Team, params: ProvisionInitialMemberParams): Promise<TeamMember> {
    const selection = await this.resolveTeamAssistantSelection(params.assistant_id);
    const meta = await this.resolveAssistantMeta(selection);
    const backend = selection.backend;
    const presetAgentType = selection.presetAgentType;
    const enabledSkills = meta?.enabledSkills ?? [];
    let rulesText: string | null = null;
    if (meta?.ruleFile) {
      try {
        rulesText = await readAssistantResource('rules', selection.lookupName, DEFAULT_LOCALE, ruleFilePattern);
      } catch {
        mainWarn('TeamService', `Failed to read rules for assistant ${selection.lookupName}`);
      }
    }
    const presetContext = [rulesText, buildGovernancePrompt(params.role, team.name, params.name)].filter(Boolean).join('\n\n') || null;

    const isResolvingInitialTeamWorkspace = params.role === 'lead' && !team.workspace && !team.workspace_kind;
    if (!isResolvingInitialTeamWorkspace && !team.workspace) throw new Error(`Team workspace is not resolved: ${team.id}`);
    const customWorkspace = team.workspace_kind === 'custom';

    const createResult = await createConversation({
      type: 'acp',
      name: params.conversationName || params.name,
      extra: {
        backend,
        workspace: team.workspace || undefined,
        customWorkspace: isResolvingInitialTeamWorkspace ? false : customWorkspace,
        workspaceDisplayName: team.name,
        teamOwnedWorkspace: true,
        presetAssistantId: params.assistant_id,
        presetContext: presetContext || undefined,
        enabledSkills,
        agentName: params.name,
        isTeamMember: true,
        teamId: team.id,
        sessionMode: team.session_mode ?? undefined,
      },
      skipWorkerRegistration: true,
    });
    if (!createResult.success || !createResult.conversation) {
      throw new Error(createResult.error || 'Failed to create member conversation');
    }
    const conversationId = createResult.conversation.id;
    const member: TeamMember = {
      id: uuid(36),
      team_id: team.id,
      role: params.role,
      name: params.name,
      assistant_id: params.assistant_id,
      source: selection.source,
      backend,
      preset_agent_type: (presetAgentType as PresetAgentType | undefined) || null,
      skills: enabledSkills,
      preset_context: presetContext,
      model: params.model || null,
      avatar: selection.avatar ?? meta?.avatar ?? null,
      conversation_id: conversationId,
      status: 'pending',
      isPreset: params.isPreset,
      isDelegated: false,
      created_at: Date.now(),
    };
    try {
      teamStore.insertMember(member);
      return member;
    } catch (error) {
      await reapConversation(conversationId, { reason: 'team-spawn-rollback', deleteWorkspace: false });
      throw error;
    }
  }

  async spawnMember(teamId: string, params: SpawnMemberParams): Promise<TeamMember> {
    const team = teamStore.getTeam(teamId);
    if (!team) throw new Error(`Team not found: ${teamId}`);
    const role = params.role || 'teammate';
    const memberName = params.name.trim();
    if (!memberName) throw new Error('Member name is required');

    const existing = teamStore.listMembersByTeam(teamId);
    if (role === 'lead' && existing.some((m) => m.role === 'lead')) throw new Error('Team already has a leader');
    // Duplicate names confuse coordination (LLM addresses members by name) — reject them outright.
    if (existing.some((m) => m.name === memberName)) throw new Error(`member name already exists: ${memberName}`);

    const selection = await this.resolveTeamAssistantSelection(params.assistant_id);
    const meta = await this.resolveAssistantMeta(selection);
    const backend = selection.backend;
    const presetAgentType = selection.presetAgentType;
    const enabledSkills = meta?.enabledSkills ?? [];
    let rulesText: string | null = null;
    if (meta?.ruleFile) {
      try {
        rulesText = await readAssistantResource('rules', selection.lookupName, DEFAULT_LOCALE, ruleFilePattern);
      } catch {
        mainWarn('TeamService', `Failed to read rules for assistant ${selection.lookupName}`);
      }
    }
    // A3: assistant rules + team governance, injected as presetContext. AcpAgent
    // preserves the governance block across its per-message rules reload (see
    // extractGovernanceBlock) so it is not clobbered, and re-injects it on every
    // turn so the leader keeps its role across multi-turn conversations.
    const governance = buildGovernancePrompt(role, team.name, memberName);
    const presetContext = [rulesText, governance].filter(Boolean).join('\n\n') || null;

    const slotId = uuid(36);

    // Ensure the per-team HTTP loopback is up so we can hand the member its identity triple.
    const session = await this.ensureSession(teamId);
    const teamMcpConfig = this.buildTeamMcpConfig(session, slotId);

    const isResolvingInitialTeamWorkspace = role === 'lead' && !team.workspace && !team.workspace_kind;
    if (!isResolvingInitialTeamWorkspace && !team.workspace) throw new Error(`Team workspace is not resolved: ${teamId}`);
    const customWorkspace = team.workspace_kind === 'custom';

    const createResult = await createConversation({
      type: 'acp',
      name: params.conversationName || memberName,
      extra: {
        backend,
        workspace: team.workspace || undefined,
        customWorkspace: isResolvingInitialTeamWorkspace ? false : customWorkspace,
        workspaceDisplayName: team.name,
        teamOwnedWorkspace: true,
        presetAssistantId: params.assistant_id,
        presetContext: presetContext || undefined,
        enabledSkills,
        agentName: memberName,
        isTeamMember: true,
        teamId,
        teamMcpConfig,
        sessionMode: team.session_mode ?? undefined,
      },
      skipWorkerRegistration: true,
    });
    if (!createResult.success || !createResult.conversation) {
      throw new Error(createResult.error || 'Failed to create member conversation');
    }
    const conversationId = createResult.conversation.id;

    const member: TeamMember = {
      id: slotId,
      team_id: teamId,
      role,
      name: memberName,
      assistant_id: params.assistant_id,
      source: selection.source,
      backend,
      preset_agent_type: (presetAgentType as PresetAgentType | undefined) || null,
      skills: enabledSkills,
      preset_context: presetContext,
      model: params.model || null,
      avatar: selection.avatar ?? meta?.avatar ?? null,
      conversation_id: conversationId,
      status: 'pending',
      isPreset: false,
      isDelegated: false,
      created_at: Date.now(),
    };
    try {
      teamStore.insertMember(member);
    } catch (error) {
      await reapConversation(conversationId, { reason: 'team-spawn-rollback', deleteWorkspace: false });
      throw error;
    }

    ipcBridge.team.onMemberSpawned.emit({ team_id: teamId, member: toMemberIPC(member) });
    setTimeout(() => {
      void this.completeSpawnedMemberRuntime(teamId, member, createResult.conversation, session, {
        notifyLeaderOnSpawn: params.notifyLeaderOnSpawn !== false,
      }).catch((error) => this.handleSpawnedMemberRuntimeError(teamId, member.id, session, error));
    }, 0);

    return member;
  }

  private isSpawnedMemberRuntimeCurrent(teamId: string, slotId: string, session: TeamSession): boolean {
    const team = teamStore.getTeam(teamId);
    if (!team) return false;
    const member = teamStore.getMember(slotId);
    return Boolean(member && member.team_id === teamId && this.sessions.get(teamId) === session);
  }

  private async completeSpawnedMemberRuntime(teamId: string, member: TeamMember, conversation: TChatConversation, session: TeamSession, options: { notifyLeaderOnSpawn: boolean }): Promise<void> {
    if (!this.isSpawnedMemberRuntimeCurrent(teamId, member.id, session)) return;

    const attached = await this.attachRuntime(teamId, member, conversation, session, 'dynamic');
    if (!attached) return;
    if (!this.isSpawnedMemberRuntimeCurrent(teamId, member.id, session)) return;

    teamStore.updateMember(member.id, { status: 'idle', conversation_id: member.conversation_id });
    const runtime = session.members.get(member.id);
    if (runtime) {
      runtime.member.status = 'idle';
      runtime.member.conversation_id = member.conversation_id;
    }
    ipcBridge.team.onAgentStatusChanged.emit({ team_id: teamId, slot_id: member.id, status: 'idle' });

    if (member.role === 'teammate' && options.notifyLeaderOnSpawn) {
      if (!this.isSpawnedMemberRuntimeCurrent(teamId, member.id, session)) return;
      try {
        const storedMember = teamStore.getMember(member.id) ?? member;
        await this.notifyLeaderMemberAdded(teamId, storedMember);
      } catch (error) {
        mainWarn('TeamService', `Failed to notify leader after spawning member ${member.id}:`, error);
        // One-shot retry after 5s: a missed spawn notice leaves the new member silently idle.
        // Guarded by isSpawnedMemberRuntimeCurrent so a removed member / replaced session no-ops.
        const timer = setTimeout(() => {
          if (!this.isSpawnedMemberRuntimeCurrent(teamId, member.id, session)) return;
          const retryMember = teamStore.getMember(member.id) ?? member;
          this.notifyLeaderMemberAdded(teamId, retryMember).catch((retryError) => {
            mainWarn('TeamService', `Leader-notify retry failed for member ${member.id}:`, retryError);
          });
        }, 5000);
        timer.unref?.();
      }
    }
  }

  private handleSpawnedMemberRuntimeError(teamId: string, slotId: string, session: TeamSession, error: unknown): void {
    try {
      if (!this.isSpawnedMemberRuntimeCurrent(teamId, slotId, session)) return;
      // Tear the runtime down (a failed-but-attached member would keep consuming wakes) and
      // release this slot's run bookkeeping: a broadcast may already have seeded a pending wake
      // for it during the spawn window (commitLease in toolSendMessage), and an unclaimed wake
      // would strand the run active forever. The mail itself stays unread and is re-owned by
      // retryMemberStart's drain/seeding when the user retries.
      const runtime = session.members.get(slotId);
      if (runtime) this.disposeSlotRuntime(session, slotId, runtime);
      session.teamRun.clearSlot(slotId);
      teamStore.updateMember(slotId, { status: 'failed' });
      ipcBridge.team.onAgentStatusChanged.emit({ team_id: teamId, slot_id: slotId, status: 'failed', last_message: error instanceof Error ? error.message : String(error) });
      mainError('TeamService', `spawn member runtime failed for ${slotId}:`, error);
    } catch (compensationError) {
      mainError('TeamService', `failed to mark spawned member ${slotId} as failed:`, compensationError);
    }
  }

  /** Build a member's AcpAgent + event loop and register it. Returns true when attached. */
  private buildTeamMcpConfig(session: TeamSession, slotId: string): { name: string; command: string; args: string[]; env: Array<{ name: string; value: string }> } {
    return {
      name: TEAM_MCP_SERVER_NAME,
      command: getNodeBinaryPath(),
      args: [getTeamMcpScriptPath()],
      env: [
        { name: 'TEAM_MCP_PORT', value: String(session.port) },
        { name: 'TEAM_MCP_TOKEN', value: session.token },
        { name: 'TEAM_MCP_SLOT_ID', value: slotId },
      ],
    };
  }

  private async attachRuntime(teamId: string, member: TeamMember, conversation: TChatConversation, session: TeamSession, failureMode: AttachRuntimeFailureMode): Promise<boolean> {
    // Team members run unattended (no interactive permission UI), so force yoloMode
    // to auto-approve tools — otherwise MCP tools like team_send_message get blocked.
    const task = WorkerManage.buildConversation(conversation, { skipCache: true, yoloMode: true });
    const agent = (task ?? null) as unknown as AcpAgent | null;
    if (!agent) {
      teamStore.updateMember(member.id, { status: 'failed' });
      ipcBridge.team.onAgentStatusChanged.emit({ team_id: teamId, slot_id: member.id, status: 'failed', last_message: 'attach failed' });
      if (failureMode === 'dynamic') {
        const leaderId = this.leaderSlotOrNull(teamId);
        if (leaderId) {
          const mailId = uuid(36);
          const { lease } = session.teamRun.acquireWake(leaderId, 'lead', 'spawn_attach_failure');
          try {
            teamStore.insertMail({
              id: mailId,
              team_id: teamId,
              to_member_id: leaderId,
              from_member_id: member.id,
              type: 'message',
              content: `Failed to attach agent for '${member.name}'. Spawn aborted.`,
              summary: null,
              files: null,
              read: false,
              created_at: Date.now(),
            });
          } catch {
            session.teamRun.abortLease(lease.lease_id);
            return false;
          }
          session.teamRun.commitLease(lease.lease_id, { slot_id: leaderId, role: 'lead', source: 'spawn_attach_failure', message_id: mailId });
          this.notifyWake(teamId, leaderId);
        }
      }
      return false;
    }
    const runtime: MemberRuntime = { member: { ...member }, agent, eventLoop: null };
    session.members.set(member.id, runtime);
    const eventLoop = new EventLoop({
      teamId,
      slotId: member.id,
      member: runtime.member,
      getAgent: () => runtime.agent,
      wakeGate: session.wakeGate,
      teamRun: session.teamRun,
      crashRecovery: session.crashRecovery,
      leaderSlotId: () => this.leaderSlotOrNull(teamId),
      onWakeSlot: (targetSlot, source, messageId) => this.recordSystemWake(teamId, targetSlot, source, messageId),
      lookupMember: (sid) => this.lookupMember(teamId, sid),
      getLatestUserLanguage: () => session.latestUserLanguage,
      onUserTurnEmptyProse: (slotId) => {
        const hint = (this.sessions.get(teamId)?.latestUserLanguage ?? 'en') === 'zh' ? `${AUTO_RETRY_HINT_PREFIXES[1]} ${EMPTY_PROSE_RETRY_HINT_BODY_ZH}` : `${AUTO_RETRY_HINT_PREFIXES[0]} ${EMPTY_PROSE_RETRY_HINT_BODY_EN}`;
        void this.sendMessageToMember(teamId, slotId, hint).catch((e) => {
          mainWarn('TeamService', `empty-prose auto-retry mail failed for ${slotId}:`, e);
        });
      },
    });
    runtime.eventLoop = eventLoop;
    eventLoop.start();
    return true;
  }

  /**
   * Rebuild a team's runtime from the database (附录 §1.3 TeamSession.rebuild / 关键事实 4). Called via
   * the ensureSession bridge when a user re-opens a team after an app restart: in-memory sessions are
   * gone, so each member is re-attached and any unread mailbox backlog is re-drained.
   */
  async rebuildTeam(teamId: string): Promise<void> {
    const team = teamStore.getTeam(teamId);
    if (!team) return;
    const pending = this.pendingRebuilds.get(teamId);
    if (pending) return await pending;
    if (this.sessions.has(teamId)) {
      ipcBridge.team.onSessionChanged.emit({ teamId, status: 'ready' });
      return;
    }

    const rebuildPromise = this.rebuildTeamRuntime(teamId);
    this.pendingRebuilds.set(teamId, rebuildPromise);
    try {
      await rebuildPromise;
    } finally {
      this.pendingRebuilds.delete(teamId);
    }
  }

  private async rebuildTeamRuntime(teamId: string): Promise<void> {
    ipcBridge.team.onSessionChanged.emit({ teamId, status: 'starting' });
    try {
      const session = await this.ensureSession(teamId);
      const members = teamStore.listMembersByTeam(teamId);
      let attachedCount = 0;
      for (const m of members) {
        if (!m.conversation_id) continue;
        // Per-member failure: mark that member failed and continue — one broken member must not
        // take the whole session down (the UI offers per-member retry-start). attachRuntime
        // already marks failed on its own path; the extra write here is idempotent.
        try {
          const convResult = getDatabase().getConversation(m.conversation_id);
          if (!convResult.success || !convResult.data) throw new Error(`Failed to load team member conversation: ${m.name}`);
          const teamMcpConfig = this.buildTeamMcpConfig(session, m.id);
          const nextExtra = Object.assign({}, convResult.data.extra, { teamMcpConfig });
          const updateResult = getDatabase().updateConversation(m.conversation_id, { extra: nextExtra } as Partial<TChatConversation>);
          if (!updateResult.success) throw new Error(updateResult.error || `Failed to update team MCP config for ${m.name}`);
          const updatedResult = getDatabase().getConversation(m.conversation_id);
          if (!updatedResult.success || !updatedResult.data) throw new Error(`Failed to reload team member conversation: ${m.name}`);
          const attached = await this.attachRuntime(teamId, m, updatedResult.data, session, 'bootstrap');
          if (!attached) throw new Error(`Failed to attach team member: ${m.name}`);
          teamStore.updateMember(m.id, { status: 'idle', conversation_id: m.conversation_id });
          ipcBridge.team.onAgentStatusChanged.emit({ team_id: teamId, slot_id: m.id, status: 'idle' });
          attachedCount += 1;
        } catch (memberError) {
          mainWarn('TeamService', `rebuild skipped team member ${m.name} (${m.id}):`, memberError);
          teamStore.updateMember(m.id, { status: 'failed' });
          ipcBridge.team.onAgentStatusChanged.emit({
            team_id: teamId,
            slot_id: m.id,
            status: 'failed',
            last_message: memberError instanceof Error ? memberError.message : String(memberError),
          });
        }
      }
      new RecoveryDrain(teamId, session.teamRun, (sid) => this.notifyWake(teamId, sid)).drain();
      mainLog('TeamService', `rebuilt team ${teamId} (${attachedCount}/${members.length} member(s) attached)`);
      ipcBridge.team.onSessionChanged.emit({ teamId, status: 'ready' });
    } catch (error) {
      ipcBridge.team.onSessionChanged.emit({ teamId, status: 'failed', error: error instanceof Error ? error.message : String(error) });
      await this.stopSession(teamId);
      throw error;
    }
  }

  /** Stop a team's runtime (附录 §1.3 TeamSession.stop): tear down members + HTTP loopback. */
  async stopTeamSession(teamId: string): Promise<void> {
    await this.stopSession(teamId);
  }

  /** User message to the team leader. */
  async sendMessage(teamId: string, input: string, files?: string[], msgId?: string): Promise<ITeamRunAck> {
    return this.sendMessageToMember(teamId, this.leaderSlot(teamId), input, files, msgId);
  }

  async answerQuestion(teamId: string, slotId: string, conversationId: string, toolCallId: string, answers: Array<{ id: string; value: string; label?: string }>): Promise<void> {
    const team = teamStore.getTeam(teamId);
    if (!team) throw new Error(`Team not found: ${teamId}`);
    const runtime = this.getRuntime(teamId, slotId);
    if (!runtime) throw new Error(`Member not found: ${slotId}`);
    if (runtime.member.conversation_id !== conversationId) throw new Error('Conversation does not belong to team member');
    if (!runtime.agent) throw new Error(`Member agent not available: ${slotId}`);
    if (!toolCallId.trim()) throw new Error('Invalid toolCallId');

    await runtime.agent.answerQuestion(toolCallId, this.sanitizeQuestionAnswers(answers));
  }

  /** Model info for a team member's live agent, routed by conversation_id. */
  getMemberModelInfo(conversationId: string): AcpModelInfo | null {
    const found = this.findMemberByConversation(conversationId);
    if (!found) return null;
    const agent = this.getRuntime(found.teamId, found.slotId)?.agent;
    return agent ? agent.getModelInfo() : null;
  }

  /** Switch model for a team member's live agent, routed by conversation_id. */
  async setMemberModel(conversationId: string, modelId: string): Promise<AcpModelInfo | null> {
    const found = this.findMemberByConversation(conversationId);
    if (!found) throw new Error('Team member not found for conversation');
    const agent = this.getRuntime(found.teamId, found.slotId)?.agent;
    if (!agent) throw new Error('Team member agent not available');
    return agent.setModel(modelId);
  }

  /** User message to a specific member (writes mailbox from=user under an operation lease, then wakes the loop). */
  async sendMessageToMember(teamId: string, slotId: string, input: string, files?: string[], msgId?: string): Promise<ITeamRunAck> {
    const team = teamStore.getTeam(teamId);
    if (!team) throw new Error(`Team not found: ${teamId}`);
    const runtime = this.getRuntime(teamId, slotId);
    if (!runtime) throw new Error(`Member not found: ${slotId}`);
    const session = this.sessions.get(teamId);
    if (!session) throw new Error(`Team session not active: ${teamId}`);

    const mailId = msgId || uuid(36);
    const mail: TeamMail = {
      id: mailId,
      team_id: teamId,
      to_member_id: slotId,
      from_member_id: 'user',
      type: 'message',
      content: input,
      summary: null,
      files: files ?? null,
      read: false,
      created_at: Date.now(),
    };

    // Operation lease (附录 I.1): acquire → write mailbox → commit (lease → pending wake).
    // The lease prevents the run from completing between writing the mailbox and enqueuing the wake.
    const { lease } = session.teamRun.acquireWake(slotId, runtime.member.role, 'user_message');
    try {
      teamStore.insertMail(mail);
      session.latestUserLanguage = detectTeamUserLanguage(input);
    } catch (e) {
      session.teamRun.abortLease(lease.lease_id);
      throw e;
    }
    session.teamRun.commitLease(lease.lease_id, { slot_id: slotId, role: runtime.member.role, source: 'user_message', message_id: mailId });

    // Wake the member's event loop — it mirrors unread, drives the agent turn (which
    // emits the user's right bubble itself), and marks the mailbox read.
    this.notifyWake(teamId, slotId);

    return {
      team_run_id: lease.team_run_id,
      team_id: teamId,
      target_slot_id: slotId,
      target_role: runtime.member.role,
      accepted_slot_id: slotId,
      accepted_role: runtime.member.role,
      status: 'accepted',
      message_id: mailId,
    };
  }

  private formatRosterLine(member: TeamMember): string {
    return `- ${member.name}: slot_id=${member.id}, role=${member.role}, status=${member.status}, backend=${member.backend}, model=${member.model ?? 'default'}`;
  }

  private writeLeaderMembershipNotice(teamId: string, content: string, fromMemberId: string): void {
    const leaderId = this.leaderSlotOrNull(teamId);
    if (!leaderId) throw new Error('Team has no leader');
    const session = this.sessions.get(teamId);
    if (!session) throw new Error(`Team session not active: ${teamId}`);
    const mailId = uuid(36);
    const { lease } = session.teamRun.acquireWake(leaderId, 'lead', 'team_membership_changed');
    try {
      teamStore.insertMail({
        id: mailId,
        team_id: teamId,
        to_member_id: leaderId,
        from_member_id: fromMemberId,
        type: 'message',
        content,
        summary: null,
        files: null,
        read: false,
        created_at: Date.now(),
      });
    } catch (error) {
      session.teamRun.abortLease(lease.lease_id);
      throw error;
    }
    session.teamRun.commitLease(lease.lease_id, { slot_id: leaderId, role: 'lead', source: 'team_membership_changed', message_id: mailId });
    this.notifyWake(teamId, leaderId);
  }

  private async notifyLeaderMemberAdded(teamId: string, member: TeamMember): Promise<void> {
    await i18nReady;
    this.writeLeaderMembershipNotice(teamId, `${i18n.t('team.membership.memberAddedNotice')}\n\n${this.formatRosterLine(member)}\n- assistant_id=${member.assistant_id ?? ''}`, member.id);
  }

  private async rollbackInsertedTeam(teamId: string): Promise<void> {
    try {
      // Read the workspace BEFORE soft-delete — getTeam filters deleted=0 and returns null afterwards.
      const workspace = teamStore.getTeam(teamId)?.workspace ?? null;
      await this.stopSession(teamId);
      for (const member of teamStore.listMembersByTeam(teamId)) {
        if (member.conversation_id) {
          await reapConversation(member.conversation_id, { reason: 'team-spawn-rollback', deleteWorkspace: false });
        }
      }
      teamStore.softDeleteMembersByTeam(teamId);
      teamStore.softDeleteTeam(teamId);
      teamStore.hardDeleteMailboxByTeam(teamId);
      teamStore.hardDeleteTasksByTeam(teamId);
      if (workspace && isSafeAutoWorkspacePath(workspace)) {
        try {
          await fs.promises.rm(workspace, { recursive: true, force: true });
        } catch (error) {
          // Non-fatal: the boot orphan sweeper reclaims unreferenced `-temp-` dirs on next start.
          mainWarn('TeamService', `Failed to delete team workspace during rollback: ${workspace}`, error);
        }
      }
    } catch (error) {
      mainWarn('TeamService', `Failed to rollback team ${teamId}:`, error);
    }
  }

  async removeTeam(teamId: string, deleteWorkspace?: boolean): Promise<void> {
    const team = teamStore.getTeam(teamId);
    if (!team) throw new Error(`Team not found: ${teamId}`);
    const members = teamStore.listMembersByTeam(teamId);

    await this.stopSession(teamId);
    for (const member of members) {
      if (member.conversation_id) {
        await reapConversation(member.conversation_id, { reason: 'user-delete', deleteWorkspace: false });
      }
    }
    teamStore.softDeleteMembersByTeam(teamId);
    teamStore.softDeleteTeam(teamId);
    // Teams are soft-deleted, so FK CASCADE never fires — child rows must be removed explicitly.
    teamStore.hardDeleteMailboxByTeam(teamId);
    teamStore.hardDeleteTasksByTeam(teamId);
    try {
      await this.removeTeamWorkspace(team, deleteWorkspace);
    } catch (error) {
      // Non-fatal: the team row is already gone, so failing here would make the delete
      // unretryable ("Team not found") while leaving a permanent orphan dir. The boot
      // orphan sweeper reclaims unreferenced `-temp-` workspaces on the next start.
      mainWarn('TeamService', `Failed to delete team workspace: ${team.workspace}`, error);
    }
    ipcBridge.team.onListChanged.emit({ team_id: teamId, action: 'removed' });
  }

  updateTeam(teamId: string, updates: Partial<ITeam>): Team {
    const team = teamStore.getTeam(teamId);
    if (!team) throw new Error(`Team not found: ${teamId}`);

    const patch: Partial<Team> = {};
    let isRenamed = false;

    if (updates.name !== undefined) {
      const name = updates.name.trim();
      if (!name) throw new Error('Team name is required');
      patch.name = name;
      isRenamed = name !== team.name;
    }

    if (updates.pinned !== undefined) {
      patch.pinned = updates.pinned;
      patch.pinned_at = updates.pinned ? (typeof updates.pinned_at === 'number' ? updates.pinned_at : Date.now()) : null;
    }

    if (Object.keys(patch).length === 0) {
      return team;
    }

    teamStore.updateTeam(teamId, patch);
    if (isRenamed && patch.name) {
      this.syncTeamConversationDisplayName(teamId, patch.name);
    }

    const updated = teamStore.getTeam(teamId);
    if (!updated) throw new Error(`Team not found after update: ${teamId}`);
    ipcBridge.team.onListChanged.emit({ team_id: teamId, action: isRenamed ? 'renamed' : 'updated' });
    if (isRenamed) {
      ipcBridge.team.onSessionChanged.emit({ teamId });
    }
    return updated;
  }

  renameTeam(teamId: string, name: string): Team {
    return this.updateTeam(teamId, { name });
  }

  private syncTeamConversationDisplayName(teamId: string, name: string): void {
    for (const member of teamStore.listMembersByTeam(teamId)) {
      if (!member.conversation_id) continue;
      const conversation = getDatabase().getConversation(member.conversation_id).data;
      if (!conversation) continue;
      const updates: Partial<TChatConversation> = {
        extra: { ...conversation.extra, workspaceDisplayName: name },
      };
      if (member.role === 'lead') {
        updates.name = name;
      }
      getDatabase().updateConversation(member.conversation_id, updates);
    }
  }

  private async removeTeamWorkspace(team: Team, deleteWorkspace?: boolean): Promise<void> {
    if (!team.workspace) return;
    if (deleteWorkspace === false) return;
    // 白名单护栏：仅删 workDir 直接子目录下 temp 命名的托管 temporary workspace；
    // custom（用户自选）不在托管范围，一律保留。
    if (!isSafeAutoWorkspacePath(team.workspace)) {
      mainWarn('TeamService', `Skipped non-managed workspace (kept, remove manually if needed): ${team.workspace}`);
      return;
    }
    await fs.promises.rm(team.workspace, { recursive: true, force: true });
  }

  async removeMember(teamId: string, slotId: string): Promise<void> {
    const member = teamStore.getMember(slotId);
    if (!member || member.team_id !== teamId) throw new Error(`Member not found: ${slotId}`);
    if (member.role === 'lead') throw new Error('cannot remove the team lead');
    const session = this.sessions.get(teamId);
    const rt = session?.members.get(slotId);
    if (rt?.eventLoop) await rt.eventLoop.stop();
    if (rt?.agent)
      rt.agent.kill().catch(() => {
        /* ignore */
      });
    session?.crashRecovery.dispose(slotId);
    session?.teamRun.clearSlot(slotId);
    session?.members.delete(slotId);
    session?.wakeGate.clear(slotId);
    if (member.conversation_id) {
      await reapConversation(member.conversation_id, { reason: 'user-delete', deleteWorkspace: false });
    }
    teamStore.softDeleteMember(slotId);
    // The member's inbox dies with the member (mail they SENT stays in recipients' mailboxes).
    teamStore.hardDeleteMailboxByMember(slotId);
    ipcBridge.team.onMemberRemoved.emit({ team_id: teamId, slot_id: slotId });
  }

  listTeams(userId: string): Team[] {
    return teamStore.listByUser(userId);
  }

  getTeam(teamId: string): Team | null {
    return teamStore.getTeam(teamId);
  }

  listMembers(teamId: string): TeamMember[] {
    return teamStore.listMembersByTeam(teamId);
  }

  async listAvailableAssistantsForTeam(): Promise<ITeamAssistantCandidate[]> {
    let installed: InstalledAssistantLike[] = [];
    try {
      installed = (await assistantManager.getInstalledAssistants()) as unknown as InstalledAssistantLike[];
    } catch (error) {
      mainWarn('TeamService', 'getInstalledAssistants failed:', error);
    }
    const detected = acpDetector.getDetectedAgents() as unknown as DetectedAgentLike[];
    return mergeTeamAssistants(
      detected,
      installed.filter((assistant) => assistant.enabled)
    );
  }

  /** Current run state for the renderer (null when no active run). */
  getRunState(teamId: string): ITeamRunState {
    const session = this.sessions.get(teamId);
    return { active_run: session ? session.teamRun.toActiveRunEvent() : null };
  }

  /** Cancel the active run (附录 I.1): beginCancel + clear unread mailbox for all members (so RecoveryDrain does not resurrect cancelled work after restart) + cancel each active child turn. */
  cancelRun(teamId: string, reason?: string): void {
    const session = this.sessions.get(teamId);
    if (!session) return;
    if (session.teamRun.getRecord()?.status === 'cancelling') return; // M-3 防重入
    // B1: beginCancel 前快照 pending_wakes + starting_reservations 的 message_id，精准 markRead
    const run = session.teamRun.getRecord();
    const messageIds: string[] = [];
    if (run) {
      for (const queue of run.pending_wakes.values()) {
        for (const wake of queue) {
          if (wake.message_id) messageIds.push(wake.message_id);
        }
      }
      for (const res of run.starting_reservations.values()) {
        if (res.message_id) messageIds.push(res.message_id);
      }
    }
    session.teamRun.beginCancel(reason);
    if (messageIds.length > 0) teamStore.markReadBatch(messageIds);
    // 并发取消 active + starting slots
    const workSlots = new Set<string>();
    if (run) {
      for (const slotId of run.active_child_turns.keys()) workSlots.add(slotId);
      for (const res of run.starting_reservations.values()) workSlots.add(res.slot_id);
    }
    for (const slotId of workSlots) {
      void this.cancelSlotWork(teamId, slotId);
    }
    // 20s 看门狗 stale 防护
    const capturedSession = session;
    const capturedRunId = run?.team_run_id;
    const timer = setTimeout(() => {
      const current = this.sessions.get(teamId);
      if (current !== capturedSession) return;
      const currentRun = current.teamRun.getRecord();
      if (currentRun?.team_run_id !== capturedRunId || currentRun.status !== 'cancelling') return;
      current.teamRun.forceCancel();
    }, 20000);
    timer.unref?.();
  }

  private async cancelSlotWork(teamId: string, slotId: string): Promise<void> {
    const session = this.sessions.get(teamId);
    if (!session) return;
    const rt = session.members.get(slotId);
    if (rt?.agent) {
      try {
        await Promise.race([rt.agent.stop(), new Promise<void>((resolve) => setTimeout(resolve, 15000))]);
      } catch {
        /* ignore */
      }
    }
    const child = session.teamRun.getRecord()?.active_child_turns.get(slotId);
    if (child) {
      session.teamRun.recordChildCompleted(slotId, { turn_id: child.turn_id, status: 'cancelled' });
    }
  }

  /** Cancel a single active child turn (附录 I.1 cancelChildTurn): stop the agent + record the child cancelled. The run is NOT forced terminal. */
  async cancelChildTurn(teamId: string, slotId: string, turnId?: string): Promise<void> {
    const session = this.sessions.get(teamId);
    if (!session) return;
    const child = session.teamRun.getRecord()?.active_child_turns.get(slotId);
    if (!child) return;
    const targetTurnId = turnId ?? child.turn_id;
    if (child.turn_id !== targetTurnId) return; // stale — a different turn is now active
    const rt = session.members.get(slotId);
    if (rt?.agent) {
      try {
        await rt.agent.stop();
      } catch {
        /* ignore */
      }
    }
    session.teamRun.recordChildCompleted(slotId, { turn_id: targetTurnId, status: 'cancelled' });
  }

  /** Renew an operation lease timeout (附录 I.1 renewActiveLease). Stage 5: leases have no timeout yet, so this is a forward-compatible no-op. */
  renewActiveLease(teamId: string, leaseId: string): void {
    this.sessions.get(teamId)?.teamRun.renewActiveLease(leaseId);
  }

  /** Pause a member (附录 II.9 stop button): gate its wakes + cancel its in-flight turn. */
  async pauseMember(teamId: string, slotId: string): Promise<void> {
    const session = this.sessions.get(teamId);
    if (!session) throw new Error(`Team session not active: ${teamId}`);
    // Nothing attached (e.g. the member just failed while the UI still showed it processing):
    // pause would lazily create a gate entry that nothing can ever resume — user messages fail at
    // sendMessageToMember before reaching a foreground wake — so idempotently skip.
    const rt = session.members.get(slotId);
    if (!rt) return;
    session.wakeGate.pause(slotId);
    await this.cancelChildTurn(teamId, slotId);
    if (rt.member.role !== 'lead') {
      this.notifyLeaderMemberInterrupted(teamId, session, rt.member);
    }
  }

  /** Tell the leader one of its teammates was interrupted by the user, so it can re-plan instead
   * of waiting forever for a reply that will never come (mirrors the crash-testament wiring). */
  private notifyLeaderMemberInterrupted(teamId: string, session: TeamSession, member: TeamMember): void {
    const leaderId = this.leaderSlotOrNull(teamId);
    if (!leaderId) return;
    const mailId = uuid(36);
    const { lease } = session.teamRun.acquireWake(leaderId, 'lead', 'member_interrupted');
    try {
      teamStore.insertMail({
        id: mailId,
        team_id: teamId,
        to_member_id: leaderId,
        from_member_id: member.id,
        type: 'message',
        content: `Teammate '${member.name}' was interrupted by the user.`,
        summary: null,
        files: null,
        read: false,
        created_at: Date.now(),
      });
    } catch {
      session.teamRun.abortLease(lease.lease_id);
      return;
    }
    session.teamRun.commitLease(lease.lease_id, { slot_id: leaderId, role: 'lead', source: 'member_interrupted', message_id: mailId });
    this.notifyWake(teamId, leaderId);
  }

  /**
   * Re-attach a failed member's runtime and hand its mailbox backlog back to a run (user "retry
   * start"). Only reachable because every failed path disposes the runtime: all 5 status:'failed'
   * write points either run disposeSlotRuntime (rate-limit ×2, spawn runtime error, and
   * CrashRecovery.handleCrash via its sole caller terminateSlot) or never registered a runtime at
   * all (spawn attach failure). That handleCrash caller-uniqueness keeps failed ⟺ no-runtime
   * bidirectional — a new handleCrash caller that skips dispose would break this retry (the
   * idempotent guard below would return forever).
   */
  async retryMemberStart(teamId: string, slotId: string): Promise<void> {
    const member = teamStore.getMember(slotId);
    if (!member || member.team_id !== teamId) throw new Error(`Member not found: ${slotId}`);
    const session = this.sessions.get(teamId);
    if (!session) throw new Error(`Team session not active: ${teamId}`);
    if (session.members.get(slotId)) return; // already attached — idempotent
    if (!member.conversation_id) throw new Error(`Member has no conversation: ${slotId}`);
    const convResult = getDatabase().getConversation(member.conversation_id);
    if (!convResult.success || !convResult.data) throw new Error(`Failed to load member conversation: ${member.name}`);
    // Refresh the MCP identity triple: a session rebuild rotates port/token and the stored
    // conversation extra may still point at the previous loopback (same rewrite as rebuildTeam).
    const teamMcpConfig = this.buildTeamMcpConfig(session, slotId);
    const nextExtra = Object.assign({}, convResult.data.extra, { teamMcpConfig });
    const updateResult = getDatabase().updateConversation(member.conversation_id, { extra: nextExtra } as Partial<TChatConversation>);
    if (!updateResult.success) throw new Error(updateResult.error || `Failed to update team MCP config for ${member.name}`);
    const updatedResult = getDatabase().getConversation(member.conversation_id);
    if (!updatedResult.success || !updatedResult.data) throw new Error(`Failed to reload member conversation: ${member.name}`);
    // 'bootstrap' failure mode: an attach failure returns false (no leader "spawn aborted" mail —
    // the user is right at the button and receives this error via the bridge envelope instead).
    const attached = await this.attachRuntime(teamId, member, updatedResult.data, session, 'bootstrap');
    if (!attached) throw new Error(`Failed to attach member runtime: ${member.name}`);
    teamStore.updateMember(slotId, { status: 'idle', conversation_id: member.conversation_id });
    const rt = session.members.get(slotId);
    if (rt) rt.member.status = 'idle';
    ipcBridge.team.onAgentStatusChanged.emit({ team_id: teamId, slot_id: slotId, status: 'idle' });
    // Hand the unread backlog back to a run. Both branches are required: with no run record
    // pushPendingWake is a no-op, so only the drain can re-own the backlog; with an active run
    // the drain returns immediately and the slot's pending wake was already cleared by
    // handleSlotCrash — re-seed it so the loop has something to claim.
    new RecoveryDrain(teamId, session.teamRun, (sid) => this.notifyWake(teamId, sid)).drain();
    if (session.teamRun.hasActiveRun() && !session.teamRun.hasPendingWake(slotId) && teamStore.hasUnread(teamId, slotId)) {
      session.teamRun.pushPendingWake(slotId, { slot_id: slotId, role: member.role, source: 'recovery_drain', message_id: null });
      this.notifyWake(teamId, slotId);
    }
  }

  /** Rename a member (附录 II.4): update DB + runtime snapshot + event. Mirrors team_rename_agent. */
  renameMember(teamId: string, memberId: string, name: string): void {
    const target = teamStore.getMember(memberId);
    if (!target || target.team_id !== teamId) throw new Error(`Member not found: ${memberId}`);
    teamStore.updateMember(memberId, { name });
    const rt = this.sessions.get(teamId)?.members.get(memberId);
    if (rt) rt.member.name = name;
    ipcBridge.team.onMemberRenamed.emit({ team_id: teamId, slot_id: memberId, name });
  }

  /** Set the team-level permission mode: persist + propagate to live members + broadcast (new members inherit via spawnMember). */
  async setSessionMode(teamId: string, sessionMode: string): Promise<void> {
    teamStore.updateTeam(teamId, { session_mode: sessionMode });
    // Propagate to existing members: AcpAgent.setMode applies it live and persists it to each
    // member's conversation (rebuild re-applies from there). Per-member failures don't block the rest.
    const session = this.sessions.get(teamId);
    if (session) {
      for (const [, rt] of session.members) {
        try {
          if (rt.agent) await rt.agent.setMode(sessionMode);
        } catch (error) {
          mainWarn('TeamService', `setMode failed for member ${rt.member.id} during setSessionMode:`, error);
        }
      }
    }
    ipcBridge.team.onSessionChanged.emit({ teamId });
  }

  // ---- Team-mcp HTTP loopback (plan §1.5 / §A1) ----

  /** Idempotently ensure a team session exists with its HTTP loopback listening. */
  private async ensureSession(teamId: string): Promise<TeamSession> {
    const existing = this.sessions.get(teamId);
    if (existing) return existing;
    const pending = this.pendingSessionCreates.get(teamId);
    if (pending) return await pending;

    const createPromise = this.createSession(teamId);
    this.pendingSessionCreates.set(teamId, createPromise);
    try {
      return await createPromise;
    } finally {
      this.pendingSessionCreates.delete(teamId);
    }
  }

  private async createSession(teamId: string): Promise<TeamSession> {
    const { server, port, token } = await this.startTeamHttpServer(teamId);
    try {
      if (!this.initialized) {
        server.close();
        throw new Error('TeamService shutting down');
      }
      const wakeGate = new SlotWakeGate();
      const crashRecovery = new CrashRecovery({
        teamId,
        getMember: (slot) => this.lookupMember(teamId, slot),
        leaderSlotId: () => this.leaderSlotOrNull(teamId),
        setStatus: (slot, status, lastMessage) => {
          teamStore.updateMember(slot, { status });
          ipcBridge.team.onAgentStatusChanged.emit({ team_id: teamId, slot_id: slot, status, last_message: lastMessage });
        },
        writeMail: (toMemberId, fromMemberId, type, content) => {
          const id = uuid(36);
          teamStore.insertMail({
            id,
            team_id: teamId,
            to_member_id: toMemberId,
            from_member_id: fromMemberId,
            type,
            content,
            summary: null,
            files: null,
            read: false,
            created_at: Date.now(),
          });
          return id;
        },
        notifyWake: (slot, source, messageId) => this.recordSystemWake(teamId, slot, source, messageId),
        onInactiveTimeout: (slot) => {
          // 60s of silence is suspicious, NOT a confirmed crash (no process-death evidence) —
          // killing here severs healthy in-flight turns (misreported as "连接失败，请检查网络").
          // Real crashes arrive via the disconnected stream event (detectCrash above).
          mainWarn('TeamService', `slot ${slot} inactive for 60s; waiting for stream disconnect before crash recovery`);
        },
      });
      const latestUserMail = teamStore.getLatestUserMail(teamId);
      const session: TeamSession = {
        members: new Map(),
        wakeGate,
        teamRun: new TeamRunManager(teamId, wakeGate),
        crashRecovery,
        pendingShutdowns: new Map(),
        latestUserLanguage: latestUserMail ? detectTeamUserLanguage(latestUserMail.content) : null,
        httpServer: server,
        port,
        token,
      };
      this.sessions.set(teamId, session);
      mainLog('TeamService', `team ${teamId} loopback on 127.0.0.1:${port}`);
      return session;
    } catch (e) {
      server.close();
      throw e;
    }
  }

  private async stopSession(teamId: string): Promise<void> {
    const pending = this.pendingSessionCreates.get(teamId);
    if (pending) {
      try {
        await pending;
      } catch {
        /* pending reject — cleanup below */
      }
    }
    const session = this.sessions.get(teamId);
    if (!session) return;
    const killPromises = [...session.members.values()].map((rt) =>
      rt.agent
        ? rt.agent.kill().catch(() => {
            /* ignore */
          })
        : Promise.resolve()
    );
    for (const [, rt] of session.members) {
      if (rt.eventLoop) await rt.eventLoop.stop();
    }
    await Promise.all(killPromises);
    if (session.httpServer) {
      await new Promise<void>((resolve) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          mainWarn('TeamService', `HTTP server close timed out for team ${teamId}`);
          resolve();
        }, TEAM_SESSION_CLOSE_TIMEOUT_MS);
        session.httpServer!.close(() => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve();
        });
      });
    }
    session.crashRecovery.dispose();
    this.sessions.delete(teamId);
  }

  private startTeamHttpServer(teamId: string): Promise<{ server: http.Server; port: number; token: string }> {
    const token = randomBytes(24).toString('hex');
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        this.handleTeamMcpRequest(teamId, token, req, res).catch((e) => {
          mainError('TeamService', `team-mcp handler error:`, e);
          this.sendJson(res, 500, { ok: false, error: 'internal_error' });
        });
      });
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        const port = addr && typeof addr === 'object' ? (addr as { port: number }).port : 0;
        server.removeListener('error', reject);
        resolve({ server, port, token });
      });
    });
  }

  private async handleTeamMcpRequest(teamId: string, expectedToken: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (req.method !== 'POST' || req.url !== TEAM_MCP_PATH) {
      this.sendJson(res, 404, { ok: false, error: 'not_found' });
      return;
    }
    if (req.headers['authorization'] !== `Bearer ${expectedToken}`) {
      this.sendJson(res, 401, { ok: false, error: 'unauthorized' });
      return;
    }
    let body: string;
    try {
      body = await this.readBody(req);
    } catch {
      this.sendJson(res, 413, { ok: false, error: 'request_body_too_large' });
      return;
    }
    let parsed: { slot_id?: string; tool?: string; args?: Record<string, unknown> };
    try {
      parsed = JSON.parse(body) as { slot_id?: string; tool?: string; args?: Record<string, unknown> };
    } catch {
      this.sendJson(res, 200, { ok: false, error: 'invalid_json' });
      return;
    }
    const { slot_id, tool, args } = parsed;
    if (!slot_id || !tool) {
      this.sendJson(res, 200, { ok: false, error: 'missing slot_id or tool' });
      return;
    }
    // Resolve the caller from slot_id (identity trusted: env injected at session/new, see A1).
    const caller = teamStore.getMember(slot_id);
    if (!caller || caller.team_id !== teamId) {
      this.sendJson(res, 200, { ok: false, error: 'unknown caller' });
      return;
    }
    const result = await this.dispatchTeamTool(teamId, caller, tool, args ?? {});
    this.sendJson(res, 200, result);
  }

  private readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      let aborted = false;
      req.on('data', (chunk: Buffer) => {
        if (aborted) return;
        size += chunk.length;
        if (size > MAX_TEAM_MCP_BODY_BYTES) {
          aborted = true;
          reject(new Error('request_body_too_large'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      req.on('error', reject);
    });
  }

  private sendJson(res: http.ServerResponse, status: number, payload: TeamToolResult | { ok: false; error: string }): void {
    const body = JSON.stringify(payload);
    res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
    res.end(body);
  }

  private async dispatchTeamTool(teamId: string, caller: TeamMember, tool: string, args: Record<string, unknown>): Promise<TeamToolResult> {
    switch (tool) {
      case 'team_send_message':
        return this.toolSendMessage(teamId, caller, args);
      case 'team_spawn_agent':
        return this.toolSpawnAgent(teamId, caller, args);
      case 'team_members':
        return {
          ok: true,
          data: {
            members: teamStore.listMembersByTeam(teamId).map((m) => ({
              slot_id: m.id,
              name: m.name,
              role: m.role,
              status: m.status,
              backend: m.backend,
              model: m.model,
              assistant_id: m.assistant_id ?? '',
              is_delegated: m.isDelegated === true,
            })),
          },
        };
      case 'team_task_create':
      case 'team_task_update':
      case 'team_task_list':
        return this.toolTask(teamId, tool, args);
      case 'team_rename_agent':
        return this.toolRenameAgent(teamId, caller, args);
      case 'team_shutdown_agent':
        return this.toolShutdownAgent(teamId, caller, args);
      case 'team_list_assistants':
        return this.toolListAssistants(args);
      case 'team_describe_assistant':
        return this.toolDescribeAssistant(args);
      case 'team_list_models':
        return this.toolListModels(args);
      default:
        return { ok: false, error: `unknown tool: ${tool}` };
    }
  }

  /** team_send_message: write mailbox (from=caller) under an operation lease per recipient, then wake them. `to="*"` broadcasts to everyone except the caller. */
  private toolSendMessage(teamId: string, caller: TeamMember, args: Record<string, unknown>): TeamToolResult {
    const to = args.to;
    const message = args.message;
    if (typeof to !== 'string' || typeof message !== 'string') {
      return { ok: false, error: 'team_send_message requires string "to" and "message"' };
    }
    const session = this.sessions.get(teamId);
    if (!session) return { ok: false, error: 'team session not active' };

    // Shutdown-protocol interception (附录 I.6): a teammate with a pending shutdown replies with an
    // exact string. These are protocol signals, not delivered messages.
    const interception = this.interceptShutdownReply(teamId, caller, message, session);
    if (interception) return interception;

    const wakeSource: WakeSource = 'mcp_send_message';
    let targets: string[];
    if (to === '*') {
      // Skip failed members: their runtime is disposed (crash / rate-limit / spawn-error), so a
      // seeded pending wake would never be claimed and would strand the run active. New spawns
      // (status 'pending') stay targeted — the attach window must keep receiving broadcasts.
      targets = teamStore
        .listMembersByTeam(teamId)
        .filter((m) => m.id !== caller.id && m.status !== 'failed')
        .map((m) => m.id);
    } else {
      if (to === caller.id) return { ok: false, error: 'cannot send a message to yourself' };
      const recipient = teamStore.getMember(to);
      if (!recipient || recipient.team_id !== teamId) return { ok: false, error: `unknown recipient: ${to}` };
      if (recipient.status === 'failed') return { ok: false, error: `member '${recipient.name}' has failed and cannot receive messages` };
      targets = [to];
    }
    const now = Date.now();
    const deliveredTargets: string[] = [];
    const failedTargets: string[] = [];
    for (const targetId of targets) {
      const recipient = teamStore.getMember(targetId);
      if (!recipient) continue;
      // Operation lease keeps the (already-active) run open until the recipient's wake is claimed.
      const { lease } = session.teamRun.acquireWake(targetId, recipient.role, wakeSource);
      const mailId = uuid(36);
      const mail: TeamMail = {
        id: mailId,
        team_id: teamId,
        to_member_id: targetId,
        from_member_id: caller.id,
        type: 'message',
        content: message,
        summary: null,
        files: null,
        read: false,
        created_at: now,
      };
      try {
        teamStore.insertMail(mail);
        if (caller.role === 'lead' && recipient.role === 'teammate' && to !== '*') {
          teamStore.markMemberDelegated(targetId);
        }
      } catch {
        session.teamRun.abortLease(lease.lease_id);
        failedTargets.push(targetId);
        continue;
      }
      session.teamRun.commitLease(lease.lease_id, { slot_id: targetId, role: recipient.role, source: wakeSource, message_id: mailId });
      this.notifyWake(teamId, targetId);
      deliveredTargets.push(targetId);
    }
    // failed_targets (present only on partial failure) tells the sender exactly who did NOT get the mail.
    const data: { status: string; targets: string[]; failed_targets?: string[] } = { status: 'queued', targets: deliveredTargets };
    if (failedTargets.length > 0) data.failed_targets = failedTargets;
    return { ok: true, data };
  }

  /** team_spawn_agent: Lead-only — non-lead callers are rejected. */
  private async toolSpawnAgent(teamId: string, caller: TeamMember, args: Record<string, unknown>): Promise<TeamToolResult> {
    if (caller.role !== 'lead') return { ok: false, error: 'Only the team lead can spawn agents' };
    const name = args.name;
    const assistantId = args.assistant_id;
    if (typeof name !== 'string' || typeof assistantId !== 'string') {
      return { ok: false, error: 'team_spawn_agent requires string "name" and "assistant_id"' };
    }
    const model = typeof args.model === 'string' ? args.model : undefined;
    const role: 'lead' | 'teammate' | undefined = args.role === 'lead' ? 'lead' : args.role === 'teammate' ? 'teammate' : undefined;
    try {
      const member = await this.spawnMember(teamId, { assistant_id: assistantId, name, model, role });
      return { ok: true, data: { slot_id: member.id, name: member.name, status: member.status } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** team_task_*: Any-team-agent. CRUD over the shared task board (cycle-checked, no wake). */
  private toolTask(teamId: string, tool: string, args: Record<string, unknown>): TeamToolResult {
    const board = new TaskBoard(teamId);
    try {
      switch (tool) {
        case 'team_task_create': {
          const subject = args.subject;
          if (typeof subject !== 'string' || !subject.trim()) return { ok: false, error: 'team_task_create requires a non-empty "subject"' };
          const task = board.createTask({
            subject,
            description: typeof args.description === 'string' ? args.description : null,
            owner: typeof args.owner === 'string' ? args.owner : null,
            blocked_by: Array.isArray(args.blocked_by) ? args.blocked_by.filter((id): id is string => typeof id === 'string') : [],
          });
          return { ok: true, data: task };
        }
        case 'team_task_update': {
          const taskId = args.task_id;
          if (typeof taskId !== 'string') return { ok: false, error: 'team_task_update requires a string "task_id"' };
          // 'deleted' is internal-only (matches the team-mcp tool schema enum); accepting it here
          // would route the update through the dismantleEdges path with a status the caller never means.
          const allowedStatuses = new Set(['pending', 'in_progress', 'completed', 'failed', 'cancelled']);
          if (args.status !== undefined && (typeof args.status !== 'string' || !allowedStatuses.has(args.status))) {
            return { ok: false, error: `invalid status: ${String(args.status)} (allowed: ${[...allowedStatuses].join(', ')})` };
          }
          const updates: Record<string, unknown> = {};
          if (typeof args.status === 'string') updates.status = args.status;
          if (typeof args.description === 'string') updates.description = args.description;
          if (typeof args.owner === 'string') updates.owner = args.owner;
          if (Array.isArray(args.blocked_by)) updates.blocked_by = args.blocked_by.filter((id): id is string => typeof id === 'string');
          const task = board.updateTask(taskId, updates);
          return { ok: true, data: task };
        }
        case 'team_task_list':
          return { ok: true, data: { tasks: board.listTasks() } };
        default:
          return { ok: false, error: `unknown task tool: ${tool}` };
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * team_list_assistants (附录 A2): merge guide-detected agents ∪ installed assistants (deduped,
   * remote-agent dropped, priority-sorted). The merge is a pure function in assistantMerger.ts.
   */
  private async toolListAssistants(_args: Record<string, unknown>): Promise<TeamToolResult> {
    return { ok: true, data: { assistants: await this.listAvailableAssistantsForTeam() } };
  }

  /** team_describe_assistant (附录 A2): return the assistant's rules + skills (for spawn presetContext). */
  private async toolDescribeAssistant(args: Record<string, unknown>): Promise<TeamToolResult> {
    const assistantId = args.assistant_id;
    if (typeof assistantId !== 'string') return { ok: false, error: 'team_describe_assistant requires string "assistant_id"' };
    const lookupName = assistantId.startsWith('builtin-') ? assistantId.slice('builtin-'.length) : assistantId;
    const meta = await assistantManager.getAssistantMeta(lookupName);
    if (!meta) return { ok: false, error: `unknown assistant: ${assistantId}` };
    const locale = typeof args.locale === 'string' ? args.locale : DEFAULT_LOCALE;
    let rules: string | null = null;
    if (meta.ruleFile) {
      try {
        rules = await readAssistantResource('rules', lookupName, locale, ruleFilePattern);
      } catch {
        rules = null;
      }
    }
    return {
      ok: true,
      data: {
        assistant_id: assistantId,
        rules,
        enabled_skills: meta.enabledSkills ?? meta.defaultEnabledSkills ?? [],
        preset_agent_type: meta.presetAgentType ?? null,
        backend: resolvePresetAgentBackend(meta.presetAgentType),
      },
    };
  }

  /** team_list_models (附录 I.6): list model configs for an assistant (or empty). */
  private async toolListModels(args: Record<string, unknown>): Promise<TeamToolResult> {
    const assistantId = args.assistant_id;
    if (typeof assistantId === 'string') {
      const lookupName = assistantId.startsWith('builtin-') ? assistantId.slice('builtin-'.length) : assistantId;
      const meta = await assistantManager.getAssistantMeta(lookupName);
      if (meta?.modelConfigs) {
        return { ok: true, data: { assistant_id: assistantId, models: Object.keys(meta.modelConfigs) } };
      }
      // Resolve the backend from the same candidates team_list_assistants returns: the meta lookup
      // fails for ids that differ from their directory name, and bare agent entries have no assistant dir.
      const candidate = (await this.listAvailableAssistantsForTeam()).find((item) => item.assistant_id === assistantId);
      if (candidate?.backend === 'scode') {
        const info = getScodeProxyModelInfoSync();
        return { ok: true, data: { assistant_id: assistantId, models: info?.availableModels.map((m) => m.id) ?? [], default_model: info?.currentModelId ?? null } };
      }
      if (candidate?.backend === 'claude') {
        // Claude's model list only exists on a live ACP connection (post-spawn); an empty list tells
        // the leader to omit model so the member uses the CLI default.
        return { ok: true, data: { assistant_id: assistantId, models: [], default_model: null } };
      }
      if (meta) return { ok: true, data: { assistant_id: assistantId, models: [] } };
      return { ok: false, error: `unknown assistant: ${assistantId}` };
    }
    return { ok: true, data: { models: [] } };
  }

  /** team_rename_agent: Lead-only — renames a member (DB + runtime snapshot + event). */
  private toolRenameAgent(teamId: string, caller: TeamMember, args: Record<string, unknown>): TeamToolResult {
    if (caller.role !== 'lead') return { ok: false, error: 'Only the team lead can rename agents' };
    const slotId = args.slot_id;
    const newName = args.new_name;
    if (typeof slotId !== 'string' || typeof newName !== 'string' || !newName.trim()) {
      return { ok: false, error: 'team_rename_agent requires string "slot_id" and non-empty "new_name"' };
    }
    const target = teamStore.getMember(slotId);
    if (!target || target.team_id !== teamId) return { ok: false, error: `unknown member: ${slotId}` };
    teamStore.updateMember(slotId, { name: newName });
    // Mutate the runtime snapshot in place so the member's EventLoop (which holds the same ref) sees the new name.
    const rt = this.sessions.get(teamId)?.members.get(slotId);
    if (rt) rt.member.name = newName;
    ipcBridge.team.onMemberRenamed.emit({ team_id: teamId, slot_id: slotId, name: newName });
    return { ok: true, data: { slot_id: slotId, name: newName } };
  }

  /** team_shutdown_agent: Lead-only — initiates the graceful shutdown protocol (附录 I.6). */
  private toolShutdownAgent(teamId: string, caller: TeamMember, args: Record<string, unknown>): TeamToolResult {
    if (caller.role !== 'lead') return { ok: false, error: 'Only the team lead can shutdown agents' };
    const targetId = args.slot_id;
    if (typeof targetId !== 'string') return { ok: false, error: 'team_shutdown_agent requires string "slot_id"' };
    const target = teamStore.getMember(targetId);
    if (!target || target.team_id !== teamId) return { ok: false, error: `unknown member: ${targetId}` };
    if (target.role === 'lead') return { ok: false, error: 'cannot shutdown the team lead' };
    // Failed members have no live runtime — a shutdown wake for them would never be claimed.
    if (target.status === 'failed') return { ok: false, error: `member '${target.name}' has failed and cannot be shut down` };
    const session = this.sessions.get(teamId);
    if (!session) return { ok: false, error: 'team session not active' };
    const reason = typeof args.reason === 'string' ? args.reason : null;

    // Track the pending shutdown so the teammate's reply can be intercepted.
    session.pendingShutdowns.set(targetId, reason);
    // Lifecycle wake (mcp_shutdown_request bypasses pause): write shutdown_request + wake the target.
    const { lease } = session.teamRun.acquireWake(targetId, target.role, 'mcp_shutdown_request');
    const mailId = uuid(36);
    try {
      teamStore.insertMail({
        id: mailId,
        team_id: teamId,
        to_member_id: targetId,
        from_member_id: caller.id,
        type: 'shutdown_request',
        content: reason
          ? `Lead requested shutdown: ${reason}. To agree, reply via team_send_message with exactly: shutdown_approved. To refuse, reply with: shutdown_rejected: <your reason>.`
          : 'Lead requested shutdown. To agree, reply via team_send_message with exactly: shutdown_approved. To refuse, reply with: shutdown_rejected: <your reason>.',
        summary: null,
        files: null,
        read: false,
        created_at: Date.now(),
      });
    } catch {
      session.teamRun.abortLease(lease.lease_id);
      session.pendingShutdowns.delete(targetId);
      return { ok: false, error: 'failed to write shutdown request' };
    }
    session.teamRun.commitLease(lease.lease_id, { slot_id: targetId, role: target.role, source: 'mcp_shutdown_request', message_id: mailId });
    this.notifyWake(teamId, targetId);
    return { ok: true, data: { status: 'shutdown_requested', slot_id: targetId } };
  }

  /**
   * Shutdown-protocol reply interception (附录 I.6). Returns a result when the caller (with a pending
   * shutdown) replies with the exact protocol string; otherwise null to continue normal delivery.
   * - 'shutdown_approved' → after 500ms, remove the agent.
   * - 'shutdown_rejected:<reason>' → write the reason to the leader and wake it.
   */
  private interceptShutdownReply(teamId: string, caller: TeamMember, message: string, session: TeamSession): TeamToolResult | null {
    if (!session.pendingShutdowns.has(caller.id)) return null;
    if (message.trim() === 'shutdown_approved') {
      session.pendingShutdowns.delete(caller.id);
      const targetId = caller.id;
      const capturedSession = session;
      const handle = setTimeout(() => {
        if (this.sessions.get(teamId) !== capturedSession) return;
        this.removeMember(teamId, targetId).catch((e) => mainWarn('TeamService', 'shutdown-triggered remove failed:', e));
      }, 500);
      handle.unref?.();
      return { ok: true, data: { status: 'shutdown_approved_received', slot_id: targetId } };
    }
    const rejectedPrefix = 'shutdown_rejected:';
    if (message.trim().startsWith(rejectedPrefix)) {
      const reason = message.trim().slice(rejectedPrefix.length);
      session.pendingShutdowns.delete(caller.id);
      const leaderId = this.leaderSlotOrNull(teamId);
      if (leaderId) {
        const { lease } = session.teamRun.acquireWake(leaderId, 'lead', 'shutdown_rejected');
        const mailId = uuid(36);
        try {
          teamStore.insertMail({
            id: mailId,
            team_id: teamId,
            to_member_id: leaderId,
            from_member_id: caller.id,
            type: 'message',
            content: `Teammate '${caller.name}' rejected shutdown: ${reason}`,
            summary: null,
            files: null,
            read: false,
            created_at: Date.now(),
          });
        } catch {
          session.teamRun.abortLease(lease.lease_id);
          return { ok: true, data: { status: 'shutdown_rejected', reason } };
        }
        session.teamRun.commitLease(lease.lease_id, { slot_id: leaderId, role: 'lead', source: 'shutdown_rejected', message_id: mailId });
        this.notifyWake(teamId, leaderId);
      }
      return { ok: true, data: { status: 'shutdown_rejected', reason } };
    }
    return null;
  }

  // ---- helpers ----

  private notifyWake(teamId: string, slotId: string): void {
    this.sessions.get(teamId)?.members.get(slotId)?.eventLoop?.notifyWake();
  }

  private recordSystemWake(teamId: string, slotId: string, source: WakeSource, messageId?: string | null): void {
    const session = this.sessions.get(teamId);
    if (!session) return;
    const member = teamStore.getMember(slotId);
    if (!member || member.team_id !== teamId) return;
    // Failed targets have no live runtime (failed ⟺ no-runtime invariant: every failed write
    // disposes the runtime or never registered one). acquireWake would unconditionally create a
    // new run for them whose pending wake nobody claims, stranding it active forever. This path
    // writes no mail itself — the crash testament was already written by handleCrash — so
    // skipping only drops an unconsumable wake, no message is lost.
    if (member.status === 'failed') return;
    if (source === 'idle_notification' && member.role === 'lead' && !this.shouldWakeLeaderAfterIdle(teamId, slotId)) {
      return;
    }
    const { lease } = session.teamRun.acquireWake(slotId, member.role, source);
    session.teamRun.commitLease(lease.lease_id, { slot_id: slotId, role: member.role, source, message_id: messageId ?? null });
    this.notifyWake(teamId, slotId);
  }

  private shouldWakeLeaderAfterIdle(teamId: string, leaderSlotId: string): boolean {
    if (!teamStore.getLatestUserMail(teamId)) return false;
    const members = teamStore.listMembersByTeam(teamId);
    const leader = members.find((m) => m.id === leaderSlotId && m.role === 'lead');
    if (!leader || leader.status === 'failed' || leader.status === 'error' || leader.status === 'completed') return false;
    const teammates = members.filter((m) => m.role === 'teammate');
    if (teammates.length === 0) return false;
    const settledStatuses = new Set(['idle', 'completed', 'failed', 'error']);
    return teammates.every((m) => settledStatuses.has(m.status));
  }

  private lookupMember(teamId: string, slotId: string): TeamMember | null {
    const rt = this.sessions.get(teamId)?.members.get(slotId);
    return rt ? rt.member : teamStore.getMember(slotId);
  }

  private getRuntime(teamId: string, slotId: string): MemberRuntime | undefined {
    return this.sessions.get(teamId)?.members.get(slotId);
  }

  private sanitizeQuestionAnswers(answers: Array<{ id: string; value: string; label?: string }>): Array<{ id: string; value: string; label?: string }> {
    if (!Array.isArray(answers) || answers.length === 0) throw new Error('answers must be a non-empty array');
    return answers.map((entry) => {
      if (!entry || typeof entry !== 'object') throw new Error('Invalid answer entry');
      if (typeof entry.id !== 'string' || !entry.id.trim()) throw new Error('Answer is missing id');
      if (typeof entry.value !== 'string') throw new Error(`Answer ${entry.id} value must be a string`);
      const sanitized: { id: string; value: string; label?: string } = { id: entry.id.trim(), value: entry.value };
      if (typeof entry.label === 'string') sanitized.label = entry.label;
      return sanitized;
    });
  }

  private leaderSlot(teamId: string): string {
    const lead = teamStore.listMembersByTeam(teamId).find((m) => m.role === 'lead');
    if (!lead) throw new Error('Team has no leader');
    return lead.id;
  }

  private leaderSlotOrNull(teamId: string): string | null {
    return teamStore.listMembersByTeam(teamId).find((m) => m.role === 'lead')?.id ?? null;
  }
}

// Singleton — mirrors CronService (no ServiceManager, module-level import deps).
export const teamService = new TeamService();
// Re-export for callers that also need the database handle.
export { getDatabase };
// Internal types re-exported for tests.
export type { TeamToolResult, MemberRuntime, TeamSession };
