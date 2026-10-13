import { describe, expect, it } from 'vitest';
import type { GroupedHistoryResult } from '@renderer/pages/conversation/grouped-history/types';
import { externalSessionView } from '@renderer/pages/external-agents/navigation';
import { mergeExternalHistory } from '@renderer/pages/external-agents/history';

describe('external conversation projections', () => {
  it('keeps organization conversations out of personal groups while merging recent and complete chronological history', () => {
    const now = Date.now();
    const native = { id: 'same-id', type: 'acp' as const, name: 'Native', createTime: now - 100, modifyTime: now - 100, extra: { backend: 'scode' as const } };
    const history: GroupedHistoryResult = { pinnedTimeline: [], pinnedScheduled: [], scheduledGroups: [], agentGroups: [{ ref: 'mine', displayName: 'Personal', kind: 'own', conversations: [native] }], recent: [native], timelineSections: [] };
    const external = Array.from({ length: 12 }, (_, i) => externalSessionView({ id: i ? `session-${i}` : 'same-id', agent_id: 'published', agent_name: 'internal-identity', title: `External ${i}`, created_at: now - i, updated_at: now - i, active_task_id: null }));
    const merged = mergeExternalHistory(history, external, (key) => key);
    expect(merged.agentGroups).toEqual(history.agentGroups);
    expect(merged.recent).toHaveLength(8);
    expect(merged.recent[0].id).toBe('external:same-id');
    expect(merged.timelineSections.flatMap((section) => section.items)).toHaveLength(12);
    expect(external[0]).not.toHaveProperty('extra');
    expect(history.timelineSections).toEqual([]);
  });
});
