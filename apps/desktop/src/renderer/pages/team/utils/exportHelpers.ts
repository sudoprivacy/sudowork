/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { sanitizeFileName } from '@/renderer/pages/conversation/grouped-history/utils/exportHelpers';
import type { TeamAssistant, TTeam } from '../types';

export interface ITeamExportWarning {
  memberSlotId?: string;
  conversationId?: string;
  reason: 'missing_conversation_id' | 'conversation_load_failed' | 'messages_load_failed' | 'workspace_load_failed';
}

export const buildTeamFolderName = (team: TTeam): string => `${sanitizeFileName(team.name || team.id)}__${team.id}`;

export const buildTeamMemberConversationFolderName = (teamFolderName: string, member: TeamAssistant, conversationId: string): string => {
  const rolePrefix = member.role === 'leader' ? 'leader' : 'member';
  return `${teamFolderName}/conversations/${rolePrefix}__${sanitizeFileName(member.slot_id)}__${conversationId}`;
};

export const buildTeamManifestJson = (team: TTeam, warnings: ITeamExportWarning[]): string => {
  return JSON.stringify(
    {
      version: 1,
      exportedAt: new Date().toISOString(),
      team: {
        id: team.id,
        name: team.name,
        workspace: team.workspace,
        workspace_kind: team.workspace_kind,
        leader_member_id: team.leader_member_id,
        created_at: team.created_at,
        updated_at: team.updated_at,
      },
      members: team.assistants.map((member) => ({
        slot_id: member.slot_id,
        role: member.role,
        assistant_name: member.assistant_name,
        assistant_id: member.assistant_id,
        assistant_backend: member.assistant_backend,
        conversation_id: member.conversation_id,
        model: member.model,
        status: member.status,
      })),
      warnings,
    },
    null,
    2
  );
};

export const buildTeamManifestMarkdown = (team: TTeam, warnings: ITeamExportWarning[]): string => {
  const leader = team.assistants.find((member) => member.role === 'leader');
  const lines: string[] = [];
  lines.push(`# ${team.name}`);
  lines.push('');
  lines.push(`- Team ID: ${team.id}`);
  lines.push(`- Exported At: ${new Date().toISOString()}`);
  lines.push(`- Workspace: ${team.workspace ?? ''}`);
  lines.push(`- Workspace Kind: ${team.workspace_kind ?? ''}`);
  lines.push(`- Leader: ${leader?.assistant_name ?? ''}`);
  lines.push('');
  lines.push('## Members');
  lines.push('');
  lines.push('| Role | Name | Slot ID | Backend | Model | Conversation ID |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  team.assistants.forEach((member) => {
    lines.push(`| ${member.role} | ${member.assistant_name} | ${member.slot_id} | ${member.assistant_backend} | ${member.model ?? ''} | ${member.conversation_id ?? ''} |`);
  });
  if (warnings.length > 0) {
    lines.push('');
    lines.push('## Warnings');
    lines.push('');
    warnings.forEach((warning) => {
      lines.push(`- ${warning.reason}${warning.memberSlotId ? ` (slot: ${warning.memberSlotId})` : ''}${warning.conversationId ? ` (conversation: ${warning.conversationId})` : ''}`);
    });
  }
  lines.push('');
  return lines.join('\n');
};
