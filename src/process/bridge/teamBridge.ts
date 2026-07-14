import { ipcBridge } from '@/common';
import { teamService } from '@process/services/team/TeamService';
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
  ipcBridge.team.listTeams.provider(async ({ userId }) => {
    try {
      return teamService.listTeams(userId);
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

  ipcBridge.team.createTeam.provider(async (params) => {
    try {
      return await teamService.createTeam(params.user_id, params.name, params.workspace ?? null, params.leader_assistant_id, params.leader_name, params.leader_model);
    } catch (err) {
      mainError('TeamBridge', 'createTeam failed:', err);
      return errEnvelope(err);
    }
  });

  ipcBridge.team.removeTeam.provider(async ({ teamId }) => {
    try {
      await teamService.removeTeam(teamId);
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

  // Run-lifecycle providers ship in later stages (TeamRun / EventLoop / CrashRecovery).
  ipcBridge.team.updateTeam.provider(async () => errEnvelope(new Error('Not implemented')));
  ipcBridge.team.renameTeam.provider(async () => errEnvelope(new Error('Not implemented')));
  ipcBridge.team.renameMember.provider(async () => errEnvelope(new Error('Not implemented')));
  ipcBridge.team.reorderMembers.provider(async () => errEnvelope(new Error('Not implemented')));
  ipcBridge.team.cancelRun.provider(async () => errEnvelope(new Error('Not implemented')));
  ipcBridge.team.cancelChildTurn.provider(async () => errEnvelope(new Error('Not implemented')));
  ipcBridge.team.pauseMember.provider(async () => errEnvelope(new Error('Not implemented')));
  ipcBridge.team.ensureSession.provider(async () => errEnvelope(new Error('Not implemented')));
  ipcBridge.team.stopSession.provider(async () => errEnvelope(new Error('Not implemented')));
  ipcBridge.team.getRunState.provider(async () => ({ active_run: null }));
  ipcBridge.team.renewActiveLease.provider(async () => errEnvelope(new Error('Not implemented')));
  ipcBridge.team.setSessionMode.provider(async () => errEnvelope(new Error('Not implemented')));
}
