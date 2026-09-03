import { describe, expect, it } from 'vitest';
import { resolveGuidModelBackendKey } from '@renderer/pages/guid/utils/modelBackendKey';

describe('resolveGuidModelBackendKey', () => {
  it('uses remote-agent for enterprise remote assistant selections', () => {
    expect(
      resolveGuidModelBackendKey({
        isEnterprise: true,
        sessionMode: 'remote',
        selectedAgentKey: 'custom:assistant-1',
        selectedAgentInfo: { backend: 'custom', name: 'Assistant', customAgentId: 'assistant-1', isPreset: true },
        customAgents: [{ id: 'assistant-1', name: 'Assistant', enabled: true, presetAgentType: 'scode' }],
      })
    ).toBe('remote-agent');
  });

  it('uses scode for enterprise local assistant selections', () => {
    expect(
      resolveGuidModelBackendKey({
        isEnterprise: true,
        sessionMode: 'local',
        selectedAgentKey: 'custom:assistant-1',
        selectedAgentInfo: { backend: 'custom', name: 'Assistant', customAgentId: 'assistant-1', isPreset: true },
        customAgents: [{ id: 'assistant-1', name: 'Assistant', enabled: true, presetAgentType: 'remote-agent' }],
      })
    ).toBe('scode');
  });

  it('uses the preset backend for non-enterprise custom assistants', () => {
    expect(
      resolveGuidModelBackendKey({
        isEnterprise: false,
        sessionMode: 'remote',
        selectedAgentKey: 'custom:assistant-1',
        selectedAgentInfo: { backend: 'custom', name: 'Assistant', customAgentId: 'assistant-1', isPreset: true },
        customAgents: [{ id: 'assistant-1', name: 'Assistant', enabled: true, presetAgentType: 'codex' }],
      })
    ).toBe('codex');
  });

  it('keeps direct backend selections unchanged outside enterprise mode', () => {
    expect(
      resolveGuidModelBackendKey({
        isEnterprise: false,
        sessionMode: 'remote',
        selectedAgentKey: 'scode',
        selectedAgentInfo: { backend: 'scode', name: 'Sudo Code' },
        customAgents: [],
      })
    ).toBe('scode');
  });
});
