import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GuidSendDeps } from '@renderer/pages/guid/hooks/useGuidSend';

const state = vi.hoisted(() => ({ create: vi.fn(), loading: vi.fn(), error: vi.fn(), isEnterprise: true }));
vi.mock('@arco-design/web-react', () => ({ Message: { error: state.error, info: vi.fn() } }));
vi.mock('@sudowork/host-bridge/ipcBridge', () => ({ conversation: { create: { invoke: state.create } } }));
vi.mock('@renderer/hooks/useAppMode', () => ({ useAppMode: () => ({ isEnterprise: state.isEnterprise }) }));
vi.mock('@renderer/context/AuthContext', () => ({ useAuth: () => ({ isGuest: false }) }));
vi.mock('@renderer/hooks/useHasAvailableModel', () => ({ useHasAvailableModel: () => ({ hasModel: true, ready: true }) }));
vi.mock('@renderer/utils/platform', () => ({ isWebBridgeAvailable: () => false }));
vi.mock('@renderer/utils/workspaceHistory', () => ({ updateWorkspaceTime: vi.fn() }));
import { useGuidSend } from '@renderer/pages/guid/hooks/useGuidSend';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  state.isEnterprise = true;
});

describe('conversation creation outcomes', () => {
  function dependencies(overrides: Partial<GuidSendDeps> = {}): GuidSendDeps {
    return {
      input: 'Keep my draft',
      files: [],
      dir: '',
      selectedAgent: 'remote-agent',
      selectedAgentKey: 'remote-agent',
      sessionMode: 'remote',
      setLoading: state.loading,
      setInput: vi.fn(),
      setFiles: vi.fn(),
      setDir: vi.fn(),
      setMentionOpen: vi.fn(),
      setMentionQuery: vi.fn(),
      setMentionSelectorOpen: vi.fn(),
      setMentionActiveIndex: vi.fn(),
      resetAgentSelection: vi.fn(),
      setSelectedSkills: vi.fn(),
      navigate: vi.fn(),
      t: (key: string) => key,
      getEffectiveAgentType: () => ({ agentType: 'scode' }),
      resolvePresetRulesAndSkills: async () => ({}),
      resolveEnabledSkills: () => [],
      findAgentByKey: () => undefined,
      ...overrides,
    } as unknown as GuidSendDeps;
  }

  it('retains input and selection when the local runtime is unavailable', async () => {
    state.isEnterprise = false;
    const deps = dependencies({ selectedAgent: 'scode', selectedAgentKey: 'scode', sessionMode: 'local' });
    const { result } = renderHook(() => useGuidSend(deps));
    await act(async () => {
      result.current.sendMessageHandler();
    });
    expect(state.error).toHaveBeenCalledOnce();
    expect(state.create).not.toHaveBeenCalled();
    expect(deps.setInput).not.toHaveBeenCalled();
    expect(deps.resetAgentSelection).not.toHaveBeenCalled();
  });

  it('reports an empty local create response and retains the draft', async () => {
    state.isEnterprise = false;
    state.create.mockResolvedValue(undefined);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const deps = dependencies({ selectedAgent: 'claude', selectedAgentKey: 'claude', sessionMode: 'local', getEffectiveAgentType: () => ({ agentType: 'claude' }) as any });
    const { result } = renderHook(() => useGuidSend(deps));
    await act(async () => {
      result.current.sendMessageHandler();
    });
    expect(state.create).toHaveBeenCalledOnce();
    expect(state.error).toHaveBeenCalledWith('Error: conversation.createFailed');
    expect(deps.setInput).not.toHaveBeenCalled();
  });

  it('creates once for repeated Enter while startup is pending, and permits retry after failure', async () => {
    let rejectCreate!: (reason: Error) => void;
    state.create.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectCreate = reject;
        })
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const deps = dependencies();
    const { result } = renderHook(() => useGuidSend(deps));
    await act(async () => {
      result.current.sendMessageHandler();
      result.current.sendMessageHandler();
      result.current.sendMessageHandler();
    });
    expect(state.create).toHaveBeenCalledOnce();
    await act(async () => {
      rejectCreate(new Error('Startup failed'));
    });
    expect(deps.setInput).not.toHaveBeenCalled();
    await act(async () => {
      result.current.sendMessageHandler();
    });
    expect(state.create).toHaveBeenCalledTimes(2);
    await act(async () => {
      rejectCreate(new Error('Retry failed'));
    });
  });
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
