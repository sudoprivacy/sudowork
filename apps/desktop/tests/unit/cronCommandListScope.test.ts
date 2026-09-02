/**
 * Regression tests for issue #835: the agent-facing [CRON_LIST] command must
 * list the user's scheduled tasks globally, not just the ones created by the
 * current conversation — a per-conversation list made every new chat report
 * "no tasks" (while the cron UI showed them) and defeated the skill's
 * query-before-create duplicate check.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listJobsMock = vi.fn(async () => [] as unknown[]);

// handleCronCommands routes through getCronProvider() (#854); the local provider
// delegates to cronService, but tests mock the provider directly.
vi.mock('@process/providers/cron', () => ({
  getCronProvider: () => ({
    listJobs: () => listJobsMock(),
    addJob: vi.fn(),
    removeJob: vi.fn(),
  }),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    cron: {
      onJobCreated: { emit: vi.fn() },
      onJobRemoved: { emit: vi.fn() },
    },
  },
}));

vi.mock('@process/services/cron/cronPolicy', () => ({
  getClientCronEnabled: vi.fn(async () => true),
}));

function cronJob(overrides: { id: string; name: string; conversationId: string }) {
  return {
    id: overrides.id,
    name: overrides.name,
    enabled: true,
    schedule: { kind: 'cron', expr: '0 9 * * *', description: 'Every day at 9:00 AM' },
    target: { payload: { kind: 'message', text: 'reminder' } },
    metadata: {
      conversationId: overrides.conversationId,
      agentType: 'scode',
      createdBy: 'agent',
      createdAt: 0,
      updatedAt: 0,
    },
    state: { runCount: 0 },
  };
}

function finishedMessage(text: string) {
  return {
    id: 'msg-1',
    conversation_id: 'conv-b',
    type: 'content',
    status: 'finish',
    content: { content: text },
  } as never;
}

describe('[CRON_LIST] scope (issue #835)', () => {
  beforeEach(() => {
    listJobsMock.mockReset();
    listJobsMock.mockResolvedValue([]);
  });

  it('lists jobs created by other conversations', async () => {
    listJobsMock.mockResolvedValue([cronJob({ id: 'cron_1', name: 'Weather reminder', conversationId: 'conv-a' })]);

    const { processAgentResponse } = await import('@/process/task/MessageMiddleware');
    const result = await processAgentResponse('conv-b', 'scode', finishedMessage('[CRON_LIST]'));

    expect(listJobsMock).toHaveBeenCalled();
    expect(result.systemResponses.join('\n')).toContain('Weather reminder');
    expect(result.systemResponses.join('\n')).toContain('cron_1');
  });

  it('marks jobs created by the current conversation', async () => {
    listJobsMock.mockResolvedValue([cronJob({ id: 'cron_mine', name: 'Mine', conversationId: 'conv-b' }), cronJob({ id: 'cron_other', name: 'Other', conversationId: 'conv-a' })]);

    const { processAgentResponse } = await import('@/process/task/MessageMiddleware');
    const result = await processAgentResponse('conv-b', 'scode', finishedMessage('[CRON_LIST]'));

    const text = result.systemResponses.join('\n');
    const mineLine = text.split('\n').find((line) => line.includes('cron_mine'));
    const otherLine = text.split('\n').find((line) => line.includes('cron_other'));
    expect(mineLine).toContain('[created in this conversation]');
    expect(otherLine).not.toContain('[created in this conversation]');
  });

  it('reports no tasks only when the user has none anywhere', async () => {
    const { processAgentResponse } = await import('@/process/task/MessageMiddleware');
    const result = await processAgentResponse('conv-b', 'scode', finishedMessage('[CRON_LIST]'));

    expect(result.systemResponses.join('\n')).toContain('No scheduled tasks');
  });
});
