/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ITeam, ITeamMember } from '@sudowork/host-bridge/ipcBridge';
import type { TeamAssistant, TeammateRole, TeammateStatus, TTeam } from './types';

/** Normalize a backend member status into the 5-state frontend status (附录 II.10). */
export function normalizeTeamStatus(status: string): TeammateStatus {
  switch (status) {
    case 'pending':
      return 'pending';
    case 'idle':
      return 'idle';
    case 'active':
    case 'working':
    case 'thinking':
    case 'tool_use':
      return 'active';
    case 'completed':
      return 'completed';
    case 'error':
    case 'failed':
      return 'failed';
    default:
      return 'idle';
  }
}

/** backend 'lead' → frontend 'leader' (附录 II.11). */
export function fromBackendRole(role: 'lead' | 'teammate'): TeammateRole {
  return role === 'lead' ? 'leader' : 'teammate';
}

/** frontend 'leader' → backend 'lead' (附录 II.11). */
export function toBackendRole(role: TeammateRole): 'lead' | 'teammate' {
  return role === 'leader' ? 'lead' : 'teammate';
}

export function fromBackendAssistant(m: ITeamMember): TeamAssistant {
  return {
    slot_id: m.id,
    conversation_id: m.conversation_id ?? null,
    role: fromBackendRole(m.role),
    source: m.source ?? null,
    assistant_backend: m.backend,
    icon: m.avatar ?? null,
    assistant_name: m.name,
    status: normalizeTeamStatus(m.status),
    assistant_id: m.assistant_id ?? null,
    model: m.model ?? null,
  };
}

export function fromBackendTeam(team: ITeam, members: ITeamMember[]): TTeam {
  const assistants = members.map(fromBackendAssistant);
  // Leader first, the rest preserve insertion order.
  assistants.sort((a, b) => (a.role === 'leader' ? -1 : b.role === 'leader' ? 1 : 0));
  return {
    id: team.id,
    user_id: team.user_id,
    name: team.name,
    workspace: team.workspace ?? null,
    workspace_kind: team.workspace_kind ?? null,
    leader_member_id: team.leader_member_id,
    assistants,
    session_mode: team.session_mode,
    pinned: team.pinned ?? false,
    pinned_at: team.pinned_at ?? null,
    created_at: team.created_at,
    updated_at: team.updated_at,
  };
}

export interface BackendAssistantInput {
  role: TeammateRole;
  assistant_id: string;
  assistant_name: string;
  model?: string | null;
}

/** Convert a frontend assistant selection into the backend addMember params (附录 II.11). */
export function toBackendAssistant(a: BackendAssistantInput): { role: 'lead' | 'teammate'; assistant_id: string; name: string; model?: string } {
  if (!a.assistant_id) throw new Error('assistant_id is required');
  return {
    role: toBackendRole(a.role),
    assistant_id: a.assistant_id,
    name: a.assistant_name,
    model: a.model || 'default',
  };
}
