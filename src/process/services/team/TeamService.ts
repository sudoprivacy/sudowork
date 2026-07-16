import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'node:http';
import { randomBytes } from 'node:crypto';
import { ipcBridge } from '@/common';
import type { IResponseMessage, ITeam, ITeamAssistantCandidate, ITeamMember, ITeamRunAck, ITeamRunState } from '@/common/ipcBridge';
import type { TChatConversation } from '@/common/storage';
import { uuid } from '@/common/utils';
import { getDatabase } from '@process/database';
import WorkerManage from '@process/WorkerManage';
import { assistantManager } from '@/process/AssistantManager';
import { resolvePresetAgentBackend, type PresetAgentType } from '@/types/acpTypes';
import { readAssistantResource, ruleFilePattern } from '@process/utils/assistantResources';
import { mainLog, mainWarn, mainError } from '@process/utils/mainLogger';
import type AcpAgent from '@process/task/AcpAgent';
import { acpDetector } from '@/agent/acp/AcpDetector';
import { getNodeBinaryPath } from '@process/services/claudeCli/NodeRuntimeService';
import { createConversation } from '../conversationService';
import { reapConversation, resolveWorkspaceDeletion } from '../conversationReaper';
import { teamStore, type Team, type TeamMail, type TeamMember, type TeamWorkspaceKind } from './TeamStore';
import { buildGovernancePrompt } from './GovernancePrompt';
import { EventLoop } from './EventLoop';
import { TeamRunManager } from './TeamRun';
import { RecoveryDrain } from './RecoveryDrain';
import { TaskBoard } from './TaskBoard';
import { CrashRecovery } from './CrashRecovery';
import { mergeTeamAssistants, type DetectedAgentLike, type InstalledAssistantLike } from './assistantMerger';
import { SlotWakeGate } from './SlotWakeGate';
import type { WakeSource } from './WakeSource';

const DEFAULT_LOCALE = 'en-US';
/** Soft cap on concurrent member processes (each member = one CLI subprocess). */
const MAX_TEAM_MEMBERS = 8;
/** Per-frame body cap for the team-mcp HTTP loopback (plan §I.6). */
const MAX_TEAM_MCP_BODY_BYTES = 64 * 1024 * 1024;
const TEAM_MCP_PATH = '/team-mcp';
const TEAM_MCP_SERVER_NAME = 'team-mcp';

type TeamToolResult = { ok: true; data: unknown } | { ok: false; error: string };

interface MemberRuntime {
  member: TeamMember;
  agent: AcpAgent | null;
  eventLoop: EventLoop | null;
}

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
  private streamUnsubscribe: (() => void) | null = null;

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    // Crash detection (附录 §1.6): subscribe to the shared responseStream — AcpAgent owns its
    // connection callbacks, so TeamService watches the emitted stream for disconnected/error.
    this.streamUnsubscribe = ipcBridge.acpConversation.responseStream.on((msg) => this.handleResponseStream(msg));
    mainLog('TeamService', 'initialized');
  }

  cleanup(): void {
    this.streamUnsubscribe?.();
    this.streamUnsubscribe = null;
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
    this.initialized = false;
  }

  /** Route a responseStream event to the owning member's crash recovery (reset watchdog + detect). */
  private handleResponseStream(msg: IResponseMessage): void {
    const found = this.findMemberByConversation(msg.conversation_id);
    if (!found) return;
    const session = this.sessions.get(found.teamId);
    if (!session) return;
    session.crashRecovery.resetWakeTimeout(found.slotId);
    const streamErrorText = this.extractStreamErrorText(msg);
    const reason = session.crashRecovery.detectCrash({ type: msg.type, content: (msg.data as { status?: string; error?: string } | null) ?? undefined });
    const isLeader = session.members.get(found.slotId)?.member.role === 'lead';
    if (!reason) {
      if (streamErrorText && session.crashRecovery.isRateLimited({ kind: 'Unknown', msg: streamErrorText })) {
        teamStore.updateMember(found.slotId, { status: 'failed' });
        ipcBridge.team.onAgentStatusChanged.emit({ team_id: found.teamId, slot_id: found.slotId, status: 'failed', last_message: 'rate limited' });
        session.teamRun.handleSlotCrash(found.slotId, isLeader);
      }
      return;
    }
    if (session.crashRecovery.isRateLimited(reason)) {
      // 429 / quota → mark failed, no crash recovery (no testament / no kill).
      teamStore.updateMember(found.slotId, { status: 'failed' });
      ipcBridge.team.onAgentStatusChanged.emit({ team_id: found.teamId, slot_id: found.slotId, status: 'failed', last_message: 'rate limited' });
      session.teamRun.handleSlotCrash(found.slotId, isLeader);
      return;
    }
    // Clean up TeamRun state (appendix I.1 / 事实 9): a crashed slot's pending wake would otherwise
    // strand the run active; a leader crash must fail the run. Also stop the dead member's loop so
    // it does not retry a crashed agent.
    session.teamRun.handleSlotCrash(found.slotId, isLeader);
    session.crashRecovery.handleCrash(found.slotId, reason);
    const rt = session.members.get(found.slotId);
    if (rt?.eventLoop) void rt.eventLoop.stop();
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

  async createTeam(userId: string, name: string, workspace: string | null, leaderAssistantId: string, leaderName?: string, leaderModel?: string): Promise<Team> {
    const now = Date.now();
    const teamId = uuid();
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
      const leader = await this.spawnMember(teamId, {
        assistant_id: leaderAssistantId,
        name: leaderName || name,
        conversationName: name,
        model: leaderModel,
        role: 'lead',
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

      // Recovery drain: re-deliver any unread mailbox backlog at session start (no-op for a fresh team).
      const session = this.sessions.get(teamId);
      if (session) {
        new RecoveryDrain(teamId, session.teamRun, (sid) => this.notifyWake(teamId, sid)).drain();
      }

      ipcBridge.team.onListChanged.emit({ team_id: teamId, action: 'created' });
      return teamStore.getTeam(teamId) ?? { ...team, ...updates, updated_at: Date.now() };
    } catch (error) {
      await this.rollbackInsertedTeam(teamId);
      throw error;
    }
  }

  async spawnMember(teamId: string, params: { assistant_id: string; name: string; conversationName?: string; model?: string; role?: 'lead' | 'teammate' }): Promise<TeamMember> {
    const team = teamStore.getTeam(teamId);
    if (!team) throw new Error(`Team not found: ${teamId}`);
    const role = params.role || 'teammate';

    const existing = teamStore.listMembersByTeam(teamId);
    if (existing.length >= MAX_TEAM_MEMBERS) throw new Error(`Team full (max ${MAX_TEAM_MEMBERS})`);
    if (role === 'lead' && existing.some((m) => m.role === 'lead')) throw new Error('Team already has a leader');

    // assistant_id -> meta -> backend / presetContext / enabledSkills (A2)
    const lookupName = params.assistant_id.startsWith('builtin-') ? params.assistant_id.slice('builtin-'.length) : params.assistant_id;
    const meta = await assistantManager.getAssistantMeta(lookupName);
    const presetAgentType = meta?.presetAgentType;
    const backend = resolvePresetAgentBackend(presetAgentType);
    const enabledSkills = meta?.enabledSkills ?? [];
    let rulesText: string | null = null;
    if (meta?.ruleFile) {
      try {
        rulesText = await readAssistantResource('rules', lookupName, DEFAULT_LOCALE, ruleFilePattern);
      } catch {
        mainWarn('TeamService', `Failed to read rules for assistant ${lookupName}`);
      }
    }
    // A3: assistant rules + team governance (soft guidance), injected as presetContext.
    const governance = buildGovernancePrompt(role, team.name, params.name);
    const presetContext = [rulesText, governance].filter(Boolean).join('\n\n') || null;

    const slotId = uuid();

    // Ensure the per-team HTTP loopback is up so we can hand the member its identity triple.
    const session = await this.ensureSession(teamId);
    const teamMcpConfig = {
      name: TEAM_MCP_SERVER_NAME,
      command: getNodeBinaryPath(),
      args: [getTeamMcpScriptPath()],
      env: [
        { name: 'TEAM_MCP_PORT', value: String(session.port) },
        { name: 'TEAM_MCP_TOKEN', value: session.token },
        { name: 'TEAM_MCP_SLOT_ID', value: slotId },
      ],
    };

    const isResolvingInitialTeamWorkspace = role === 'lead' && !team.workspace && !team.workspace_kind;
    if (!isResolvingInitialTeamWorkspace && !team.workspace) throw new Error(`Team workspace is not resolved: ${teamId}`);
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
        teamId,
        teamMcpConfig,
        // Inherit the team's permission mode (new members adopt it; existing members are not retro-changed —
        // AcpAgent exposes no public mode setter, so live propagation is left to a future AcpAgent API).
        sessionMode: team.session_mode ?? undefined,
      },
    });
    if (!createResult.success || !createResult.conversation) {
      throw new Error(createResult.error || 'Failed to create member conversation');
    }
    const conversationId = createResult.conversation.id;

    const member: TeamMember = {
      id: slotId,
      team_id: teamId,
      role,
      name: params.name,
      assistant_id: params.assistant_id,
      backend,
      preset_agent_type: (presetAgentType as PresetAgentType | undefined) || null,
      skills: enabledSkills,
      preset_context: presetContext,
      model: params.model || null,
      avatar: meta?.avatar || null,
      conversation_id: conversationId,
      status: 'pending',
      created_at: Date.now(),
    };
    try {
      teamStore.insertMember(member);
    } catch (error) {
      await reapConversation(conversationId, { reason: 'team-spawn-rollback', deleteWorkspace: false });
      throw error;
    }

    // Attach the member runtime (build AcpAgent + event loop). Per 事实 8 an attach failure does NOT
    // roll back — the member stays so the leader sees it failed, and is notified via spawn_attach_failure.
    const attached = await this.attachRuntime(teamId, member, createResult.conversation, session);
    if (!attached) {
      const failed = teamStore.getMember(slotId) ?? member;
      ipcBridge.team.onMemberSpawned.emit({ team_id: teamId, member: toMemberIPC(failed) });
      return failed;
    }

    teamStore.updateMember(slotId, { status: 'idle', conversation_id: conversationId });

    // Welcome a new teammate (附录 §1.3 / I.2 spawn_welcome): a lifecycle wake for an introductory
    // turn. Per 事实 8 a welcome-write failure fully rolls back the slot. The leader needs no welcome.
    if (role === 'teammate') {
      const welcomeFrom = this.leaderSlotOrNull(teamId) ?? 'user';
      const welcomeId = uuid();
      try {
        teamStore.insertMail({
          id: welcomeId,
          team_id: teamId,
          to_member_id: slotId,
          from_member_id: welcomeFrom,
          type: 'message',
          content: `Welcome to team "${team.name}". You are a teammate named '${params.name}'. Wait for the leader to assign work and coordinate only via the team_* tools.`,
          summary: null,
          files: null,
          read: false,
          created_at: Date.now(),
        });
      } catch (e) {
        // welcome write failed → full rollback (事实 8)
        await this.removeMember(teamId, slotId);
        throw e;
      }
      const { lease } = session.teamRun.acquireWake(slotId, role, 'spawn_welcome');
      session.teamRun.commitLease(lease.lease_id, { slot_id: slotId, role, source: 'spawn_welcome', message_id: welcomeId });
      this.notifyWake(teamId, slotId);
    }

    ipcBridge.team.onMemberSpawned.emit({ team_id: teamId, member: toMemberIPC(member) });
    return member;
  }

  /**
   * Build a member's AcpAgent + event loop and register it (shared by spawn + rebuild). Per 事实 8,
   * an attach failure (buildConversation returns null) does NOT roll back: the member is marked
   * failed, the leader is notified via a spawn_attach_failure wake, and no event loop is started
   * (so it never retries a null agent). Returns true when attached.
   */
  private async attachRuntime(teamId: string, member: TeamMember, conversation: TChatConversation, session: TeamSession): Promise<boolean> {
    const task = WorkerManage.buildConversation(conversation, { skipCache: true });
    const agent = (task ?? null) as unknown as AcpAgent | null;
    if (!agent) {
      teamStore.updateMember(member.id, { status: 'failed' });
      ipcBridge.team.onAgentStatusChanged.emit({ team_id: teamId, slot_id: member.id, status: 'failed', last_message: 'attach failed' });
      const leaderId = this.leaderSlotOrNull(teamId);
      if (leaderId) {
        const mailId = uuid();
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
      leaderSlotId: () => this.leaderSlot(teamId),
      onWakeSlot: (targetSlot, source, messageId) => this.recordSystemWake(teamId, targetSlot, source, messageId),
      lookupMember: (sid) => this.lookupMember(teamId, sid),
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
    if (this.sessions.has(teamId)) return; // already active
    const session = await this.ensureSession(teamId);
    const members = teamStore.listMembersByTeam(teamId);
    for (const m of members) {
      if (!m.conversation_id) continue;
      const convResult = getDatabase().getConversation(m.conversation_id);
      if (!convResult.success || !convResult.data) continue;
      await this.attachRuntime(teamId, m, convResult.data, session);
    }
    new RecoveryDrain(teamId, session.teamRun, (sid) => this.notifyWake(teamId, sid)).drain();
    mainLog('TeamService', `rebuilt team ${teamId} (${members.length} member(s))`);
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

  /** User message to a specific member (writes mailbox from=user under an operation lease, then wakes the loop). */
  async sendMessageToMember(teamId: string, slotId: string, input: string, files?: string[], msgId?: string): Promise<ITeamRunAck> {
    const team = teamStore.getTeam(teamId);
    if (!team) throw new Error(`Team not found: ${teamId}`);
    const runtime = this.getRuntime(teamId, slotId);
    if (!runtime) throw new Error(`Member not found: ${slotId}`);
    const session = this.sessions.get(teamId);
    if (!session) throw new Error(`Team session not active: ${teamId}`);

    const mailId = msgId || uuid();
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

  private async rollbackInsertedTeam(teamId: string): Promise<void> {
    try {
      await this.stopSession(teamId);
      for (const member of teamStore.listMembersByTeam(teamId)) {
        if (member.conversation_id) {
          await reapConversation(member.conversation_id, { reason: 'team-spawn-rollback', deleteWorkspace: false });
        }
      }
      teamStore.softDeleteMembersByTeam(teamId);
      teamStore.softDeleteTeam(teamId);
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
    await this.removeTeamWorkspace(team, deleteWorkspace);
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
    if (team.workspace_kind === 'temporary') {
      if (!resolveWorkspaceDeletion(team.workspace, false, undefined)) return;
    } else if (!resolveWorkspaceDeletion(team.workspace, true, deleteWorkspace)) {
      return;
    }

    await fs.promises.rm(team.workspace, { recursive: true, force: true });
  }

  async removeMember(teamId: string, slotId: string): Promise<void> {
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
    teamStore.softDeleteMember(slotId);
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
    session.teamRun.beginCancel(reason);
    // Mark every member's unread mailbox read — cancelled work must not be re-delivered on restart.
    for (const m of teamStore.listMembersByTeam(teamId)) {
      const unread = teamStore.peekUnread(teamId, m.id);
      if (unread.length > 0) teamStore.markReadBatch(unread.map((u) => u.id));
    }
    // Cancel each in-flight child turn (stop the agent + record cancelled).
    const activeSlots = [...(session.teamRun.getRecord()?.active_child_turns.keys() ?? [])];
    for (const slotId of activeSlots) {
      void this.cancelChildTurn(teamId, slotId);
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
    if (!session) return;
    session.wakeGate.pause(slotId);
    await this.cancelChildTurn(teamId, slotId);
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

  /** Set the team-level permission mode: persist + broadcast (new members inherit via spawnMember). */
  setSessionMode(teamId: string, sessionMode: string): void {
    teamStore.updateTeam(teamId, { session_mode: sessionMode });
    ipcBridge.team.onSessionChanged.emit({ teamId });
  }

  // ---- Team-mcp HTTP loopback (plan §1.5 / §A1) ----

  /** Idempotently ensure a team session exists with its HTTP loopback listening. */
  private async ensureSession(teamId: string): Promise<TeamSession> {
    const existing = this.sessions.get(teamId);
    if (existing) return existing;
    const { server, port, token } = await this.startTeamHttpServer(teamId);
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
        const id = uuid();
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
    });
    const session: TeamSession = {
      members: new Map(),
      wakeGate,
      teamRun: new TeamRunManager(teamId, wakeGate),
      crashRecovery,
      pendingShutdowns: new Map(),
      httpServer: server,
      port,
      token,
    };
    this.sessions.set(teamId, session);
    mainLog('TeamService', `team ${teamId} loopback on 127.0.0.1:${port}`);
    return session;
  }

  private async stopSession(teamId: string): Promise<void> {
    const session = this.sessions.get(teamId);
    if (!session) return;
    for (const [, rt] of session.members) {
      if (rt.eventLoop) await rt.eventLoop.stop();
      if (rt.agent)
        rt.agent.kill().catch(() => {
          /* ignore */
        });
    }
    if (session.httpServer) {
      await new Promise<void>((resolve) => {
        session.httpServer!.close(() => resolve());
      });
    }
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
      targets = teamStore
        .listMembersByTeam(teamId)
        .filter((m) => m.id !== caller.id)
        .map((m) => m.id);
    } else {
      const recipient = teamStore.getMember(to);
      if (!recipient || recipient.team_id !== teamId) return { ok: false, error: `unknown recipient: ${to}` };
      targets = [to];
    }
    const now = Date.now();
    for (const targetId of targets) {
      const recipient = teamStore.getMember(targetId);
      if (!recipient) continue;
      // Operation lease keeps the (already-active) run open until the recipient's wake is claimed.
      const { lease } = session.teamRun.acquireWake(targetId, recipient.role, wakeSource);
      const mailId = uuid();
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
      } catch {
        session.teamRun.abortLease(lease.lease_id);
        continue;
      }
      session.teamRun.commitLease(lease.lease_id, { slot_id: targetId, role: recipient.role, source: wakeSource, message_id: mailId });
      this.notifyWake(teamId, targetId);
    }
    return { ok: true, data: { status: 'queued', targets } };
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
      if (!meta) return { ok: false, error: `unknown assistant: ${assistantId}` };
      const models = meta.modelConfigs ? Object.keys(meta.modelConfigs) : [];
      return { ok: true, data: { assistant_id: assistantId, models } };
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
    const session = this.sessions.get(teamId);
    if (!session) return { ok: false, error: 'team session not active' };
    const reason = typeof args.reason === 'string' ? args.reason : null;

    // Track the pending shutdown so the teammate's reply can be intercepted.
    session.pendingShutdowns.set(targetId, reason);
    // Lifecycle wake (mcp_shutdown_request bypasses pause): write shutdown_request + wake the target.
    const { lease } = session.teamRun.acquireWake(targetId, target.role, 'mcp_shutdown_request');
    const mailId = uuid();
    try {
      teamStore.insertMail({
        id: mailId,
        team_id: teamId,
        to_member_id: targetId,
        from_member_id: caller.id,
        type: 'shutdown_request',
        content: reason ? `Lead requested shutdown: ${reason}` : 'Lead requested shutdown.',
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
    if (message === 'shutdown_approved') {
      session.pendingShutdowns.delete(caller.id);
      const targetId = caller.id;
      // Delay 500ms so the MCP response reaches the agent before it is killed.
      setTimeout(() => {
        void this.removeMember(teamId, targetId);
      }, 500);
      return { ok: true, data: { status: 'shutdown_approved_received', slot_id: targetId } };
    }
    const rejectedPrefix = 'shutdown_rejected:';
    if (message.startsWith(rejectedPrefix)) {
      const reason = message.slice(rejectedPrefix.length);
      session.pendingShutdowns.delete(caller.id);
      const leaderId = this.leaderSlotOrNull(teamId);
      if (leaderId) {
        const { lease } = session.teamRun.acquireWake(leaderId, 'lead', 'shutdown_rejected');
        const mailId = uuid();
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
    if (source === 'idle_notification' && member.role === 'lead' && !this.shouldWakeLeaderAfterIdle(teamId, slotId)) {
      return;
    }
    const { lease } = session.teamRun.acquireWake(slotId, member.role, source);
    session.teamRun.commitLease(lease.lease_id, { slot_id: slotId, role: member.role, source, message_id: messageId ?? null });
    this.notifyWake(teamId, slotId);
  }

  private shouldWakeLeaderAfterIdle(teamId: string, leaderSlotId: string): boolean {
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
