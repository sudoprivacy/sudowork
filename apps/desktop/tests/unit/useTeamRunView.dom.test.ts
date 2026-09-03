import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (event: any) => void;

const h = vi.hoisted(() => {
  const listeners = new Map<string, Listener>();
  const makeEmitter = (name: string) => ({
    on: vi.fn((cb: Listener) => {
      listeners.set(name, cb);
      return () => listeners.delete(name);
    }),
  });
  return {
    listeners,
    getRunState: vi.fn(),
    makeEmitter,
  };
});

vi.mock('@sudowork/host-bridge/ipcBridge', () => ({
  team: {
    getRunState: { invoke: (...args: unknown[]) => h.getRunState(...args) },
    onRunAccepted: h.makeEmitter('onRunAccepted'),
    onRunStarted: h.makeEmitter('onRunStarted'),
    onRunUpdated: h.makeEmitter('onRunUpdated'),
    onRunCompleted: h.makeEmitter('onRunCompleted'),
    onRunCancelled: h.makeEmitter('onRunCancelled'),
    onRunFailed: h.makeEmitter('onRunFailed'),
    onChildTurnStarted: h.makeEmitter('onChildTurnStarted'),
    onChildTurnCompleted: h.makeEmitter('onChildTurnCompleted'),
    onChildTurnCancelled: h.makeEmitter('onChildTurnCancelled'),
    onListChanged: h.makeEmitter('onListChanged'),
  },
  realtime: {
    reconnected: h.makeEmitter('reconnected'),
  },
}));

import { useTeamRunView } from '../../src/renderer/pages/team/hooks/useTeamRunView';

const childEvent = {
  team_id: 'team-1',
  team_run_id: 'run-1',
  slot_id: 'slot-1',
  role: 'teammate' as const,
  conversation_id: 'conv-1',
  turn_id: 'turn-1',
  status: 'started' as const,
};

const terminalRunEvent = {
  team_id: 'team-1',
  team_run_id: 'run-1',
  target_slot_id: 'slot-1',
  target_role: 'teammate' as const,
  status: 'completed' as const,
  active_child_count: 0,
  pending_wake_count: 0,
  starting_child_count: 0,
};

describe('useTeamRunView', () => {
  beforeEach(() => {
    h.listeners.clear();
    h.getRunState.mockReset();
    h.getRunState.mockReturnValue(new Promise(() => {}));
  });

  it('clears child turns when the team id changes without remounting', () => {
    const { result, rerender } = renderHook(({ teamId }) => useTeamRunView(teamId), { initialProps: { teamId: 'team-1' } });

    act(() => {
      h.listeners.get('onChildTurnStarted')?.(childEvent);
    });
    expect(result.current.childTurnsBySlot['slot-1']).toMatchObject({ turn_id: 'turn-1' });

    rerender({ teamId: 'team-2' });

    expect(result.current.childTurnsBySlot).toEqual({});
  });

  it('clears child turns when a terminal run event arrives', () => {
    const { result } = renderHook(() => useTeamRunView('team-1'));

    act(() => {
      h.listeners.get('onChildTurnStarted')?.(childEvent);
    });
    expect(result.current.childTurnsBySlot['slot-1']).toBeDefined();

    act(() => {
      h.listeners.get('onRunCompleted')?.(terminalRunEvent);
    });

    expect(result.current.activeRun).toBeNull();
    expect(result.current.childTurnsBySlot).toEqual({});
  });
});
