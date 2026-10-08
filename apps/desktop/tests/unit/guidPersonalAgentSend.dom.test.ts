import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GuidSendDeps } from '@renderer/pages/guid/hooks/useGuidSend';

const state = vi.hoisted(() => ({ create: vi.fn(), loading: vi.fn() }));
vi.mock('@sudowork/host-bridge/ipcBridge', () => ({ conversation: { create: { invoke: state.create } } }));
vi.mock('@renderer/hooks/useAppMode', () => ({ useAppMode: () => ({ isEnterprise: true }) }));
vi.mock('@renderer/context/AuthContext', () => ({ useAuth: () => ({ isGuest: false }) }));
vi.mock('@renderer/hooks/useHasAvailableModel', () => ({ useHasAvailableModel: () => ({ hasModel: true, ready: true }) }));
vi.mock('@renderer/utils/platform', () => ({ isWebBridgeAvailable: () => false }));
vi.mock('@renderer/utils/workspaceHistory', () => ({ updateWorkspaceTime: vi.fn() }));
import { useGuidSend } from '@renderer/pages/guid/hooks/useGuidSend';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('personal Agent submission while its identity loads', () => {
  it('blocks both Enter and direct submission without clearing the typed draft', async () => {
    const setInput = vi.fn();
    const dependencies = { input: 'A quickly typed message', isAgentSelectionPending: true, setLoading: state.loading, setInput, t: (key: string) => key } as unknown as GuidSendDeps;
    const { result } = renderHook(() => useGuidSend(dependencies));
    expect(result.current.isButtonDisabled).toBe(true);
    await act(async () => {
      result.current.sendMessageHandler();
      await result.current.handleSend();
    });
    expect(state.create).not.toHaveBeenCalled();
    expect(state.loading).not.toHaveBeenCalled();
    expect(setInput).not.toHaveBeenCalled();
  });
});
