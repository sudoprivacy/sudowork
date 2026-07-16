import { useCallback, useEffect, useRef, useState } from 'react';
import { ipcBridge } from '@/common';
import { fromBackendTeam, normalizeTeamStatus } from '../mapper';
import type { TeammateStatus, TTeam } from '../types';
import { unwrapTeamResult } from '../utils';

async function fetchTeamDetail(teamId: string): Promise<TTeam | null> {
  const team = unwrapTeamResult(await ipcBridge.team.getTeam.invoke({ teamId }));
  if (!team) return null;
  const members = unwrapTeamResult(await ipcBridge.team.listMembers.invoke({ teamId })) ?? [];
  return fromBackendTeam(team, members);
}

/**
 * useTeamSession — single team + members + per-slot status map (附录 II.6).
 * Subscribes to spawned/removed/renamed (refetch) and agentStatusChanged (local status update).
 */
export function useTeamSession(teamId: string) {
  const [team, setTeam] = useState<TTeam | null>(null);
  const [statusMap, setStatusMap] = useState<Map<string, TeammateStatus>>(new Map());
  const [loading, setLoading] = useState(true);
  const requestSeqRef = useRef(0);

  const mutate = useCallback(
    async (options: { showLoading?: boolean } = {}) => {
      const { showLoading = false } = options;
      const requestSeq = ++requestSeqRef.current;

      if (showLoading) setLoading(true);
      try {
        const detail = await fetchTeamDetail(teamId);
        if (requestSeq !== requestSeqRef.current) return;
        setTeam(detail);
        if (detail) {
          setStatusMap((prev) => {
            const next = new Map(prev);
            for (const a of detail.assistants) next.set(a.slot_id, a.status);
            return next;
          });
        }
      } catch {
        if (requestSeq !== requestSeqRef.current) return;
        setTeam(null);
      } finally {
        if (requestSeq === requestSeqRef.current) {
          setLoading(false);
        }
      }
    },
    [teamId]
  );

  useEffect(() => {
    void mutate({ showLoading: true });
  }, [mutate]);

  useEffect(() => {
    const onSpawned = (e: { team_id: string }) => {
      if (e.team_id === teamId) void mutate({ showLoading: false });
    };
    const onRemoved = (e: { team_id: string; slot_id: string }) => {
      if (e.team_id !== teamId) return;
      setStatusMap((prev) => {
        const next = new Map(prev);
        next.delete(e.slot_id);
        return next;
      });
      void mutate({ showLoading: false });
    };
    const onRenamed = (e: { team_id: string }) => {
      if (e.team_id === teamId) void mutate({ showLoading: false });
    };
    const onStatus = (e: { team_id: string; slot_id: string; status: string }) => {
      if (e.team_id !== teamId) return;
      setStatusMap((prev) => {
        const next = new Map(prev);
        next.set(e.slot_id, normalizeTeamStatus(e.status));
        return next;
      });
    };
    const u1 = ipcBridge.team.onMemberSpawned.on(onSpawned);
    const u2 = ipcBridge.team.onMemberRemoved.on(onRemoved);
    const u3 = ipcBridge.team.onMemberRenamed.on(onRenamed);
    const u4 = ipcBridge.team.onAgentStatusChanged.on(onStatus);
    const u5 = ipcBridge.team.onSessionChanged.on(({ teamId: changedTeamId }) => {
      if (changedTeamId === teamId) void mutate({ showLoading: false });
    });
    return () => {
      u1();
      u2();
      u3();
      u4();
      u5();
    };
  }, [teamId, mutate]);

  const removeMember = useCallback(
    async (slotId: string) => {
      await ipcBridge.team.removeMember.invoke({ teamId, memberId: slotId });
      void mutate({ showLoading: false });
    },
    [teamId, mutate]
  );

  const currentTeam = team?.id === teamId ? team : null;
  const isTeamMismatch = !!team && team.id !== teamId;
  const currentLoading = loading || isTeamMismatch;

  return { team: currentTeam, statusMap, loading: currentLoading, mutate, removeMember };
}
