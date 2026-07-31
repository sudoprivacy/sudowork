/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { TChatConversation } from '@/common/storage';
import { buildGroupedHistory } from '@/renderer/pages/conversation/grouped-history/utils/groupingHelpers';

function makeConversation(id: string, overrides: Partial<TChatConversation> = {}): TChatConversation {
  return {
    id,
    type: 'acp',
    name: id,
    createTime: 100,
    modifyTime: 100,
    ...overrides,
  } as TChatConversation;
}

describe('buildGroupedHistory', () => {
  it('sorts all unpinned conversations by latest activity without grouping', () => {
    const result = buildGroupedHistory([
      makeConversation('workspace-old', {
        modifyTime: 100,
        extra: { workspace: '/workspace/a', customWorkspace: true },
      }),
      makeConversation('standalone-new', { modifyTime: 300 }),
      makeConversation('workspace-middle', {
        createTime: 200,
        modifyTime: 0,
        extra: { workspace: '/workspace/b', customWorkspace: true },
      }),
    ]);

    expect(result.timelineConversations.map(({ id }) => id)).toEqual(['standalone-new', 'workspace-middle', 'workspace-old']);
  });

  it('keeps pinned and cron-run conversations out of the timeline', () => {
    const result = buildGroupedHistory([makeConversation('normal'), makeConversation('pinned', { extra: { pinned: true, pinnedAt: 200 } }), makeConversation('cron-run', { extra: { cronJobId: 'job-1' } })]);

    expect(result.pinnedTimeline.map(({ id }) => id)).toEqual(['pinned']);
    expect(result.timelineConversations.map(({ id }) => id)).toEqual(['normal']);
  });
});
