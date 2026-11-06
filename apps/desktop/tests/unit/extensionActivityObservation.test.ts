import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IAcpRuntimeObservation } from '@sudowork/common/acpRuntimeStatus';

const mocks = vi.hoisted(() => ({ conversations: [] as any[], messages: new Map<string, any[]>(), tasks: new Map<string, any>(), provider: vi.fn() }));
vi.mock('@/common', () => ({ ipcBridge: { extensions: new Proxy({}, { get: (_target, key) => ({ provider: key === 'getAgentActivitySnapshot' ? mocks.provider : vi.fn() }) }) } }));
vi.mock('@/extensions', () => ({ ExtensionRegistry: {} }));
vi.mock('@process/utils/mainLogger', () => ({ mainError: vi.fn() }));
vi.mock('@process/database', () => ({ getDatabase: () => ({ getUserConversations: () => ({ data: mocks.conversations }), getConversationMessages: (id: string) => ({ data: mocks.messages.get(id) || [] }) }) }));
vi.mock('@process/WorkerManage', () => ({ default: { getTaskById: (id: string) => mocks.tasks.get(id) } }));

import { initExtensionsBridge } from '@process/bridge/extensionsBridge';

const observe = (state: 'running' | 'idle' | 'awaiting_input', instanceId: string, overrides: Partial<IAcpRuntimeObservation> = {}): IAcpRuntimeObservation => ({
  scope: 'owned-acp-connection',
  instanceId,
  sessionId: 'same-sid',
  availability: 'available',
  observedAt: Date.now(),
  expiresAt: Date.now() + 3000,
  snapshot: { foreground: state === 'awaiting_input' ? { state, waiting_for: 'question' } : { state }, background: { terminals: 0, agents: 0, execution_unconfirmed: 0, tool_operations: 0 } },
  ...overrides,
});

beforeEach(() => {
  mocks.conversations = [];
  mocks.messages.clear();
  mocks.tasks.clear();
  mocks.provider.mockClear();
  initExtensionsBridge();
});

describe('extension activity uses owned engine facts', () => {
  it('keeps same-named instances distinct and ignores misleading historical text and old connection status', async () => {
    for (const [id, state] of [
      ['a', 'running'],
      ['b', 'idle'],
    ] as const) {
      mocks.conversations.push({ id, type: 'acp', status: 'running', extra: { backend: 'scode', agentName: 'same' } });
      mocks.messages.set(id, [
        { type: 'text', position: 'left', content: { content: 'error search write 失败' }, createdAt: 10 },
        { type: 'agent_status', content: { status: 'connecting' }, createdAt: 9 },
      ]);
      mocks.tasks.set(id, { status: 'running', getRuntimeObservation: async () => observe(state, id) });
    }
    const result = await mocks.provider.mock.calls[0][0]();
    expect(result.agents).toHaveLength(2);
    expect(result.agents.find((agent: any) => agent.id === 'a::a').state).toBe('executing');
    expect(result.agents.find((agent: any) => agent.id === 'b::b').state).toBe('idle');
    expect(result.runningConversations).toBe(1);
    expect(result.agents[0].recentEvents[0].text).toContain('error search write');
  });

  it('preserves question and background facts, and never converts expired or unsupported observations to idle', async () => {
    const question = observe('awaiting_input', 'question');
    question.snapshot!.background.tool_operations = 1;
    const worker = observe('idle', 'worker');
    worker.snapshot!.background.terminals = 1;
    const uncertain = observe('idle', 'uncertain');
    uncertain.snapshot!.background.execution_unconfirmed = 1;
    const entries = [question, worker, uncertain, observe('idle', 'expired', { expiresAt: Date.now() - 1 }), observe('idle', 'unsupported', { availability: 'unsupported' })];
    for (const entry of entries) {
      mocks.conversations.push({ id: entry.instanceId, type: 'acp', status: 'finished' });
      mocks.tasks.set(entry.instanceId!, { getRuntimeObservation: async () => entry });
    }
    mocks.conversations.push({ id: 'unattached', type: 'acp', status: 'finished' });
    const result = await mocks.provider.mock.calls[0][0]();
    expect(result.agents.map((agent: any) => agent.state)).toEqual(['awaiting_input', 'executing', 'unknown', 'unknown', 'unknown', 'unknown']);
    expect(result.agents[0].runtimeObservation.snapshot.background.tool_operations).toBe(1);
    expect(result.runningConversations).toBe(2);
  });

  it('discards a response after the conversation task has been replaced', async () => {
    mocks.conversations.push({ id: 'replaced', type: 'acp' });
    mocks.tasks.set('replaced', {
      getRuntimeObservation: async () => {
        mocks.tasks.set('replaced', {});
        return observe('idle', 'old');
      },
    });
    const result = await mocks.provider.mock.calls[0][0]();
    expect(result.agents[0].state).toBe('unknown');
    expect(result.agents[0].runtimeObservation.availability).toBe('changed');
  });
});
