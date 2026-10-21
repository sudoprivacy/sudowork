import { describe, expect, it } from 'vitest';
import type { GroupedHistoryResult } from '@renderer/pages/conversation/grouped-history/types';
import { externalSessionView } from '@renderer/pages/external-agents/navigation';
import { mergeExternalHistory } from '@renderer/pages/external-agents/history';

describe('external conversation projections', () => {
  it('keeps organization conversations out of personal groups while preserving the complete chronological history', () => {
    const now = Date.now();
    const native = { id: 'same-id', type: 'acp' as const, name: 'Native', createTime: now - 100, modifyTime: now - 100, extra: { backend: 'scode' as const } };
    const history: GroupedHistoryResult = { pinnedTimeline: [], pinnedScheduled: [], scheduledGroups: [], agentGroups: [{ ref: 'mine', displayName: 'Personal', kind: 'own', conversations: [native] }], timelineSections: [] };
    const external = Array.from({ length: 12 }, (_, i) => externalSessionView({ id: i ? `session-${i}` : 'same-id', agent_id: 'published', agent_name: 'internal-identity', title: `External ${i}`, created_at: now - i, updated_at: now - i, active_task_id: null }));
    const merged = mergeExternalHistory(history, external, (key) => key);
    expect(merged.agentGroups).toEqual(history.agentGroups);
    expect(merged.timelineSections[0].items[0].conversation?.id).toBe('external:same-id');
    expect(merged.timelineSections.flatMap((section) => section.items)).toHaveLength(12);
    expect(external[0]).not.toHaveProperty('extra');
    expect(history.timelineSections).toEqual([]);
  });

  it('keeps equal-time native and external rows in a deterministic identity order', () => {
    const time = Date.now();
    const native = { id: 'native-a', type: 'acp' as const, name: 'Native', createTime: time, modifyTime: time, extra: { backend: 'scode' as const } };
    const history: GroupedHistoryResult = {
      pinnedTimeline: [],
      pinnedScheduled: [],
      scheduledGroups: [],
      agentGroups: [],
      timelineSections: [{ timeline: 'conversation.history.today', items: [{ type: 'conversation', time, conversation: native }] }],
    };
    const external = externalSessionView({ id: 'session-z', agent_id: 'published', agent_name: 'External', title: 'External', created_at: time, updated_at: time, active_task_id: null });

    expect(mergeExternalHistory(history, [external], (key) => key).timelineSections[0].items.map((item) => item.conversation?.id)).toEqual(['native-a', 'external:session-z']);
  });
});
