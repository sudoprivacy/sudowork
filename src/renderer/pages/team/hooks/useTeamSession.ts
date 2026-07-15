import { useCallback, useEffect, useState } from 'react';
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

  const mutate = useCallback(async () => {
    setLoading(true);
    try {
      const detail = await fetchTeamDetail(teamId);
      setTeam(detail);
      if (detail) {
        setStatusMap((prev) => {
          const next = new Map(prev);
          for (const a of detail.assistants) next.set(a.slot_id, a.status);
          return next;
        });
      }
    } catch {
      setTeam(null);
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  useEffect(() => {
    void mutate();
  }, [mutate]);

  useEffect(() => {
    const onSpawned = (e: { team_id: string }) => {
      if (e.team_id === teamId) void mutate();
    };
    const onRemoved = (e: { team_id: string; slot_id: string }) => {
      if (e.team_id !== teamId) return;
      setStatusMap((prev) => {
        const next = new Map(prev);
        next.delete(e.slot_id);
        return next;
      });
      void mutate();
    };
    const onRenamed = (e: { team_id: string }) => {
      if (e.team_id === teamId) void mutate();
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
    return () => {
      u1();
      u2();
      u3();
      u4();
    };
  }, [teamId, mutate]);

  const removeMember = useCallback(
    async (slotId: string) => {
      await ipcBridge.team.removeMember.invoke({ teamId, memberId: slotId });
      void mutate();
    },
    [teamId, mutate]
  );

  return { team, statusMap, loading, mutate, removeMember };
}
