import { afterEach, describe, expect, it, vi } from 'vitest';
import AcpAgent from '@process/task/AcpAgent';
import { ProcessConfig } from '@process/initStorage';

const runtime = vi.hoisted(() => ({ prepare: vi.fn() }));
const browserMcp = vi.hoisted(() => ({ name: 'sudowork-browser', command: '/node', args: ['/shared-browser.js'], env: [] }));
vi.mock('@process/services/browserPanel/localBrowserSessionHost', () => ({ getLocalBrowserMcpConfig: async () => browserMcp }));
vi.mock('@/utils/configureChromium', () => ({ cdpPort: 9230 }));
vi.mock('@process/i18n', () => ({ default: { t: (key: string) => key }, i18nReady: Promise.resolve() }));
vi.mock('@process/services/ontology/ontologyConversationRuntime', () => ({ prepareOntologyConversationRuntime: runtime.prepare }));
vi.mock('@process/services/mossResourcePreparation', () => ({ readMossAssistantSnapshot: async () => undefined }));
vi.mock('@process/task/presetRuntime', () => ({ applyPresetRuntime: async () => ({ envOverrides: {}, contextAppendix: '' }) }));

afterEach(() => vi.restoreAllMocks());

describe('ontology ACP initialization recovery', () => {
  it.each(['ontology', 'registered'])('injects %s tools and system context before restoring the original chat', async (kind) => {
    vi.spyOn(ProcessConfig, 'get').mockResolvedValue(undefined);
    const tools = [{ name: 'ontology-northwind', command: '/node', env: [{ name: 'ONTOLOGY_VERSION_ID', value: 'v1' }] }];
    const resolveContext = kind === 'ontology' ? vi.fn().mockResolvedValue('Northwind revision 2') : undefined;
    runtime.prepare.mockResolvedValue({ presetContext: 'Northwind published v1 context', extraMcpConfigs: tools, resolveContext });
    const agent = Object.create(AcpAgent.prototype) as AcpAgent;
    agent.options = { backend: 'scode', cliPath: '/scode', conversation_id: 'existing-chat', mossAccountScope: 'account', ...(kind === 'ontology' ? { purpose: 'ontology', ontologyId: 'northwind', presetAssistantId: 'moss-agent:user:owner' } : { presetAssistantId: 'ontology-agent' }) };
    const loadSession = vi.fn().mockResolvedValue({});
    const harness = agent as unknown as { extra: Record<string, unknown>; connection: { systemPromptAppend?: string; onHostContext?: () => Promise<string>; loadSession: typeof loadSession }; connect: () => Promise<void>; createOrResumeSession: () => Promise<void> };
    harness.extra = { backend: 'scode', workspace: '/existing-workspace', acpSessionId: 'existing-history' };
    harness.connection = { loadSession };
    harness.connect = vi.fn(async () => {
      expect(harness.connection.systemPromptAppend).toBe('Northwind published v1 context');
      expect(harness.connection.onHostContext).toBe(resolveContext ?? null);
      await harness.createOrResumeSession();
    });
    vi.spyOn(agent, 'getModelInfo').mockReturnValue(null);
    await agent.initAgent();
    expect(loadSession).toHaveBeenCalledWith('existing-history', '/existing-workspace', [browserMcp, ...tools]);
    expect(harness.extra.acpSessionId).toBe('existing-history');
  });

  it.each(['ontology', 'registered', 'general'])('handles a failed startup without changing unrelated conversations: %s', async (kind) => {
    const getConfig = vi.spyOn(ProcessConfig, 'get').mockRejectedValue(new Error('Initialization unavailable'));
    const agent = Object.create(AcpAgent.prototype) as AcpAgent;
    agent.options = { backend: 'scode', conversation_id: 'existing-chat', ...(kind === 'ontology' ? { purpose: 'ontology', ontologyId: 'northwind' } : kind === 'registered' ? { presetAssistantId: 'ontology-agent' } : {}) };
    await expect(agent.initAgent()).rejects.toThrow('Initialization unavailable');
    await expect(agent.initAgent()).rejects.toThrow('Initialization unavailable');
    expect(getConfig).toHaveBeenCalledTimes(kind === 'general' ? 1 : 2);
  });
});
