/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';
import type { ITeamChildTurnEvent, ITeamRunEvent } from '@sudowork/host-bridge/ipcBridge';
import { ipcBridge } from '@/common';
import { unwrapTeamResult } from '../utils';

const TERMINAL = new Set(['completed', 'cancelled', 'failed']);

/**
 * useTeamRunView — active run + child-turn index (附录 II.7). Subscribes to team.run* / childTurn*
 * events (team_id-filtered) and reconciles the full state from getRunState on mount and after a
 * realtime reconnect. Stage-5 simplified: tracks the active run + child turns by slot.
 */
export function useTeamRunView(teamId: string) {
  const [activeRun, setActiveRun] = useState<ITeamRunEvent | null>(null);
  const [childTurnsBySlot, setChildTurnsBySlot] = useState<Record<string, ITeamChildTurnEvent | undefined>>({});

  const reconcile = useCallback(async () => {
    try {
      const state = unwrapTeamResult(await ipcBridge.team.getRunState.invoke({ teamId }));
      setActiveRun(state?.active_run ?? null);
    } catch {
      /* ignore — stale snapshot */
    }
  }, [teamId]);

  useEffect(() => {
    void reconcile();
  }, [reconcile]);

  // Route param change reuses this component instance (no remount), so stale per-slot entries
  // from the previous team would survive — clear them on teamId change.
  useEffect(() => {
    setChildTurnsBySlot({});
  }, [teamId]);

  useEffect(() => {
    const isOurs = (e: { team_id: string }) => e.team_id === teamId;
    const setRun = (e: ITeamRunEvent) => {
      if (!isOurs(e)) return;
      setActiveRun(TERMINAL.has(e.status) ? null : e);
      // Terminal run: no child of this run can still be active — clear stale entries (belt and
      // braces for any backend path that removes children without a terminal child event).
      if (TERMINAL.has(e.status)) setChildTurnsBySlot({});
    };
    const onChildStarted = (e: ITeamChildTurnEvent) => {
      if (!isOurs(e)) return;
      setChildTurnsBySlot((prev) => ({ ...prev, [e.slot_id]: e }));
    };
    const onChildTerminal = (e: ITeamChildTurnEvent) => {
      if (!isOurs(e)) return;
      setChildTurnsBySlot((prev) => {
        const next = { ...prev };
        delete next[e.slot_id];
        return next;
      });
    };
    const unsubs = [
      ipcBridge.team.onRunAccepted.on(setRun),
      ipcBridge.team.onRunStarted.on(setRun),
      ipcBridge.team.onRunUpdated.on(setRun),
      ipcBridge.team.onRunCompleted.on(setRun),
      ipcBridge.team.onRunCancelled.on(setRun),
      ipcBridge.team.onRunFailed.on(setRun),
      ipcBridge.team.onChildTurnStarted.on(onChildStarted),
      ipcBridge.team.onChildTurnCompleted.on(onChildTerminal),
      ipcBridge.team.onChildTurnCancelled.on(onChildTerminal),
      ipcBridge.team.onListChanged.on(() => {
        if (isOurs({ team_id: teamId })) void reconcile();
      }),
      ipcBridge.realtime.reconnected.on(() => void reconcile()),
    ];
    return () => unsubs.forEach((u) => u());
  }, [teamId, reconcile]);

  return { activeRun, childTurnsBySlot, reconcile };
}
