import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GuidSendDeps } from '@renderer/pages/guid/hooks/useGuidSend';

const state = vi.hoisted(() => ({ create: vi.fn(), loading: vi.fn(), error: vi.fn() }));
vi.mock('@arco-design/web-react', () => ({ Message: { error: state.error, info: vi.fn() } }));
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
  vi.restoreAllMocks();
});

describe('personal Agent submission while its identity loads', () => {
  it.each(['rejected', 'empty'])('preserves the draft and reports a %s cloud startup failure without an alert', async (failure) => {
    const onSetInput = vi.fn();
    const onAlert = vi.spyOn(window, 'alert');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    if (failure === 'rejected') state.create.mockRejectedValue(new Error('Cloud runtime failed to start'));
    else state.create.mockResolvedValue(null);
    const dependencies = {
      input: 'Keep my draft',
      files: [],
      dir: '',
      selectedAgentKey: 'remote-agent',
      sessionMode: 'remote',
      isAgentSelectionPending: false,
      setLoading: state.loading,
      setInput: onSetInput,
      t: (key: string) => key,
      getEffectiveAgentType: () => ({ agentType: 'remote-agent' }),
      resolvePresetRulesAndSkills: async () => ({}),
      resolveEnabledSkills: () => [],
      findAgentByKey: () => undefined,
    } as unknown as GuidSendDeps;
    const { result } = renderHook(() => useGuidSend(dependencies));
    await act(async () => {
      result.current.sendMessageHandler();
    });
    expect(state.error).toHaveBeenCalledOnce();
    expect(onSetInput).not.toHaveBeenCalled();
    expect(onAlert).not.toHaveBeenCalled();
    expect(state.loading).toHaveBeenLastCalledWith(false);
  });
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
