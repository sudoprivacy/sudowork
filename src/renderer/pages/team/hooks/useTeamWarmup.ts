import { useCallback, useEffect, useState } from 'react';
import { ipcBridge } from '@/common';
import { normalizeTeamStatus } from '../mapper';
import { unwrapTeamResult } from '../utils';
import type { TeammateStatus } from '../types';

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

    return () => {
      isCancelled = true;
      unsubStatus();
      unsubSession();
    };
  }, [teamId]);

  useEffect(() => {
    if (!teamId) return;
    let isCancelled = false;
    setPhase('warming');
    setError(undefined);
    void ipcBridge.team.ensureSession
      .invoke({ teamId })
      .then((result) => {
        unwrapTeamResult(result);
        if (!isCancelled) setPhase('ready');
      })
      .catch((err) => {
        if (isCancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setPhase('error');
      });
    return () => {
      isCancelled = true;
    };
  }, [teamId, ensureAttempt]);

  const onRetry = useCallback(() => {
    if (!teamId) return;
    setEnsureAttempt((attempt) => attempt + 1);
  }, [teamId]);

  return { phase, runtimeStatus, error, onRetry };
}
