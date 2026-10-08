import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareOntologyConversationRuntime } from '@process/services/ontology/ontologyConversationRuntime';

const mocks = vi.hoisted(() => ({ getWorkbench: vi.fn(), getRuntime: vi.fn(), builder: vi.fn(), runtime: vi.fn() }));
vi.mock('@process/services/ontology/OntologyService', () => ({ ontologyService: { getWorkbench: mocks.getWorkbench, getRegisteredAgentRuntime: mocks.getRuntime } }));
vi.mock('@process/services/ontology/OntologyMcpRegistration', () => ({ ensureOntologyBuilderMcpServer: mocks.builder, createOntologyRuntimeMcpConfig: mocks.runtime }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getWorkbench.mockResolvedValue({ workspaceId: 'northwind' });
  mocks.builder.mockResolvedValue({ name: 'ontology-builder', command: '/node', args: ['builder.js'], env: [{ name: 'ONTOLOGY_WRITE_TOKEN', value: 'fresh-builder-token' }] });
  mocks.getRuntime.mockResolvedValue({ presetContext: 'Northwind v1: Products, Inventory, low_stock.', mcpRegistration: { workspaceId: 'northwind', versionId: 'v1', blueprintId: 'agent', exportFile: '/published.json' } });
  mocks.runtime.mockResolvedValue({ name: 'ontology-agent', command: '/node', args: ['runtime.js'], env: [{ name: 'ONTOLOGY_VERSION_ID', value: 'v1' }] });
});

describe('ontology conversation runtime', () => {
  it('leaves ordinary and personal-agent conversations untouched', async () => {
    for (const presetAssistantId of [undefined, 'builtin-agent', 'moss-agent:user:owner']) {
      expect(await prepareOntologyConversationRuntime({ presetAssistantId })).toBeUndefined();
    }
    expect(mocks.getWorkbench).not.toHaveBeenCalled();
    expect(mocks.getRuntime).not.toHaveBeenCalled();
    expect(mocks.runtime).not.toHaveBeenCalled();
  });

  it('restores builder tools with fresh credentials instead of inheriting a personal identity', async () => {
    const result = await prepareOntologyConversationRuntime({
      purpose: 'ontology',
      ontologyId: 'northwind',
      presetAssistantId: 'moss-agent:user:owner',
      extraMcpConfigs: [
        { name: 'ontology-builder', command: '/old' },
        { name: 'team', command: '/team' },
      ],
    });
    expect(mocks.builder).toHaveBeenCalledWith('northwind');
    expect(mocks.getRuntime).not.toHaveBeenCalled();
    expect(result?.presetContext).toContain('ontology workspace northwind');
    expect(result?.presetContext).toContain('Read ontology_get_snapshot');
    expect(result?.extraMcpConfigs).toEqual([{ name: 'team', command: '/team' }, await mocks.builder.mock.results[0].value]);
  });

  it('loads published rules and connects the matching business tools for new and restored agent chats', async () => {
    const input = { presetAssistantId: 'ontology-agent', extraMcpConfigs: [{ name: 'ontology-other-version', command: '/stale' }] };
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await prepareOntologyConversationRuntime(input);
      expect(result?.presetContext).toContain('Northwind v1');
      expect(result?.presetContext).toContain('ontology_get_overview');
      expect(result?.extraMcpConfigs).toEqual([await mocks.runtime.mock.results[attempt].value]);
    }
    expect(mocks.runtime).toHaveBeenCalledTimes(2);
    expect(mocks.runtime).toHaveBeenLastCalledWith({ workspaceId: 'northwind', versionId: 'v1', blueprintId: 'agent', exportFile: '/published.json' });
  });

  it('fails explicitly when ownership or tools cannot be resolved', async () => {
    await expect(prepareOntologyConversationRuntime({ purpose: 'ontology' })).rejects.toThrow('builderUnavailable');
    mocks.getRuntime.mockResolvedValue(undefined);
    await expect(prepareOntologyConversationRuntime({ presetAssistantId: 'ontology-missing' })).rejects.toThrow('notFound');
    mocks.getWorkbench.mockRejectedValue(new Error('Deleted ontology'));
    await expect(prepareOntologyConversationRuntime({ purpose: 'ontology', ontologyId: 'deleted' })).rejects.toThrow('Deleted ontology');
    expect(mocks.builder).not.toHaveBeenCalled();
    expect(mocks.runtime).not.toHaveBeenCalled();
  });
});
