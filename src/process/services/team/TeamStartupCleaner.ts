/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Boot leaderless-team sweeper.
 *
 * createTeam writes team + members across several independent commits (provisioning spans
 * awaits, so no DB transaction can cover it). A crash before the leader provision completes
 * leaves a `leader_member_id IS NULL` half-team that nothing else ever reconciles. This sweeper
 * runs once at boot and rolls those rows back (reap conversations → hard-delete mailbox/tasks →
 * soft-delete → remove the managed temp workspace).
 *
 * Safety guards: only teams whose leader never appeared are swept — a crash later in the
 * teammate loop leaves a usable-but-incomplete team that stays visible and deletable in the UI,
 * which we deliberately keep. The created_at freshness guard (>10 min) keeps the sweep away from
 * a team the user might be creating right as this async sweep runs (the residual race is tiny:
 * seconds-wide window, detail page redirects leaderless teams away, reaper kills the workers).
 */

import fs from 'fs/promises';
import { mainLog, mainWarn } from '@process/utils/mainLogger';
import { reapConversation, isSafeAutoWorkspacePath } from '../conversationReaper';
import { teamStore } from './TeamStore';

/** A team younger than this is skipped — its leader provision may legitimately still be in flight. */
const FRESH_TEAM_THRESHOLD_MS = 10 * 60 * 1000;

export async function sweepLeaderlessTeams(): Promise<{ swept: number }> {
  const swept: string[] = [];
  let staleTeams;
  try {
    const now = Date.now();
    staleTeams = teamStore.listLeaderlessTeams().filter((team) => now - team.created_at > FRESH_TEAM_THRESHOLD_MS);
  } catch (error) {
    mainWarn('TeamStartupCleaner', 'Failed to list leaderless teams:', error);
    return { swept: 0 };
  }
  if (staleTeams.length === 0) return { swept: 0 };

  for (const team of staleTeams) {
    try {
      // Read the workspace BEFORE soft-delete — getTeam filters deleted=0 afterwards.
      const workspace = teamStore.getTeam(team.id)?.workspace ?? null;
      for (const member of teamStore.listMembersByTeam(team.id)) {
        if (member.conversation_id) {
          await reapConversation(member.conversation_id, { reason: 'team-spawn-rollback', deleteWorkspace: false });
        }
      }
      teamStore.softDeleteMembersByTeam(team.id);
      teamStore.softDeleteTeam(team.id);
      teamStore.hardDeleteMailboxByTeam(team.id);
      teamStore.hardDeleteTasksByTeam(team.id);
      if (workspace && isSafeAutoWorkspacePath(workspace)) {
        try {
          await fs.rm(workspace, { recursive: true, force: true });
        } catch (error) {
          mainWarn('TeamStartupCleaner', `Failed to delete workspace of leaderless team ${team.id}: ${workspace}`, error);
        }
      }
      swept.push(team.id);
    } catch (error) {
      mainWarn('TeamStartupCleaner', `Failed to sweep leaderless team ${team.id}:`, error);
    }
  }

  mainLog('TeamStartupCleaner', `Swept ${swept.length} leaderless team(s)`);
  return { swept: swept.length };
}
