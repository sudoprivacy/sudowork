import { getDatabase } from '@process/database';
import type { AcpBackendAll, PresetAgentType } from '@/types/acpTypes';

const MARK_READ_BATCH_CHUNK = 500;

export type TeamMemberRole = 'lead' | 'teammate';
export type TeamMemberSource = 'agent' | 'assistant';
export type TeamWorkspaceKind = 'custom' | 'temporary';
export type TeamMailboxType = 'message' | 'idle_notification' | 'shutdown_request' | 'crash_testament';
export type TeamTaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled' | 'deleted';

export interface Team {
  id: string;
  user_id: string;
  name: string;
  workspace: string | null;
  workspace_kind: TeamWorkspaceKind | null;
  leader_member_id: string | null;
  session_mode: string | null;
  pinned: boolean;
  pinned_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface TeamMember {
  id: string;
  team_id: string;
  role: TeamMemberRole;
  name: string;
  assistant_id: string | null;
  source: TeamMemberSource | null;
  backend: AcpBackendAll;
  preset_agent_type: PresetAgentType | null;
  skills: string[];
  preset_context: string | null;
  model: string | null;
  avatar: string | null;
  conversation_id: string | null;
  status: string;
  isPreset?: boolean;
  isDelegated?: boolean;
  created_at: number;
}

export interface TeamMail {
  id: string;
  team_id: string;
  to_member_id: string;
  from_member_id: string;
  type: TeamMailboxType;
  content: string;
  summary: string | null;
  files: string[] | null;
  read: boolean;
  created_at: number;
}

export interface TeamTask {
  id: string;
  team_id: string;
  subject: string;
  description: string | null;
  status: TeamTaskStatus;
  owner: string | null;
  blocked_by: string[];
  blocks: string[];
  metadata: Record<string, unknown> | null;
  created_at: number;
  updated_at: number;
}

interface TeamRow {
  id: string;
  user_id: string;
  name: string;
  workspace: string | null;
  workspace_kind: TeamWorkspaceKind | null;
  leader_member_id: string | null;
  session_mode: string | null;
  pinned?: number | null;
  pinned_at?: number | null;
  created_at: number;
  updated_at: number;
}

interface TeamMemberRow {
  id: string;
  team_id: string;
  role: TeamMemberRole;
  name: string;
  assistant_id: string | null;
  source: string | null;
  backend: string;
  preset_agent_type: string | null;
  skills: string | null;
  preset_context: string | null;
  model: string | null;
  avatar: string | null;
  conversation_id: string | null;
  status: string;
  is_preset: number;
  is_delegated: number;
  created_at: number;
}

interface TeamMailboxRow {
  id: string;
  team_id: string;
  to_member_id: string;
  from_member_id: string;
  type: TeamMailboxType;
  content: string;
  summary: string | null;
  files: string | null;
  read: number;
  created_at: number;
}

interface TeamTaskRow {
  id: string;
  team_id: string;
  subject: string;
  description: string | null;
  status: string;
  owner: string | null;
  blocked_by: string | null;
  blocks: string | null;
  metadata: string | null;
  created_at: number;
  updated_at: number;
}

function parseStringArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string');
  } catch {
    return [];
  }
}

function parseRecord(value: string | null | undefined): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function rowToTeam(row: TeamRow): Team {
  return {
    ...row,
    pinned: row.pinned === 1,
    pinned_at: row.pinned_at ?? null,
  };
}

function normalizeMemberSource(source: string | null | undefined): TeamMemberSource | null {
  return source === 'agent' || source === 'assistant' ? source : null;
}

function rowToMember(row: TeamMemberRow): TeamMember {
  return {
    id: row.id,
    team_id: row.team_id,
    role: row.role,
    name: row.name,
    assistant_id: row.assistant_id,
    source: normalizeMemberSource(row.source),
    backend: row.backend as AcpBackendAll,
    preset_agent_type: row.preset_agent_type as PresetAgentType | null,
    skills: parseStringArray(row.skills),
    preset_context: row.preset_context,
    model: row.model,
    avatar: row.avatar,
    conversation_id: row.conversation_id,
    status: row.status,
    isPreset: row.is_preset === 1,
    isDelegated: row.is_delegated === 1,
    created_at: row.created_at,
  };
}

function rowToMail(row: TeamMailboxRow): TeamMail {
  return {
    id: row.id,
    team_id: row.team_id,
    to_member_id: row.to_member_id,
    from_member_id: row.from_member_id,
    type: row.type,
    content: row.content,
    summary: row.summary,
    files: row.files ? parseStringArray(row.files) : null,
    read: row.read === 1,
    created_at: row.created_at,
  };
}

function rowToTask(row: TeamTaskRow): TeamTask {
  return {
    id: row.id,
    team_id: row.team_id,
    subject: row.subject,
    description: row.description,
    status: row.status as TeamTaskStatus,
    owner: row.owner,
    blocked_by: parseStringArray(row.blocked_by),
    blocks: parseStringArray(row.blocks),
    metadata: parseRecord(row.metadata),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * TeamStore - Persistence layer for multi-agent team collaboration.
 * Uses the typed database accessor (query/queryOne/mutate/runTransaction)
 * instead of reaching into the private better-sqlite3 instance.
 * Teams and members use soft-delete (`deleted` column); tasks use `status='deleted'`.
 */
class TeamStore {
  // ---- Team ----

  insertTeam(team: Team): void {
    const result = getDatabase().mutate(
      `INSERT INTO teams (id, user_id, name, workspace, workspace_kind, leader_member_id, session_mode, pinned, pinned_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      team.id,
      team.user_id,
      team.name,
      team.workspace,
      team.workspace_kind,
      team.leader_member_id,
      team.session_mode,
      team.pinned ? 1 : 0,
      team.pinned_at,
      team.created_at,
      team.updated_at
    );
    if (!result.success) throw new Error(result.error);
  }

  updateTeam(teamId: string, updates: Partial<Team>): void {
    const existing = this.getTeam(teamId);
    if (!existing) throw new Error(`Team not found: ${teamId}`);
    const merged: Team = { ...existing, ...updates, updated_at: Date.now() };
    const result = getDatabase().mutate(
      `UPDATE teams SET name = ?, workspace = ?, workspace_kind = ?, leader_member_id = ?, session_mode = ?, pinned = ?, pinned_at = ?, updated_at = ?
       WHERE id = ? AND deleted = 0`,
      merged.name,
      merged.workspace,
      merged.workspace_kind,
      merged.leader_member_id,
      merged.session_mode,
      merged.pinned ? 1 : 0,
      merged.pinned_at,
      merged.updated_at,
      teamId
    );
    if (!result.success) throw new Error(result.error);
  }

  softDeleteTeam(teamId: string): void {
    const result = getDatabase().mutate(`UPDATE teams SET deleted = 1, updated_at = ? WHERE id = ?`, Date.now(), teamId);
    if (!result.success) throw new Error(result.error);
  }

  getTeam(teamId: string): Team | null {
    const result = getDatabase().queryOne<TeamRow>(`SELECT * FROM teams WHERE id = ? AND deleted = 0`, teamId);
    if (!result.success) throw new Error(result.error);
    return result.data ? rowToTeam(result.data) : null;
  }

  listTeams(): Team[] {
    const result = getDatabase().query<TeamRow>(`SELECT * FROM teams WHERE deleted = 0 ORDER BY pinned DESC, pinned_at DESC, updated_at DESC`);
    if (!result.success) throw new Error(result.error);
    return result.data.map(rowToTeam);
  }

  listByUser(userId: string): Team[] {
    const result = getDatabase().query<TeamRow>(`SELECT * FROM teams WHERE user_id = ? AND deleted = 0 ORDER BY pinned DESC, pinned_at DESC, updated_at DESC`, userId);
    if (!result.success) throw new Error(result.error);
    return result.data.map(rowToTeam);
  }

  /** Undeleted teams that never got a leader — createTeam interrupted mid-provision (startup sweep only). */
  listLeaderlessTeams(): Team[] {
    const result = getDatabase().query<TeamRow>(`SELECT * FROM teams WHERE deleted = 0 AND leader_member_id IS NULL`);
    if (!result.success) throw new Error(result.error);
    return result.data.map(rowToTeam);
  }

  // ---- Member ----

  insertMember(member: TeamMember): void {
    const result = getDatabase().mutate(
      `INSERT INTO team_members (id, team_id, role, name, assistant_id, source, backend, preset_agent_type, skills, preset_context, model, avatar, conversation_id, status, is_preset, is_delegated, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      member.id,
      member.team_id,
      member.role,
      member.name,
      member.assistant_id,
      member.source,
      member.backend,
      member.preset_agent_type,
      JSON.stringify(member.skills),
      member.preset_context,
      member.model,
      member.avatar,
      member.conversation_id,
      member.status,
      member.isPreset ? 1 : 0,
      member.isDelegated ? 1 : 0,
      member.created_at
    );
    if (!result.success) throw new Error(result.error);
  }

  updateMember(memberId: string, updates: Partial<TeamMember>): void {
    const existing = this.getMember(memberId);
    if (!existing) throw new Error(`Team member not found: ${memberId}`);
    const merged: TeamMember = { ...existing, ...updates };
    const result = getDatabase().mutate(
      `UPDATE team_members SET name = ?, model = ?, avatar = ?, status = ?, conversation_id = ?, preset_context = ?, skills = ?
       WHERE id = ? AND deleted = 0`,
      merged.name,
      merged.model,
      merged.avatar,
      merged.status,
      merged.conversation_id,
      merged.preset_context,
      JSON.stringify(merged.skills),
      memberId
    );
    if (!result.success) throw new Error(result.error);
  }

  markMemberDelegated(memberId: string): void {
    const result = getDatabase().mutate(`UPDATE team_members SET is_delegated = 1 WHERE id = ? AND deleted = 0`, memberId);
    if (!result.success) throw new Error(result.error);
  }

  softDeleteMember(memberId: string): void {
    const result = getDatabase().mutate(`UPDATE team_members SET deleted = 1 WHERE id = ?`, memberId);
    if (!result.success) throw new Error(result.error);
  }

  softDeleteMembersByTeam(teamId: string): void {
    const result = getDatabase().mutate(`UPDATE team_members SET deleted = 1 WHERE team_id = ?`, teamId);
    if (!result.success) throw new Error(result.error);
  }

  getMember(memberId: string): TeamMember | null {
    const result = getDatabase().queryOne<TeamMemberRow>(`SELECT * FROM team_members WHERE id = ? AND deleted = 0`, memberId);
    if (!result.success) throw new Error(result.error);
    return result.data ? rowToMember(result.data) : null;
  }

  listMembersByTeam(teamId: string): TeamMember[] {
    const result = getDatabase().query<TeamMemberRow>(`SELECT * FROM team_members WHERE team_id = ? AND deleted = 0 ORDER BY created_at ASC`, teamId);
    if (!result.success) throw new Error(result.error);
    return result.data.map(rowToMember);
  }

  // ---- Mailbox ----

  insertMail(mail: TeamMail): void {
    const result = getDatabase().mutate(
      `INSERT INTO team_mailbox (id, team_id, to_member_id, from_member_id, type, content, summary, files, read, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      mail.id,
      mail.team_id,
      mail.to_member_id,
      mail.from_member_id,
      mail.type,
      mail.content,
      mail.summary,
      mail.files ? JSON.stringify(mail.files) : null,
      mail.read ? 1 : 0,
      mail.created_at
    );
    if (!result.success) throw new Error(result.error);
  }

  getLatestUserMail(teamId: string): TeamMail | null {
    const result = getDatabase().queryOne<TeamMailboxRow>(`SELECT * FROM team_mailbox WHERE team_id = ? AND from_member_id = 'user' AND type = 'message' ORDER BY created_at DESC LIMIT 1`, teamId);
    if (!result.success) throw new Error(result.error);
    return result.data ? rowToMail(result.data) : null;
  }

  /** Peek unread messages WITHOUT marking them read (peek-then-mark). */
  peekUnread(teamId: string, toMemberId: string): TeamMail[] {
    const result = getDatabase().query<TeamMailboxRow>(`SELECT * FROM team_mailbox WHERE team_id = ? AND to_member_id = ? AND read = 0 ORDER BY created_at ASC`, teamId, toMemberId);
    if (!result.success) throw new Error(result.error);
    return result.data.map(rowToMail);
  }

  /** Mark messages read in chunks (default 500); missing ids are silently ignored. Returns rows affected. */
  markReadBatch(ids: string[]): number {
    if (ids.length === 0) return 0;
    let total = 0;
    for (let i = 0; i < ids.length; i += MARK_READ_BATCH_CHUNK) {
      const chunk = ids.slice(i, i + MARK_READ_BATCH_CHUNK);
      const placeholders = chunk.map(() => '?').join(',');
      const result = getDatabase().mutate(`UPDATE team_mailbox SET read = 1 WHERE id IN (${placeholders})`, ...chunk);
      if (!result.success) throw new Error(result.error);
      total += result.data;
    }
    return total;
  }

  /** Full mailbox history for a member (includes read messages) — used for diagnostics. */
  getHistory(teamId: string, toMemberId: string): TeamMail[] {
    const result = getDatabase().query<TeamMailboxRow>(`SELECT * FROM team_mailbox WHERE team_id = ? AND to_member_id = ? ORDER BY created_at ASC`, teamId, toMemberId);
    if (!result.success) throw new Error(result.error);
    return result.data.map(rowToMail);
  }

  /** Sum of 'message' mail content length the recipient has from the sender newer than `since` (finalizeTurn fallback-prose dedup). */
  getMemberMessageCharsSince(teamId: string, toMemberId: string, fromMemberId: string, since: number): number {
    const result = getDatabase().queryOne<{ total: number | null }>(`SELECT SUM(LENGTH(content)) AS total FROM team_mailbox WHERE team_id = ? AND to_member_id = ? AND from_member_id = ? AND type = 'message' AND created_at > ?`, teamId, toMemberId, fromMemberId, since);
    if (!result.success) throw new Error(result.error);
    return result.data?.total ?? 0;
  }

  /**
   * Max created_at of a recipient's mailbox (同表 append-only watermark)。
   * 团队兜底回传去重用：取与去重查询同表（team_mailbox）的 leader mailbox 最大时间，
   * 避免跨表基准导致误命中上一 turn 的陈旧 mail。空表返回 0。
   */
  getMailMaxCreatedAt(teamId: string, toMemberId: string): number {
    const result = getDatabase().queryOne<{ maxCreated: number | null }>(`SELECT MAX(created_at) AS maxCreated FROM team_mailbox WHERE team_id = ? AND to_member_id = ?`, teamId, toMemberId);
    if (!result.success) throw new Error(result.error);
    return result.data?.maxCreated ?? 0;
  }

  /** Deliverable unread check: unread mail from someone OTHER than the recipient (self-mail is never deliverable — self filter, I.4). */
  hasUnread(teamId: string, toMemberId: string): boolean {
    const result = getDatabase().queryOne<{ count: number }>(`SELECT COUNT(*) as count FROM team_mailbox WHERE team_id = ? AND to_member_id = ? AND read = 0 AND from_member_id != ?`, teamId, toMemberId, toMemberId);
    if (!result.success) throw new Error(result.error);
    return (result.data?.count ?? 0) > 0;
  }

  // ---- Task ----

  insertTask(task: TeamTask): void {
    const result = getDatabase().mutate(
      `INSERT INTO team_tasks (id, team_id, subject, description, status, owner, blocked_by, blocks, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      task.id,
      task.team_id,
      task.subject,
      task.description,
      task.status,
      task.owner,
      JSON.stringify(task.blocked_by),
      JSON.stringify(task.blocks),
      task.metadata ? JSON.stringify(task.metadata) : null,
      task.created_at,
      task.updated_at
    );
    if (!result.success) throw new Error(result.error);
  }

  updateTask(taskId: string, updates: Partial<TeamTask>): void {
    const existing = this.getTask(taskId);
    if (!existing) throw new Error(`Team task not found: ${taskId}`);
    const merged: TeamTask = { ...existing, ...updates, updated_at: Date.now() };
    const result = getDatabase().mutate(
      `UPDATE team_tasks SET subject = ?, description = ?, status = ?, owner = ?, blocked_by = ?, blocks = ?, metadata = ?, updated_at = ?
       WHERE id = ?`,
      merged.subject,
      merged.description,
      merged.status,
      merged.owner,
      JSON.stringify(merged.blocked_by),
      JSON.stringify(merged.blocks),
      merged.metadata ? JSON.stringify(merged.metadata) : null,
      merged.updated_at,
      taskId
    );
    if (!result.success) throw new Error(result.error);
  }

  getTask(taskId: string): TeamTask | null {
    const result = getDatabase().queryOne<TeamTaskRow>(`SELECT * FROM team_tasks WHERE id = ? AND status != 'deleted'`, taskId);
    if (!result.success) throw new Error(result.error);
    return result.data ? rowToTask(result.data) : null;
  }

  listTasksByTeam(teamId: string): TeamTask[] {
    const result = getDatabase().query<TeamTaskRow>(`SELECT * FROM team_tasks WHERE team_id = ? AND status != 'deleted' ORDER BY created_at ASC`, teamId);
    if (!result.success) throw new Error(result.error);
    return result.data.map(rowToTask);
  }

  // ---- hard delete (soft-deleted teams never trigger FK CASCADE — child rows must be deleted explicitly) ----

  hardDeleteMailboxByTeam(teamId: string): void {
    const result = getDatabase().mutate(`DELETE FROM team_mailbox WHERE team_id = ?`, teamId);
    if (!result.success) throw new Error(result.error);
  }

  hardDeleteTasksByTeam(teamId: string): void {
    const result = getDatabase().mutate(`DELETE FROM team_tasks WHERE team_id = ?`, teamId);
    if (!result.success) throw new Error(result.error);
  }

  hardDeleteMailboxByMember(memberId: string): void {
    const result = getDatabase().mutate(`DELETE FROM team_mailbox WHERE to_member_id = ?`, memberId);
    if (!result.success) throw new Error(result.error);
  }
}

// Singleton instance
export const teamStore = new TeamStore();
