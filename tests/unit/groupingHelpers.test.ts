/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import type { TChatConversation } from '@/common/storage';
import { groupConversationsByTimelineAndWorkspace } from '@/renderer/pages/conversation/grouped-history/utils/groupingHelpers';

vi.stubGlobal('localStorage', {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
  clear: () => undefined,
});

const t = (key: string) => key;

function makeConversation(overrides: Partial<TChatConversation> = {}): TChatConversation {
  return {
    id: 'conv-1',
    type: 'acp',
    name: 'Leader',
    createTime: Date.now(),
    modifyTime: Date.now(),
    extra: {
      backend: 'scode',
      workspace: 'C:/tmp/scode-temp-1720000000000',
      customWorkspace: true,
      workspaceDisplayName: 'Team Alpha',
    },
    ...overrides,
  } as TChatConversation;
}

describe('groupConversationsByTimelineAndWorkspace', () => {
  it('uses workspaceDisplayName before temporary workspace fallback', () => {
    const sections = groupConversationsByTimelineAndWorkspace([makeConversation()], t);
    const workspaceItem = sections.flatMap((section) => section.items).find((item) => item.type === 'workspace');

    expect(workspaceItem?.workspaceGroup?.displayName).toBe('Team Alpha');
  });
});
