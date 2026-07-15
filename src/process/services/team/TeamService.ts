import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'node:http';
import { randomBytes } from 'node:crypto';
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
import { getNodeBinaryPath } from '@process/services/claudeCli/NodeRuntimeService';
import { createConversation } from '../conversationService';
import { teamStore, type Team, type TeamMail, type TeamMember } from './TeamStore';
import { buildGovernancePrompt } from './GovernancePrompt';
import { EventLoop } from './EventLoop';
import { SlotWakeGate } from './SlotWakeGate';

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

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    mainLog('TeamService', 'initialized');
  }

  cleanup(): void {
    for (const [, session] of this.sessions) {
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
        teamMcpConfig,
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
    teamStore.insertMember(member);

    // Build an independent AcpAgent (skipCache keeps it out of the shared task list).
    const task = WorkerManage.buildConversation(createResult.conversation, { skipCache: true });
    const agent = (task ?? null) as unknown as AcpAgent | null;
    const runtime: MemberRuntime = { member: { ...member }, agent, eventLoop: null };
    session.members.set(slotId, runtime);

    // Spawn the member's event loop (signal-wake turn driver).
    const eventLoop = new EventLoop({
      teamId,
      slotId,
      member: runtime.member,
      getAgent: () => runtime.agent,
      wakeGate: session.wakeGate,
      leaderSlotId: () => this.leaderSlot(teamId),
      onWakeSlot: (targetSlot) => this.notifyWake(teamId, targetSlot),
      lookupMember: (sid) => this.lookupMember(teamId, sid),
    });
    runtime.eventLoop = eventLoop;
    eventLoop.start();

    teamStore.updateMember(slotId, { status: 'idle', conversation_id: conversationId });
    ipcBridge.team.onMemberSpawned.emit({ team_id: teamId, member: toMemberIPC(member) });
    return member;
  }

  /** User message to the team leader. */
  async sendMessage(teamId: string, input: string, files?: string[], msgId?: string): Promise<ITeamRunAck> {
    return this.sendMessageToMember(teamId, this.leaderSlot(teamId), input, files, msgId);
  }

  /** User message to a specific member (writes mailbox from=user, then wakes the member's event loop). */
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

    // Wake the member's event loop — it mirrors unread, drives the agent turn (which
    // emits the user's right bubble itself), and marks the mailbox read. Stage-1 runTurn
    // is replaced by the EventLoop.
    this.notifyWake(teamId, slotId);

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

  async removeTeam(teamId: string): Promise<void> {
    await this.stopSession(teamId);
    teamStore.softDeleteTeam(teamId);
    ipcBridge.team.onListChanged.emit({ team_id: teamId, action: 'removed' });
  }

  async removeMember(teamId: string, slotId: string): Promise<void> {
    const session = this.sessions.get(teamId);
    const rt = session?.members.get(slotId);
    if (rt?.eventLoop) await rt.eventLoop.stop();
    if (rt?.agent)
      rt.agent.kill().catch(() => {
        /* ignore */
      });
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

  // ---- Team-mcp HTTP loopback (plan §1.5 / §A1) ----

  /** Idempotently ensure a team session exists with its HTTP loopback listening. */
  private async ensureSession(teamId: string): Promise<TeamSession> {
    const existing = this.sessions.get(teamId);
    if (existing) return existing;
    const { server, port, token } = await this.startTeamHttpServer(teamId);
    const session: TeamSession = { members: new Map(), wakeGate: new SlotWakeGate(), httpServer: server, port, token };
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
      default:
        return { ok: false, error: `unknown tool: ${tool}` };
    }
  }

  /** team_send_message: write mailbox (from=caller) and wake recipients. `to="*"` broadcasts to everyone except the caller. */
  private toolSendMessage(teamId: string, caller: TeamMember, args: Record<string, unknown>): TeamToolResult {
    const to = args.to;
    const message = args.message;
    if (typeof to !== 'string' || typeof message !== 'string') {
      return { ok: false, error: 'team_send_message requires string "to" and "message"' };
    }
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
      const mail: TeamMail = {
        id: uuid(),
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
      teamStore.insertMail(mail);
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

  // ---- helpers ----

  private notifyWake(teamId: string, slotId: string): void {
    this.sessions.get(teamId)?.members.get(slotId)?.eventLoop?.notifyWake();
  }

  private lookupMember(teamId: string, slotId: string): TeamMember | null {
    const rt = this.sessions.get(teamId)?.members.get(slotId);
    return rt ? rt.member : teamStore.getMember(slotId);
  }

  private getRuntime(teamId: string, slotId: string): MemberRuntime | undefined {
    return this.sessions.get(teamId)?.members.get(slotId);
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
// Internal types re-exported for tests.
export type { TeamToolResult, MemberRuntime, TeamSession };
