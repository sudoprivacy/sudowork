import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ensureSessionInvoke = vi.fn();
let agentStatusChangedCallback: ((event: { team_id: string; slot_id: string; status: string; last_message?: string }) => void) | null = null;
let sessionChangedCallback: ((event: { teamId: string; status?: 'starting' | 'ready' | 'failed'; error?: string }) => void) | null = null;

const onAgentStatusChanged = vi.fn((cb: (event: { team_id: string; slot_id: string; status: string; last_message?: string }) => void) => {
  agentStatusChangedCallback = cb;
  return () => {
    agentStatusChangedCallback = null;
  };
});

const onSessionChanged = vi.fn((cb: (event: { teamId: string; status?: 'starting' | 'ready' | 'failed'; error?: string }) => void) => {
  sessionChangedCallback = cb;
  return () => {
    sessionChangedCallback = null;
  };
});

vi.mock('@/common', () => ({
  ipcBridge: {
    team: {
      ensureSession: { invoke: (...args: unknown[]) => ensureSessionInvoke(...args) },
      onAgentStatusChanged: { on: (...args: unknown[]) => onAgentStatusChanged(...args) },
      onSessionChanged: { on: (...args: unknown[]) => onSessionChanged(...args) },
    },
  },
}));

import { useTeamWarmup } from '../../src/renderer/pages/team/hooks/useTeamWarmup';

describe('useTeamWarmup', () => {
  beforeEach(() => {
    ensureSessionInvoke.mockReset();
    ensureSessionInvoke.mockResolvedValue(undefined);
    onAgentStatusChanged.mockClear();
    onSessionChanged.mockClear();
    agentStatusChangedCallback = null;
    sessionChangedCallback = null;
  });

  it('starts ensureSession and transitions to ready on success', async () => {
    const { result } = renderHook(() => useTeamWarmup('team-1'));

    expect(result.current.phase).toBe('warming');
    expect(ensureSessionInvoke).toHaveBeenCalledWith({ teamId: 'team-1' });
    await waitFor(() => expect(result.current.phase).toBe('ready'));
  });

  it('updates phase from session events and keeps old teamId-only events compatible', async () => {
    const { result } = renderHook(() => useTeamWarmup('team-1'));
    await waitFor(() => expect(result.current.phase).toBe('ready'));

    act(() => {
      sessionChangedCallback?.({ teamId: 'team-1', status: 'starting' });
    });
    expect(result.current.phase).toBe('warming');

    act(() => {
      sessionChangedCallback?.({ teamId: 'team-1' });
    });
    expect(result.current.phase).toBe('warming');

    act(() => {
      sessionChangedCallback?.({ teamId: 'team-1', status: 'failed', error: 'boom' });
    });
    expect(result.current.phase).toBe('error');
    expect(result.current.error).toBe('boom');

    act(() => {
      sessionChangedCallback?.({ teamId: 'team-1', status: 'ready' });
    });
    expect(result.current.phase).toBe('ready');
    expect(result.current.error).toBeUndefined();
  });

  it('tracks per-member runtime status and retries ensureSession', async () => {
    const { result } = renderHook(() => useTeamWarmup('team-1'));
    await waitFor(() => expect(result.current.phase).toBe('ready'));

    act(() => {
      agentStatusChangedCallback?.({ team_id: 'team-1', slot_id: 'slot-1', status: 'thinking', last_message: 'starting' });
      agentStatusChangedCallback?.({ team_id: 'other-team', slot_id: 'slot-2', status: 'failed' });
    });
    expect(result.current.runtimeStatus.get('slot-1')).toEqual({ status: 'active', error: 'starting' });
    expect(result.current.runtimeStatus.has('slot-2')).toBe(false);

    ensureSessionInvoke.mockClear();
    act(() => {
      result.current.onRetry();
    });
    await waitFor(() => expect(ensureSessionInvoke).toHaveBeenCalledWith({ teamId: 'team-1' }));
  });

  it('switches to error when ensureSession rejects', async () => {
    ensureSessionInvoke.mockRejectedValueOnce(new Error('failed to start'));

    const { result } = renderHook(() => useTeamWarmup('team-1'));

    await waitFor(() => expect(result.current.phase).toBe('error'));
    expect(result.current.error).toBe('failed to start');
  });
});
