/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect } from 'react';
import useSWR from 'swr';
import { ipcBridge } from '@/common';
import { fromBackendTeam } from '../mapper';
import type { TTeam } from '../types';
import { unwrapTeamResult } from '../utils';

async function fetchTeams(): Promise<TTeam[]> {
  // No per-team listMembers here: the only consumer (TeamSiderSection) renders id/name/pinned,
  // and one failing listMembers would reject the whole Promise.all and blank the sidebar. The
  // export flow fetches members on demand instead (useTeamExport.buildTeamExportFiles).
  const teams = unwrapTeamResult(await ipcBridge.team.listTeams.invoke()) ?? [];
  return teams.map((t) => fromBackendTeam(t, []));
}

/**
 * useTeams — the C-end team list (附录 II.3). SWR-cached on mount; revalidates on team list events.
 */
export function useTeams() {
  const { data, mutate, isLoading } = useSWR(['teams'], fetchTeams, {
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
