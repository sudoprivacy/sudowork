/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ITeamChildTurnEvent, ITeamRunAck, ITeamRunEvent, ITeamRunState, ITeamSlotWork, ITeamWorkspaceKind } from '@sudowork/host-bridge/ipcBridge';
import type { AcpBackendAll } from '@sudowork/common/acpTypes';

/** Frontend team member role (附录 II.11; backend uses 'lead', the mapper translates). */
export type TeammateRole = 'leader' | 'teammate';
/** Normalized 5-state member status (附录 II.10). */
export type TeammateStatus = 'pending' | 'idle' | 'active' | 'completed' | 'failed';

export interface TeamAssistant {
  slot_id: string;
  conversation_id: string | null;
  role: TeammateRole;
  source?: 'agent' | 'assistant' | null;
  assistant_backend: AcpBackendAll;
  icon?: string | null;
  assistant_name: string;
  status: TeammateStatus;
  cli_path?: string;
  assistant_id?: string | null;
  model?: string | null;
  pending_confirmations?: number;
}

export interface TTeam {
  id: string;
  user_id: string;
  name: string;
  workspace: string | null;
  workspace_kind: ITeamWorkspaceKind | null;
  leader_member_id: string | null;
  assistants: TeamAssistant[];
  session_mode?: string | null;
  pinned: boolean;
  pinned_at: number | null;
  created_at: number;
  updated_at: number;
}

// Run-state types are shared with the backend (ipcBridge) — re-export for the team UI.
export type { ITeamRunEvent, ITeamChildTurnEvent, ITeamRunAck, ITeamSlotWork, ITeamRunState };
