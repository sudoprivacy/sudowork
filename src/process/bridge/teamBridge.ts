import { ipcBridge } from '@/common';
import { getDatabase } from '@process/database';
import { teamService } from '@process/services/team/TeamService';
import { teamStore } from '@process/services/team/TeamStore';
import { mainError } from '@process/utils/mainLogger';

function errEnvelope(err: unknown): never {
  return { __error: err instanceof Error ? err.message : String(err) } as never;
}

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
      return await teamService.createTeam(getDatabase().getDefaultUserId(), params.name, params.workspace ?? null, params.leader_assistant_id, params.leader_name, params.leader_model);
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
      return await teamService.spawnMember(params.team_id, { assistant_id: params.assistant_id, name: params.name, model: params.model, role: params.role });
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

  ipcBridge.team.sendMessage.provider(async ({ teamId, input, files, msgId }) => {
    try {
      return await teamService.sendMessage(teamId, input, files, msgId);
    } catch (err) {
      mainError('TeamBridge', 'sendMessage failed:', err);
      return errEnvelope(err);
    }
  });

  ipcBridge.team.sendMessageToMember.provider(async ({ teamId, memberId, input, files, msgId }) => {
    try {
      return await teamService.sendMessageToMember(teamId, memberId, input, files, msgId);
    } catch (err) {
      mainError('TeamBridge', 'sendMessageToMember failed:', err);
      return errEnvelope(err);
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

  ipcBridge.team.setSessionMode.provider(async ({ teamId, sessionMode }) => {
    try {
      teamService.setSessionMode(teamId, sessionMode);
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

  ipcBridge.team.updateTeam.provider(async ({ teamId, updates }) => {
    try {
      return teamService.updateTeam(teamId, updates);
    } catch (err) {
      mainError('TeamBridge', 'updateTeam failed:', err);
      return errEnvelope(err);
    }
  });

  ipcBridge.team.renameTeam.provider(async ({ teamId, name }) => {
    try {
      return teamService.renameTeam(teamId, name);
    } catch (err) {
      mainError('TeamBridge', 'renameTeam failed:', err);
      return errEnvelope(err);
    }
  });

  // Secondary providers not yet wired (not used by the current UI).
  ipcBridge.team.reorderMembers.provider(async () => errEnvelope(new Error('Not implemented')));
}
