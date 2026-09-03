import { z } from 'zod';
import type { ICreateTeamMemberParams } from '@sudowork/host-bridge/ipcBridge';
import { ipcBridge } from '@/common';
import { getDatabase } from '@process/database';
import { teamService } from '@process/services/team/TeamService';
import { teamStore } from '@process/services/team/TeamStore';
import { mainError } from '@process/utils/mainLogger';

function errEnvelope(err: unknown): never {
  return { __error: err instanceof Error ? err.message : String(err) } as never;
}

/**
 * Runtime shape validation for mutating providers. Params reach these handlers from the
 * renderer over IPC and from WebUI clients over WebSocket — both paths erase TS types, so a
 * malformed payload would otherwise flow straight into the service layer.
 */
const MAX_INPUT_CHARS = 256 * 1024; // zod counts UTF-16 code units, not bytes
const MAX_NAME_CHARS = 128;

const teamNameSchema = z.string().trim().min(1).max(MAX_NAME_CHARS);
const memberNameSchema = z.string().trim().min(1).max(MAX_NAME_CHARS);

const createTeamSchema = z.object({
  name: teamNameSchema,
  workspace: z.string().optional(),
  members: z
    .array(
      z.object({
        assistant_id: z.string().min(1),
        name: memberNameSchema,
        model: z.string().optional(),
        role: z.enum(['lead', 'teammate']),
      })
    )
    .min(1),
});

const addMemberSchema = z.object({
  team_id: z.string().min(1),
  assistant_id: z.string().min(1),
  name: memberNameSchema,
  model: z.string().optional(),
  role: z.enum(['lead', 'teammate']).optional(),
});

const sendMessageSchema = z.object({
  teamId: z.string().min(1),
  input: z.string().min(1).max(MAX_INPUT_CHARS),
  files: z.array(z.string()).optional(),
  msgId: z.string().optional(),
});

const sendMessageToMemberSchema = sendMessageSchema.extend({
  memberId: z.string().min(1),
});

const updateTeamSchema = z.object({
  teamId: z.string().min(1),
  updates: z.object({
    name: teamNameSchema.optional(),
    pinned: z.boolean().optional(),
    pinned_at: z.number().optional(),
  }),
});

const renameTeamSchema = z.object({
  teamId: z.string().min(1),
  name: teamNameSchema,
});

const setSessionModeSchema = z.object({
  teamId: z.string().min(1),
  sessionMode: z.string().trim().min(1).max(MAX_NAME_CHARS),
});

/**
 * Initialize team collaboration IPC bridge handlers.
 * Core providers (createTeam / members / messaging) are wired to TeamService;
 * run-lifecycle providers are stubbed until later stages ship the full runtime.
 */
export function initTeamBridge(): void {
  ipcBridge.team.listTeams.provider(async () => {
    try {
      return teamService.listTeams(getDatabase().getDefaultUserId());
    } catch (err) {
      mainError('TeamBridge', 'listTeams failed:', err);
      return errEnvelope(err);
    }
  });

  ipcBridge.team.getTeam.provider(async ({ teamId }) => {
    try {
      return teamService.getTeam(teamId);
    } catch (err) {
      mainError('TeamBridge', 'getTeam failed:', err);
      return errEnvelope(err);
    }
  });

  ipcBridge.team.listMembers.provider(async ({ teamId }) => {
    try {
      return teamService.listMembers(teamId);
    } catch (err) {
      mainError('TeamBridge', 'listMembers failed:', err);
      return errEnvelope(err);
    }
  });

  ipcBridge.team.listAssistants.provider(async () => {
    try {
      return await teamService.listAvailableAssistantsForTeam();
    } catch (err) {
      mainError('TeamBridge', 'listAssistants failed:', err);
      return errEnvelope(err);
    }
  });

  ipcBridge.team.createTeam.provider(async (params) => {
    try {
      const parsed = createTeamSchema.parse(params);
      return await teamService.createTeam(getDatabase().getDefaultUserId(), parsed.name, parsed.workspace ?? null, parsed.members as ICreateTeamMemberParams[]);
    } catch (err) {
      mainError('TeamBridge', 'createTeam failed:', err);
      return errEnvelope(err);
    }
  });

  ipcBridge.team.removeTeam.provider(async ({ teamId, deleteWorkspace }) => {
    try {
      await teamService.removeTeam(teamId, deleteWorkspace);
    } catch (err) {
      mainError('TeamBridge', 'removeTeam failed:', err);
      return errEnvelope(err);
    }
  });

  ipcBridge.team.addMember.provider(async (params) => {
    try {
      const parsed = addMemberSchema.parse(params);
      return await teamService.spawnMember(parsed.team_id, { assistant_id: parsed.assistant_id, name: parsed.name, model: parsed.model, role: parsed.role });
    } catch (err) {
      mainError('TeamBridge', 'addMember failed:', err);
      return errEnvelope(err);
    }
  });

  ipcBridge.team.removeMember.provider(async ({ teamId, memberId }) => {
    try {
      await teamService.removeMember(teamId, memberId);
    } catch (err) {
      mainError('TeamBridge', 'removeMember failed:', err);
      return errEnvelope(err);
    }
  });

  ipcBridge.team.sendMessage.provider(async (params) => {
    try {
      const { teamId, input, files, msgId } = sendMessageSchema.parse(params);
      return await teamService.sendMessage(teamId, input, files, msgId);
    } catch (err) {
      mainError('TeamBridge', 'sendMessage failed:', err);
      return errEnvelope(err);
    }
  });

  ipcBridge.team.sendMessageToMember.provider(async (params) => {
    try {
      const { teamId, memberId, input, files, msgId } = sendMessageToMemberSchema.parse(params);
      return await teamService.sendMessageToMember(teamId, memberId, input, files, msgId);
    } catch (err) {
      mainError('TeamBridge', 'sendMessageToMember failed:', err);
      return errEnvelope(err);
    }
  });

  ipcBridge.team.answerQuestion.provider(async ({ teamId, memberId, conversationId, toolCallId, answers }) => {
    try {
      await teamService.answerQuestion(teamId, memberId, conversationId, toolCallId, answers);
      return { success: true };
    } catch (err) {
      mainError('TeamBridge', 'answerQuestion failed:', err);
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcBridge.team.getRunState.provider(async ({ teamId }) => {
    try {
      return teamService.getRunState(teamId);
    } catch (err) {
      mainError('TeamBridge', 'getRunState failed:', err);
      return errEnvelope(err);
    }
  });

  ipcBridge.team.cancelRun.provider(async ({ teamId, reason }) => {
    try {
      teamService.cancelRun(teamId, reason);
    } catch (err) {
      mainError('TeamBridge', 'cancelRun failed:', err);
      return errEnvelope(err);
    }
  });

  ipcBridge.team.cancelChildTurn.provider(async ({ teamId, slotId, turnId }) => {
    try {
      await teamService.cancelChildTurn(teamId, slotId, turnId);
    } catch (err) {
      mainError('TeamBridge', 'cancelChildTurn failed:', err);
      return errEnvelope(err);
    }
  });

  ipcBridge.team.renewActiveLease.provider(async ({ teamId, leaseId }) => {
    try {
      teamService.renewActiveLease(teamId, leaseId);
    } catch (err) {
      mainError('TeamBridge', 'renewActiveLease failed:', err);
      return errEnvelope(err);
    }
  });

  ipcBridge.team.setSessionMode.provider(async (params) => {
    try {
      const { teamId, sessionMode } = setSessionModeSchema.parse(params);
      await teamService.setSessionMode(teamId, sessionMode);
    } catch (err) {
      mainError('TeamBridge', 'setSessionMode failed:', err);
      return errEnvelope(err);
    }
  });

  // Session lifecycle + member controls.
  ipcBridge.team.ensureSession.provider(async ({ teamId }) => {
    try {
      await teamService.rebuildTeam(teamId);
    } catch (err) {
      mainError('TeamBridge', 'ensureSession failed:', err);
      return errEnvelope(err);
    }
  });

  ipcBridge.team.stopSession.provider(async ({ teamId }) => {
    try {
      await teamService.stopTeamSession(teamId);
    } catch (err) {
      mainError('TeamBridge', 'stopSession failed:', err);
      return errEnvelope(err);
    }
  });

  ipcBridge.team.pauseMember.provider(async ({ teamId, slotId }) => {
    try {
      await teamService.pauseMember(teamId, slotId);
    } catch (err) {
      mainError('TeamBridge', 'pauseMember failed:', err);
      return errEnvelope(err);
    }
  });

  ipcBridge.team.retryMemberStart.provider(async ({ teamId, slotId }) => {
    try {
      await teamService.retryMemberStart(teamId, slotId);
    } catch (err) {
      mainError('TeamBridge', 'retryMemberStart failed:', err);
      return errEnvelope(err);
    }
  });

  ipcBridge.team.renameMember.provider(async ({ memberId, name }) => {
    try {
      const member = teamStore.getMember(memberId);
      if (!member) throw new Error(`Member not found: ${memberId}`);
      teamService.renameMember(member.team_id, memberId, name);
    } catch (err) {
      mainError('TeamBridge', 'renameMember failed:', err);
      return errEnvelope(err);
    }
  });

  ipcBridge.team.updateTeam.provider(async (params) => {
    try {
      const { teamId, updates } = updateTeamSchema.parse(params);
      return teamService.updateTeam(teamId, updates);
    } catch (err) {
      mainError('TeamBridge', 'updateTeam failed:', err);
      return errEnvelope(err);
    }
  });

  ipcBridge.team.renameTeam.provider(async (params) => {
    try {
      const { teamId, name } = renameTeamSchema.parse(params);
      return teamService.renameTeam(teamId, name);
    } catch (err) {
      mainError('TeamBridge', 'renameTeam failed:', err);
      return errEnvelope(err);
    }
  });

  // Secondary providers not yet wired (not used by the current UI).
  ipcBridge.team.reorderMembers.provider(async () => errEnvelope(new Error('Not implemented')));
}
