import { useEffect } from 'react';
import useSWR from 'swr';
import { ipcBridge } from '@/common';
import { useAuth } from '@/renderer/context/AuthContext';
import { fromBackendTeam } from '../mapper';
import type { TTeam } from '../types';
import { unwrapTeamResult } from '../utils';

async function fetchTeams(userId: string): Promise<TTeam[]> {
  const teams = unwrapTeamResult(await ipcBridge.team.listTeams.invoke({ userId })) ?? [];
  const withMembers = await Promise.all(
    teams.map(async (t) => {
      const members = unwrapTeamResult(await ipcBridge.team.listMembers.invoke({ teamId: t.id })) ?? [];
      return fromBackendTeam(t, members);
    })
  );
  return withMembers;
}

/**
 * useTeams — the C-end team list (附录 II.3). SWR-cached by user id; revalidates on team list events.
 */
export function useTeams() {
  const { user } = useAuth();
  const userId = user?.id;
  const { data, mutate, isLoading } = useSWR(userId ? ['teams', userId] : null, () => fetchTeams(userId!), {
    revalidateOnFocus: false,
  });

  useEffect(() => {
    const unsub = ipcBridge.team.onListChanged.on(() => {
      void mutate();
    });
    return () => unsub();
  }, [mutate]);

  return { teams: data ?? [], mutate, isLoading };
}
