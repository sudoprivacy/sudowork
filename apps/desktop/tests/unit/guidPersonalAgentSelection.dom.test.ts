import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  mode: 'local',
  available: [{ backend: 'scode', name: 'Sudo Code' }],
  mine: [{ ref: 'moss-agent:own:22222222-2222-4222-8222-222222222222', displayName: 'Research', kind: 'own' }],
  listeners: new Map<string, () => void>(),
}));
vi.mock('swr', () => ({ default: () => ({ data: state.available }), mutate: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@renderer/hooks/useAppMode', () => ({ useAppMode: () => ({ isEnterprise: true }) }));
vi.mock('@renderer/context/AuthContext', () => ({ EECLAW_AUTH_STORAGE_KEY: 'eeclaw_auth_v1' }));
vi.mock('@renderer/shared/dify/sessionBinding', () => ({ readAccessToken: () => 'test-token' }));
vi.mock('@renderer/shared/agents/assistantAdapter', () => ({ fetchAssistantsAsConfigs: async () => [], fetchVisibleAssistantsAsConfigs: async () => [] }));
vi.mock('@sudowork/common/storage', () => ({ ConfigStorage: { get: async (key: string) => (key === 'guid.sessionMode' ? state.mode : undefined), set: async () => undefined } }));
vi.mock('@renderer/utils/emitter', () => ({ emitter: { on: (event: string, callback: () => void) => state.listeners.set(event, callback), off: (event: string) => state.listeners.delete(event), emit: (event: string) => state.listeners.get(event)?.() } }));
vi.mock('@sudowork/host-bridge/ipcBridge', () => ({
  eeclaw: { getMyAgents: { invoke: async () => ({ success: true, data: state.mine }) }, getCloudAssistants: { invoke: async () => ({ data: [] }) }, setSessionMode: { invoke: async () => undefined } },
  extensions: { getAssistants: { invoke: async () => [] } },
  assistantHub: { getInstalledAssistants: { invoke: async () => ({ data: [] }) }, getInstalledAssistantsWithVisibility: { invoke: async () => ({ data: [] }) } },
  acpConversation: { refreshCustomAgents: { invoke: async () => undefined }, rescanAgents: { invoke: async () => undefined }, probeModelInfo: { invoke: async () => ({ success: false }) }, getAvailableAgents: { invoke: async () => ({ data: state.available }) } },
  moss: { getAvailableModels: { invoke: async () => ({ success: false }) }, getUserModel: { invoke: async () => ({ success: false }) }, setUserModel: { invoke: async () => undefined } },
}));

import { useGuidAgentSelection } from '@renderer/pages/guid/hooks/useGuidAgentSelection';

beforeEach(() => {
  state.mode = 'local';
  state.listeners.clear();
  localStorage.setItem('eeclaw_auth_v1', JSON.stringify({ user: { localModeAvailable: true } }));
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('personal Agent selection through picker refreshes', () => {
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
