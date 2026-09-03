/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';
import * as ipcBridge from '@sudowork/host-bridge/ipcBridge';
import { withTimeout } from '@renderer/pages/conversation/grouped-history/utils/exportHelpers';
import { normalizeTeamStatus } from '../mapper';
import { unwrapTeamResult } from '../utils';
import type { TeammateStatus } from '../types';

/**
 * Failsafe for a session rebuild that neither resolves nor emits: without a deadline the overlay
 * would stay on "warming" forever with no way out. Generous on purpose — the rebuild path has no
 * real async waits, so it normally finishes in milliseconds; a late backend success still flips
 * the phase back to ready via the onSessionChanged listener.
 */
const ENSURE_SESSION_TIMEOUT_MS = 60_000;

export type TeamWarmupPhase = 'warming' | 'ready' | 'error';

export interface TeamWarmupMemberState {
  status: TeammateStatus;
  error?: string;
}

export function useTeamWarmup(teamId: string) {
  const [phase, setPhase] = useState<TeamWarmupPhase>(teamId ? 'warming' : 'ready');
  const [runtimeStatus, setRuntimeStatus] = useState<Map<string, TeamWarmupMemberState>>(() => new Map());
  const [error, setError] = useState<string | undefined>(undefined);
  const [ensureAttempt, setEnsureAttempt] = useState(0);

  const runEnsure = useCallback(
    (isCancelled: () => boolean) => {
      if (!teamId) return;
      setPhase('warming');
      setRuntimeStatus(new Map());
      setError(undefined);
      void withTimeout(ipcBridge.team.ensureSession.invoke({ teamId }), ENSURE_SESSION_TIMEOUT_MS, 'team.ensureSession')
        .then((result) => {
          unwrapTeamResult(result);
          if (!isCancelled()) setPhase('ready');
        })
        .catch((err) => {
          if (isCancelled()) return;
          setError(err instanceof Error ? err.message : String(err));
          setPhase('error');
        });
    },
    [teamId]
  );

  useEffect(() => {
    if (!teamId) {
      setPhase('ready');
      setRuntimeStatus(new Map());
      setError(undefined);
      return;
    }

    let isCancelled = false;
    setPhase('warming');
    setRuntimeStatus(new Map());
    setError(undefined);

    const unsubStatus = ipcBridge.team.onAgentStatusChanged.on((event) => {
      if (event.team_id !== teamId || isCancelled) return;
      setRuntimeStatus((prev) => {
        const next = new Map(prev);
        next.set(event.slot_id, { status: normalizeTeamStatus(event.status), error: event.last_message });
        return next;
      });
    });

    const unsubSession = ipcBridge.team.onSessionChanged.on((event) => {
      if (event.teamId !== teamId || isCancelled) return;
      if (event.status === 'starting') {
        setError(undefined);
        setPhase('warming');
      } else if (event.status === 'ready') {
        setError(undefined);
        setPhase('ready');
      } else if (event.status === 'failed') {
        setError(event.error);
        setPhase('error');
      }
    });

    const unsubReconnect = ipcBridge.realtime.reconnected.on(() => runEnsure(() => isCancelled));

    return () => {
      isCancelled = true;
      unsubStatus();
      unsubSession();
      unsubReconnect();
    };
  }, [teamId, runEnsure]);

  useEffect(() => {
    if (!teamId) return;
    let isCancelled = false;
    runEnsure(() => isCancelled);
    return () => {
      isCancelled = true;
    };
  }, [teamId, ensureAttempt, runEnsure]);

  const onRetry = useCallback(() => {
    if (!teamId) return;
    setEnsureAttempt((attempt) => attempt + 1);
  }, [teamId]);

  return { phase, runtimeStatus, error, onRetry };
}
