import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  mode: 'local',
  isEnterprise: true,
  saveConfig: vi.fn(),
  readConfig: vi.fn(),
  loadInstalled: vi.fn(),
  loadMossModels: vi.fn(),
  loadUserModel: vi.fn(),
  local: [] as any[],
  cloud: [] as any[],
  available: [{ backend: 'scode', name: 'Sudo Code' }],
  mine: [{ ref: 'moss-agent:own:22222222-2222-4222-8222-222222222222', displayName: 'Research', kind: 'own' }],
  listeners: new Map<string, () => void>(),
}));
vi.mock('swr', () => ({ default: () => ({ data: state.available }), mutate: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@renderer/hooks/useAppMode', () => ({ useAppMode: () => ({ isEnterprise: state.isEnterprise }) }));
vi.mock('@renderer/context/AuthContext', () => ({ EECLAW_AUTH_STORAGE_KEY: 'eeclaw_auth_v1' }));
vi.mock('@renderer/shared/dify/sessionBinding', () => ({ readAccessToken: () => 'test-token' }));
vi.mock('@sudowork/common/storage', () => ({ ConfigStorage: { get: state.readConfig, set: state.saveConfig } }));
vi.mock('@renderer/utils/emitter', () => ({ emitter: { on: (event: string, callback: () => void) => state.listeners.set(event, callback), off: (event: string) => state.listeners.delete(event), emit: (event: string) => state.listeners.get(event)?.() } }));
vi.mock('@sudowork/host-bridge/ipcBridge', () => {
  const installed = async () => ({ data: await state.loadInstalled() });
  return {
    eeclaw: { getMyAgents: { invoke: async () => ({ success: true, data: state.mine }) }, getCloudAssistants: { invoke: async () => ({ data: state.cloud }) }, setSessionMode: { invoke: async () => undefined } },
    extensions: { getAssistants: { invoke: async () => [] } },
    assistantHub: { getInstalledAssistants: { invoke: installed }, getInstalledAssistantsWithVisibility: { invoke: installed } },
    acpConversation: { refreshCustomAgents: { invoke: async () => undefined }, rescanAgents: { invoke: async () => undefined }, probeModelInfo: { invoke: async () => ({ success: false }) }, getAvailableAgents: { invoke: async () => ({ data: state.available }) } },
    moss: { getAvailableModels: { invoke: state.loadMossModels }, getUserModel: { invoke: state.loadUserModel }, setUserModel: { invoke: async () => undefined } },
  };
});

import { useGuidAgentSelection, getRendererSessionMode, setRendererSessionMode } from '@renderer/pages/guid/hooks/useGuidAgentSelection';

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) || null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key), clear: () => storage.clear() });
  state.mode = 'local';
  state.isEnterprise = true;
  state.saveConfig.mockReset().mockResolvedValue(undefined);
  state.loadMossModels.mockReset().mockResolvedValue({ success: false });
  state.loadUserModel.mockReset().mockResolvedValue({ success: false });
  state.local = [];
  state.cloud = [];
  setRendererSessionMode('remote');
  state.readConfig.mockReset().mockImplementation(async (key: string) => (key === 'guid.sessionMode' ? state.mode : undefined));
  state.loadInstalled
    .mockReset()
    .mockImplementation(async () => state.local.map((agent) => ({ name: agent.id, enabled: agent.enabled, isBuiltin: false, isHubInstalled: false, meta: { nameI18n: { 'en-US': agent.name }, presetAgentType: agent.presetAgentType, ontologyBinding: agent.ontologyBinding } })));
  state.listeners.clear();
  localStorage.setItem('eeclaw_auth_v1', JSON.stringify({ user: { localModeAvailable: true } }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('personal Agent selection through picker refreshes', () => {
  it('uses Cloud mode before the Guid page mounts in the WebUI host', () => {
    vi.stubGlobal('electronAPI', undefined);
    vi.stubGlobal('__sudoworkWebBridge', true);
    setRendererSessionMode('local');
    expect(getRendererSessionMode()).toBe('remote');
  });
  it('preserves the Desktop local execution preference', () => {
    vi.stubGlobal('__sudoworkWebBridge', false);
    setRendererSessionMode('local');
    expect(getRendererSessionMode()).toBe('local');
  });
  it('defaults an online account to cloud when there is no execution preference', async () => {
    state.readConfig.mockImplementation(async () => undefined);
    const { result } = renderHook(() => useGuidAgentSelection({ localeKey: 'en-US', assistantFromUrl: state.mine[0].ref }));
    await waitFor(() => expect(result.current.selectedAgentInfo?.customAgentId).toBe(state.mine[0].ref));
    expect(result.current.sessionMode).toBe('remote');
  });

  it('retains the personal Agent when its execution target changes', async () => {
    const ref = state.mine[0].ref;
    const { result } = renderHook(() => useGuidAgentSelection({ localeKey: 'en-US', assistantFromUrl: ref }));
    await waitFor(() => expect(result.current.selectedAgentInfo?.customAgentId).toBe(ref));
    await act(async () => result.current.setSessionMode('remote'));
    await waitFor(() => {
      expect(result.current.sessionMode).toBe('remote');
      expect(result.current.selectedAgentInfo?.customAgentId).toBe(ref);
    });
  });

  it('keeps the personal Agent ready while an independent task template is selected', async () => {
    state.cloud = [{ key: 'recruiter-template', name: 'Recruiter' }];
    const ref = state.mine[0].ref;
    const { result } = renderHook(() => useGuidAgentSelection({ localeKey: 'en-US', assistantFromUrl: ref }));
    await waitFor(() => expect(result.current.selectedAgentInfo?.customAgentId).toBe(ref));
    expect(result.current.isAgentSelectionPending).toBe(false);
    act(() => result.current.setSelectedAgentKey('custom:recruiter-template'));
    await waitFor(() => expect(result.current.selectedAgentInfo?.customAgentId).toBe('recruiter-template'));
    expect(result.current.isAgentSelectionPending).toBe(false);
  });

  it('loads cloud models after switching away during an unfinished request', async () => {
    state.mode = 'remote';
    const requests: Array<(value: IMossModelCatalogResult) => void> = [];
    state.loadMossModels.mockImplementation(() => new Promise<IMossModelCatalogResult>((resolve) => requests.push(resolve)));
    const ref = state.mine[0].ref;
    const { result } = renderHook(() => useGuidAgentSelection({ localeKey: 'en-US', assistantFromUrl: ref }));
    await waitFor(() => {
      expect(result.current.selectedAgentInfo?.customAgentId).toBe(ref);
      expect(requests).toHaveLength(1);
    });
    await act(async () => result.current.setSessionMode('local'));
    await waitFor(() => expect(result.current.sessionMode).toBe('local'));
    await act(async () => result.current.setSessionMode('remote'));
    await waitFor(() => expect(requests).toHaveLength(2));
    await act(async () => requests[1]({ success: true, data: [{ id: 'current-model', name: 'Current model' }] }));
    await waitFor(() => expect(result.current.selectedAcpModel).toBe('current-model'));
    await act(async () => requests[0]({ success: true, data: [{ id: 'stale-model', name: 'Stale model' }] }));
    expect(result.current.currentAcpCachedModelInfo?.availableModels).toEqual([{ id: 'current-model', label: 'Current model' }]);
    expect(result.current.selectedAcpModel).toBe('current-model');
  });

  it('keeps a named template URL pending when multiple templates share that name', async () => {
    state.isEnterprise = false;
    state.local = [
      { id: 'first-template', name: 'Research', enabled: true },
      { id: 'second-template', name: 'Research', enabled: true },
    ];
    const { result, rerender } = renderHook(({ reference }) => useGuidAgentSelection({ localeKey: 'en-US', assistantFromUrl: reference }), { initialProps: { reference: 'Research' } });
    await waitFor(() => expect(result.current.customAgents).toHaveLength(2));
    expect(result.current.isAgentSelectionPending).toBe(true);
    rerender({ reference: 'second-template' });
    await waitFor(() => expect(result.current.isAgentSelectionPending).toBe(false));
    expect(result.current.selectedAgentInfo?.customAgentId).toBe('second-template');
  });
  it.each(['local', 'remote'])('retains the URL identity after initial and event refreshes in %s mode', async (mode) => {
    state.mode = mode;
    const ref = state.mine[0].ref;
    const { result } = renderHook(() => useGuidAgentSelection({ localeKey: 'en-US', assistantFromUrl: ref }));
    await waitFor(() => expect(result.current.selectedAgentInfo?.customAgentId).toBe(ref));
    await act(async () => {
      state.listeners.get('assistants.changed')?.();
    });
    await waitFor(() => {
      expect(result.current.customAgents.some((agent) => agent.id === ref)).toBe(true);
      expect(result.current.selectedAgentInfo?.customAgentId).toBe(ref);
      expect(result.current.selectedAgentInfo?.name).toBe('Research');
    });
  });
});

interface IMossModelCatalogResult {
  success: boolean;
  data: Array<{ id: string; name: string }>;
}

describe('cloud model catalog readiness', () => {
  it('does not advertise a saved model when credential rejection leaves the catalog empty', async () => {
    state.mode = 'remote';
    state.loadMossModels.mockResolvedValue({ success: true, data: [] });
    state.loadUserModel.mockResolvedValue({ success: true, data: { modelId: 'legacy-default:gpt-6-astra' } });
    const { result } = renderHook(() => useGuidAgentSelection({ localeKey: 'en-US' }));
    await waitFor(() => expect(result.current.remoteModelStatus).toBe('empty'));
    expect(result.current.selectedAcpModel).toBeNull();
    expect(result.current.currentAcpCachedModelInfo?.availableModels).toEqual([]);
    expect(state.loadUserModel).not.toHaveBeenCalled();
    expect(state.loadMossModels).toHaveBeenCalledOnce();
  });

  it.each(['rejected', 'failed'])('reports a %s catalog lookup without retrying it', async (outcome) => {
    state.mode = 'remote';
    if (outcome === 'rejected') state.loadMossModels.mockRejectedValue(new Error('MODEL_SERVICE_UNAVAILABLE'));
    else state.loadMossModels.mockResolvedValue({ success: false });
    const { result } = renderHook(() => useGuidAgentSelection({ localeKey: 'en-US' }));
    await waitFor(() => expect(result.current.remoteModelStatus).toBe('error'));
    expect(state.loadMossModels).toHaveBeenCalledOnce();
  });

  it.each([null, 'removed-provider:retired-model'])('resolves an unqualified system default after preference %s', async (preference) => {
    state.mode = 'remote';
    state.loadMossModels.mockResolvedValue({
      success: true,
      data: [
        { id: 'legacy-default:gpt-6-luna', name: 'Luna' },
        { id: 'legacy-default:claude-sonnet-4-6', name: 'Sonnet' },
      ],
    });
    state.loadUserModel.mockResolvedValue({ success: true, data: { modelId: preference, systemDefaultModel: 'claude-sonnet-4-6' } });
    const { result } = renderHook(() => useGuidAgentSelection({ localeKey: 'en-US' }));
    await waitFor(() => expect(result.current.remoteModelStatus).toBe('available'));
    expect(result.current.selectedAcpModel).toBe('legacy-default:claude-sonnet-4-6');
  });
});

describe('registered ontology Agent selection', () => {
  it('ignores a late ordinary preference read after entering the ontology page', async () => {
    state.local = [{ id: 'ontology-scoped', name: 'Orders', enabled: true, ontologyBinding: { workspaceId: 'orders', versionId: 'v1', blueprintId: 'first' } }];
    let finishPreference!: (value: string) => void;
    state.readConfig.mockImplementation((key: string) =>
      key === 'guid.sessionMode'
        ? new Promise((resolve) => {
            finishPreference = resolve;
          })
        : Promise.resolve(undefined)
    );
    const { result, rerender } = renderHook(({ assistantFromUrl, isOntologyEntry }) => useGuidAgentSelection({ localeKey: 'en-US', assistantFromUrl, isOntologyEntry }), { initialProps: { assistantFromUrl: state.mine[0].ref, isOntologyEntry: false } });
    await waitFor(() => expect(result.current.selectedAgentInfo?.customAgentId).toBe(state.mine[0].ref));
    rerender({ assistantFromUrl: 'ontology-scoped', isOntologyEntry: true });
    await waitFor(() => expect(result.current.selectedAgentInfo?.customAgentId).toBe('ontology-scoped'));
    state.saveConfig.mockClear();
    await act(async () => {
      finishPreference('local');
    });
    expect(result.current.selectedAgentInfo?.customAgentId).toBe('ontology-scoped');
    expect(getRendererSessionMode()).toBe('remote');
    expect(state.saveConfig).not.toHaveBeenCalled();
  });

  it('does not leak a late ontology refresh into the ordinary conversation page', async () => {
    state.mode = 'remote';
    state.local = [{ id: 'ontology-scoped', name: 'Orders', enabled: true, ontologyBinding: { workspaceId: 'orders', versionId: 'v1', blueprintId: 'first' } }];
    const { result, rerender } = renderHook(({ assistantFromUrl, isOntologyEntry }) => useGuidAgentSelection({ localeKey: 'en-US', assistantFromUrl, isOntologyEntry }), { initialProps: { assistantFromUrl: 'ontology-scoped', isOntologyEntry: true } });
    await waitFor(() => expect(result.current.selectedAgentInfo?.customAgentId).toBe('ontology-scoped'));
    const previous = await state.loadInstalled();
    let finish!: (value: any[]) => void;
    state.loadInstalled.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.refreshCustomAgents();
    });
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    rerender({ assistantFromUrl: state.mine[0].ref, isOntologyEntry: false });
    await waitFor(() => expect(result.current.selectedAgentInfo?.customAgentId).toBe(state.mine[0].ref));
    await act(async () => {
      finish(previous);
      await pending;
    });
    expect(result.current.customAgents.some((agent) => agent.ontologyBinding)).toBe(false);
    expect(result.current.sessionMode).toBe('remote');
    expect(result.current.selectedAgentInfo?.customAgentId).toBe(state.mine[0].ref);
  });

  it('preserves two same-name version identities across picker refreshes in local mode', async () => {
    state.mode = 'remote';
    state.local = [
      { id: 'ontology-first', name: 'Orders agent', enabled: true, isPreset: true, presetAgentType: 'scode', ontologyBinding: { workspaceId: 'orders', versionId: 'v1', blueprintId: 'first' } },
      { id: 'ontology-second', name: 'Orders agent', enabled: true, isPreset: true, presetAgentType: 'scode', ontologyBinding: { workspaceId: 'orders', versionId: 'v2', blueprintId: 'second' } },
      { id: 'ordinary-local', name: 'Other local template', enabled: true, isPreset: true },
    ];
    const { result } = renderHook(() => useGuidAgentSelection({ localeKey: 'en-US', assistantFromUrl: 'ontology-second', isOntologyEntry: true }));
    await waitFor(() => expect(result.current.selectedAgentInfo?.customAgentId).toBe('ontology-second'));
    expect(result.current.isPresetAgent).toBe(true);
    expect(result.current.customAgents.filter((agent) => agent.ontologyBinding)).toHaveLength(1);
    expect(result.current.sessionMode).toBe('local');
    expect(state.mode).toBe('remote');
    expect(state.saveConfig).not.toHaveBeenCalledWith('guid.sessionMode', expect.anything());
    expect(state.saveConfig).not.toHaveBeenCalledWith('guid.lastSelectedAgent', expect.anything());
    expect(result.current.customAgents.some((agent) => agent.id === 'ordinary-local')).toBe(false);
    await act(async () => {
      await result.current.refreshCustomAgents();
    });
    expect(result.current.selectedAgentInfo?.customAgentId).toBe('ontology-second');
  });

  it('reuses the same scoped entry in offline mode', async () => {
    state.isEnterprise = false;
    state.local = [{ id: 'ontology-offline', name: 'Offline ontology', enabled: true, presetAgentType: 'scode', ontologyBinding: { workspaceId: 'orders', versionId: 'v1', blueprintId: 'offline' } }];
    const { result } = renderHook(() => useGuidAgentSelection({ localeKey: 'en-US', assistantFromUrl: 'ontology-offline', isOntologyEntry: true }));
    await waitFor(() => expect(result.current.selectedAgentInfo?.customAgentId).toBe('ontology-offline'));
    expect(result.current.isPresetAgent).toBe(true);
    expect(state.saveConfig).not.toHaveBeenCalledWith('guid.lastSelectedAgent', expect.anything());
  });

  it('leaves the ordinary local entry and its agent list unchanged', async () => {
    state.local = [{ id: 'ontology-local', name: 'Orders agent', enabled: true, ontologyBinding: { workspaceId: 'orders', versionId: 'v1', blueprintId: 'first' } }];
    const { result } = renderHook(() => useGuidAgentSelection({ localeKey: 'en-US', assistantFromUrl: state.mine[0].ref }));
    await waitFor(() => expect(result.current.selectedAgentInfo?.customAgentId).toBe(state.mine[0].ref));
    expect(result.current.customAgents.some((agent) => agent.id === 'ontology-local')).toBe(false);
  });

  it('keeps local ontology agents out of cloud execution', async () => {
    state.mode = 'remote';
    state.local = [{ id: 'ontology-local', name: 'Orders agent', enabled: true, isPreset: true, ontologyBinding: { workspaceId: 'orders', versionId: 'v1', blueprintId: 'first' } }];
    const { result } = renderHook(() => useGuidAgentSelection({ localeKey: 'en-US' }));
    await waitFor(() => expect(result.current.sessionMode).toBe('remote'));
    await act(async () => {
      await result.current.refreshCustomAgents();
    });
    expect(result.current.customAgents.some((agent) => agent.id === 'ontology-local')).toBe(false);
  });

  it('preserves ontology metadata without changing general preset classification', async () => {
    const { toBackendConfig } = await vi.importActual<typeof import('@renderer/shared/agents/assistantAdapter')>('@renderer/shared/agents/assistantAdapter');
    const binding = { workspaceId: 'orders', versionId: 'v1', blueprintId: 'first' };
    const config = toBackendConfig({ name: 'ontology-first', enabled: true, isBuiltin: false, isHubInstalled: false, meta: { ontologyBinding: binding, presetAgentType: 'scode' } } as any);
    expect(config).toMatchObject({ id: 'ontology-first', isPreset: false, ontologyBinding: binding });
  });
});
