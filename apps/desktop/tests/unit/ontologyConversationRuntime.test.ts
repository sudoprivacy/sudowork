import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareOntologyConversationRuntime } from '@process/services/ontology/ontologyConversationRuntime';

const mocks = vi.hoisted(() => ({ authority: vi.fn(), invoke: vi.fn(), getRuntime: vi.fn(), project: vi.fn() }));
vi.mock('@process/services/ontology/OntologyService', () => ({ ontologyService: { getModelAuthority: mocks.authority, invokeSudograph: mocks.invoke, getRegisteredAgentRuntime: mocks.getRuntime } }));
vi.mock('@process/services/ontology/ontologyProjectRuntime', () => ({ prepareOntologyProject: mocks.project }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.authority.mockReturnValue('rdf');
  mocks.project.mockResolvedValue({ instructions: 'Run node ontology.cjs project list --context project.json' });
  mocks.getRuntime.mockResolvedValue({ presetContext: 'Northwind v1: run node ontology.cjs list --package /published' });
});

describe('ontology script conversation runtime', () => {
  it('leaves ordinary and personal conversations and their MCP configuration untouched', async () => {
    for (const presetAssistantId of [undefined, 'builtin-agent', 'moss-agent:user:owner']) {
      const extraMcpConfigs = [{ name: 'browser', command: '/browser' }];
      expect(await prepareOntologyConversationRuntime({ presetAssistantId, extraMcpConfigs })).toBeUndefined();
      expect(extraMcpConfigs).toEqual([{ name: 'browser', command: '/browser' }]);
    }
    expect(mocks.project).not.toHaveBeenCalled();
    expect(mocks.getRuntime).not.toHaveBeenCalled();
  });

  it('prepares authoring scripts while retaining unrelated and custom ontology-prefixed MCP servers', async () => {
    const result = await prepareOntologyConversationRuntime({
      purpose: 'ontology',
      ontologyId: 'northwind',
      presetAssistantId: 'moss-agent:user:owner',
      extraMcpConfigs: [
        { name: 'ontology-builder', command: '/retired' },
        { name: 'browser', command: '/browser' },
        { name: 'ontology-custom', command: '/custom' },
      ],
    });
    expect(mocks.project).toHaveBeenCalledExactlyOnceWith('northwind');
    expect(result?.presetContext).toContain('ontology.cjs project list');
    expect(result?.extraMcpConfigs).toEqual([
      { name: 'browser', command: '/browser' },
      { name: 'ontology-custom', command: '/custom' },
    ]);
    expect(mocks.getRuntime).not.toHaveBeenCalled();
  });

  it('preserves canonical model context with the shared project command transport', async () => {
    mocks.authority.mockReturnValue('sudograph');
    mocks.invoke.mockResolvedValue({ text: 'Exact compiled revision A' });
    const result = await prepareOntologyConversationRuntime({ purpose: 'ontology', ontologyId: 'canonical' });
    expect(result?.presetContext).toContain('Exact compiled revision A');
    expect(result?.presetContext).toContain('ontology.cjs project list');
    expect(mocks.invoke).toHaveBeenCalledWith('canonical', { operation: 'read', product: 'context' });
    expect(result?.extraMcpConfigs).toEqual([]);
  });

  it('loads published scripts for new and resumed chats without adding ontology MCP servers', async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await prepareOntologyConversationRuntime({
        presetAssistantId: 'ontology-agent',
        extraMcpConfigs: [
          { name: 'ontology', command: '/retired' },
          { name: 'team', command: '/team' },
        ],
      });
      expect(result?.presetContext).toContain('node ontology.cjs list --package /published');
      expect(result?.extraMcpConfigs).toEqual([{ name: 'team', command: '/team' }]);
    }
    expect(mocks.getRuntime).toHaveBeenCalledTimes(2);
    expect(mocks.project).not.toHaveBeenCalled();
  });

  it('fails explicitly for missing projects and registered agents', async () => {
    await expect(prepareOntologyConversationRuntime({ purpose: 'ontology' })).rejects.toThrow('builderUnavailable');
    mocks.getRuntime.mockResolvedValue(undefined);
    await expect(prepareOntologyConversationRuntime({ presetAssistantId: 'ontology-missing' })).rejects.toThrow('notFound');
    mocks.project.mockRejectedValue(new Error('Project unavailable'));
    await expect(prepareOntologyConversationRuntime({ purpose: 'ontology', ontologyId: 'missing' })).rejects.toThrow('Project unavailable');
  });
});
