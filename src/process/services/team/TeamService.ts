import { ipcBridge } from '@/common';
import type { ITeamMember, ITeamRunAck } from '@/common/ipcBridge';
import { uuid } from '@/common/utils';
import { getDatabase } from '@process/database';
import WorkerManage from '@process/WorkerManage';
import { assistantManager } from '@/process/AssistantManager';
import { resolvePresetAgentBackend, type PresetAgentType } from '@/types/acpTypes';
import { readAssistantResource, ruleFilePattern } from '@process/utils/assistantResources';
import { mainLog, mainWarn, mainError } from '@process/utils/mainLogger';
import type AcpAgent from '@process/task/AcpAgent';
import { createConversation } from '../conversationService';
import { teamStore, type Team, type TeamMember, type TeamMail } from './TeamStore';

const DEFAULT_LOCALE = 'en-US';
/** Soft cap on concurrent member processes (each member = one CLI subprocess). */
const MAX_TEAM_MEMBERS = 8;

interface MemberRuntime {
  member: TeamMember;
  agent: AcpAgent | null;
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
 * holds a map of slot_id -> MemberRuntime (AcpAgent + state). Stage 1 ships a
 * minimal single-member turn loop; full EventLoop / Mailbox / TeamRun land in later stages.
 */
class TeamService {
  private initialized = false;
  private sessions = new Map<string, Map<string, MemberRuntime>>();

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    mainLog('TeamService', 'initialized');
  }

  cleanup(): void {
    for (const [, members] of this.sessions) {
      for (const [, rt] of members) {
        if (rt.agent)
          rt.agent.kill().catch(() => {
            /* ignore */
          });
      }
    }
    this.sessions.clear();
    this.initialized = false;
  }

  async createTeam(userId: string, name: string, workspace: string | null, leaderAssistantId: string, leaderName?: string, leaderModel?: string): Promise<Team> {
    const now = Date.now();
    const teamId = uuid();
    const team: Team = {
      id: teamId,
      user_id: userId,
      name,
      workspace,
      leader_member_id: null,
      session_mode: null,
      created_at: now,
      updated_at: now,
    };
    teamStore.insertTeam(team);

    const leader = await this.spawnMember(teamId, {
      assistant_id: leaderAssistantId,
      name: leaderName || name,
      model: leaderModel,
      role: 'lead',
    });
    teamStore.updateTeam(teamId, { leader_member_id: leader.id });

    ipcBridge.team.onListChanged.emit({ team_id: teamId, action: 'created' });
    return { ...team, leader_member_id: leader.id, updated_at: Date.now() };
  }

  async spawnMember(teamId: string, params: { assistant_id: string; name: string; model?: string; role?: 'lead' | 'teammate' }): Promise<TeamMember> {
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
    let presetContext: string | null = null;
    if (meta?.ruleFile) {
      try {
        presetContext = await readAssistantResource('rules', lookupName, DEFAULT_LOCALE, ruleFilePattern);
      } catch {
        mainWarn('TeamService', `Failed to read rules for assistant ${lookupName}`);
      }
    }

    const slotId = uuid();
    // Stage 1: per-member team-mcp bridge injection is wired (A1) but the team-mcp server itself
    // ships with later stages; Leader running a plain user message does not need it yet.

    const createResult = await createConversation({
      type: 'acp',
      name: params.name,
      extra: {
        backend,
        workspace: team.workspace || undefined,
        customWorkspace: true,
        presetAssistantId: params.assistant_id,
        presetContext: presetContext || undefined,
        enabledSkills,
        agentName: params.name,
        isTeamMember: true,
        teamId,
      },
    });
    if (!createResult.success || !createResult.conversation) {
      throw new Error(createResult.error || 'Failed to create member conversation');
    }
    const conversationId = createResult.conversation.id;

    const now = Date.now();
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
      created_at: now,
    };
    teamStore.insertMember(member);

    // Build an independent AcpAgent (skipCache keeps it out of the shared task list).
    const task = WorkerManage.buildConversation(createResult.conversation, { skipCache: true });
    const agent = (task ?? null) as unknown as AcpAgent | null;
    this.ensureSession(teamId).set(slotId, { member: { ...member }, agent });
    teamStore.updateMember(slotId, { status: 'idle', conversation_id: conversationId });

    ipcBridge.team.onMemberSpawned.emit({ team_id: teamId, member: toMemberIPC(member) });
    return member;
  }

  /** User message to the team leader. */
  async sendMessage(teamId: string, input: string, files?: string[], msgId?: string): Promise<ITeamRunAck> {
    return this.sendMessageToMember(teamId, this.leaderSlot(teamId), input, files, msgId);
  }

  /** User message to a specific member (writes mailbox from=user, then runs the member turn). */
  async sendMessageToMember(teamId: string, slotId: string, input: string, files?: string[], msgId?: string): Promise<ITeamRunAck> {
    const team = teamStore.getTeam(teamId);
    if (!team) throw new Error(`Team not found: ${teamId}`);
    const runtime = this.getRuntime(teamId, slotId);
    if (!runtime) throw new Error(`Member not found: ${slotId}`);

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
    teamStore.insertMail(mail);

    // Fire-and-forget the turn (A4 streaming isolation + full EventLoop land later).
    this.runTurn(teamId, slotId, input, files).catch((e) => mainError('TeamService', `runTurn failed for ${slotId}:`, e));

    return {
      team_run_id: uuid(),
      team_id: teamId,
      target_slot_id: slotId,
      target_role: runtime.member.role,
      accepted_slot_id: slotId,
      accepted_role: runtime.member.role,
      status: 'accepted',
      message_id: mailId,
    };
  }

  /** Minimal single-member turn (stage 1): drive the agent, then mark mailbox read. */
  private async runTurn(teamId: string, slotId: string, input: string, files?: string[]): Promise<void> {
    const runtime = this.getRuntime(teamId, slotId);
    if (!runtime || !runtime.agent) {
      mainWarn('TeamService', `No agent bound to slot ${slotId}, skipping turn`);
      return;
    }
    teamStore.updateMember(slotId, { status: 'working' });
    ipcBridge.team.onAgentStatusChanged.emit({ team_id: teamId, slot_id: slotId, status: 'active' });
    try {
      await runtime.agent.sendMessage({ content: input, files, msg_id: uuid() });
      const unread = teamStore.peekUnread(teamId, slotId);
      if (unread.length > 0) teamStore.markReadBatch(unread.map((m) => m.id));
      teamStore.updateMember(slotId, { status: 'idle' });
      ipcBridge.team.onAgentStatusChanged.emit({ team_id: teamId, slot_id: slotId, status: 'idle' });
    } catch (e) {
      teamStore.updateMember(slotId, { status: 'idle' });
      ipcBridge.team.onAgentStatusChanged.emit({ team_id: teamId, slot_id: slotId, status: 'failed', last_message: e instanceof Error ? e.message : String(e) });
    }
  }

  async removeTeam(teamId: string): Promise<void> {
    const members = this.sessions.get(teamId);
    if (members) {
      for (const [, rt] of members) {
        if (rt.agent)
          rt.agent.kill().catch(() => {
            /* ignore */
          });
      }
    }
    this.sessions.delete(teamId);
    teamStore.softDeleteTeam(teamId);
    ipcBridge.team.onListChanged.emit({ team_id: teamId, action: 'removed' });
  }

  async removeMember(teamId: string, slotId: string): Promise<void> {
    const rt = this.getRuntime(teamId, slotId);
    if (rt?.agent)
      rt.agent.kill().catch(() => {
        /* ignore */
      });
    this.sessions.get(teamId)?.delete(slotId);
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

  private ensureSession(teamId: string): Map<string, MemberRuntime> {
    let s = this.sessions.get(teamId);
    if (!s) {
      s = new Map();
      this.sessions.set(teamId, s);
    }
    return s;
  }

  private getRuntime(teamId: string, slotId: string): MemberRuntime | undefined {
    return this.sessions.get(teamId)?.get(slotId);
  }

  private leaderSlot(teamId: string): string {
    const lead = teamStore.listMembersByTeam(teamId).find((m) => m.role === 'lead');
    if (!lead) throw new Error('Team has no leader');
    return lead.id;
  }
}

// Singleton — mirrors CronService (no ServiceManager, module-level import deps).
export const teamService = new TeamService();
// Re-export for callers that also need the database handle.
export { getDatabase };
