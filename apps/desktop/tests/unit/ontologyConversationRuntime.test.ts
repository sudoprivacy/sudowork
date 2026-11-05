import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareOntologyConversationRuntime } from '@process/services/ontology/ontologyConversationRuntime';

const mocks = vi.hoisted(() => ({ authority: vi.fn(), invoke: vi.fn(), getRuntime: vi.fn(), project: vi.fn() }));
vi.mock('@process/services/ontology/OntologyService', () => ({ ontologyService: { getModelAuthority: mocks.authority, readStudioConversationContext: mocks.invoke, getRegisteredAgentRuntime: mocks.getRuntime } }));
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
    mocks.invoke.mockResolvedValue({ format: 'sudograph-agent-context/v1', revision: 'revision-A', context_digest: 'digest-A', text: 'Exact compiled revision A' });
    const result = await prepareOntologyConversationRuntime({ purpose: 'ontology', ontologyId: 'canonical', conversation_id: 'chat-1' });
    expect(result?.presetContext).toContain('Exact compiled revision A');
    expect(result?.presetContext).toContain('ontology.cjs project list');
    expect(mocks.invoke).toHaveBeenCalledWith({ workspaceId: 'canonical', conversationId: 'chat-1' });
    expect(result?.extraMcpConfigs).toEqual([]);
    mocks.invoke.mockResolvedValue({ format: 'sudograph-agent-context/v1', revision: 'revision-B', context_digest: 'digest-B', text: 'Revised business definition B' });
    expect(await result?.resolveContext?.()).toBe('Revised business definition B\n\nRun node ontology.cjs project list --context project.json');
    expect(mocks.project).toHaveBeenCalledOnce();
    mocks.invoke.mockRejectedValue(new Error('Model read permission revoked'));
    await expect(result?.resolveContext?.()).rejects.toThrow('Model read permission revoked');
    mocks.authority.mockReturnValue('rdf');
    await expect(result?.resolveContext?.()).rejects.toThrow('binding changed');
    expect(mocks.invoke).toHaveBeenCalledTimes(3);
  });

  it.each([{ text: 'Unversioned context' }, { format: 'other', revision: 'A', context_digest: 'digest', text: 'Wrong format' }, { format: 'sudograph-agent-context/v1', revision: 'A', context_digest: 'digest', text: '' }])(
    'refuses malformed compiled context before opening the model',
    async (context) => {
      mocks.authority.mockReturnValue('sudograph');
      mocks.invoke.mockResolvedValue(context);
      await expect(prepareOntologyConversationRuntime({ purpose: 'ontology', ontologyId: 'canonical', conversation_id: 'chat-1' })).rejects.toThrow('invalid agent context');
    }
  );

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

  it('requires the canonical context provider to retain its owning conversation', async () => {
    mocks.authority.mockReturnValue('sudograph');
    await expect(prepareOntologyConversationRuntime({ purpose: 'ontology', ontologyId: 'canonical' })).rejects.toThrow('owning conversation');
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
