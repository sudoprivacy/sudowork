/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { getRecentConversations, groupConversationsByAgent } from '@renderer/pages/conversation/grouped-history/utils/groupingHelpers';
import type { ConversationItem } from '@renderer/pages/conversation/grouped-history/types';

const conversation = (id: string, agentRef: string | undefined, modifyTime: number): ConversationItem =>
  ({
    id,
    name: id,
    type: 'remote-agent',
    createTime: modifyTime,
    modifyTime,
    status: 'finished',
    extra: agentRef ? { agentName: agentRef } : {},
  }) as unknown as ConversationItem;

const agent = (ref: string, displayName: string, kind: 'default' | 'own' | 'template') => ({
  ref,
  displayName,
  kind,
});

describe('groupConversationsByAgent', () => {
  it('uses personal references for local and cloud sessions with identical display names', () => {
    const firstRef = 'moss-agent:own:11111111-1111-4111-8111-111111111111';
    const secondRef = 'moss-agent:own:22222222-2222-4222-8222-222222222222';
    const local = { ...conversation('local', 'Same name', 1), type: 'acp', extra: { agentName: 'Same name', presetAssistantId: firstRef } } as unknown as ConversationItem;
    const cloud = { ...conversation('cloud', 'Same name', 2), extra: { agentName: 'Same name', mossAssistantRef: secondRef } } as unknown as ConversationItem;
    const groups = groupConversationsByAgent([local, cloud], [agent(firstRef, 'Same name', 'own'), agent(secondRef, 'Same name', 'own')]);
    expect(groups.map((group) => group.conversations.map((item) => item.id))).toEqual([['local'], ['cloud']]);
    expect(groups).toHaveLength(2);
  });
  it('groups a conversation under the agent it belongs to, not the template it came from', () => {
    const groups = groupConversationsByAgent([conversation('a', 'tpl-recruit', 2), conversation('b', 'moss-agent:user:u1', 1)], [agent('moss-agent:user:u1', '宋一民', 'default'), agent('tpl-recruit', '招聘专家', 'template')]);
    expect(groups.map((g) => [g.displayName, g.conversations.map((c) => c.id)])).toEqual([
      ['宋一民', ['b']],
      ['招聘专家', ['a']],
    ]);
  });

  it('keeps the order the server gave, so the sidebar does not reshuffle', () => {
    // Newest activity is in the last agent; the list must not reorder around it.
    const groups = groupConversationsByAgent([conversation('a', 'tpl-recruit', 99)], [agent('moss-agent:user:u1', '宋一民', 'default'), agent('moss-agent:own:p1', '项目 A', 'own'), agent('tpl-recruit', '招聘专家', 'template')]);
    expect(groups.map((g) => g.displayName)).toEqual(['宋一民', '项目 A', '招聘专家']);
  });

  it('lists an agent with no conversations, because it is somewhere to start one', () => {
    const groups = groupConversationsByAgent([], [agent('moss-agent:own:p1', '项目 A', 'own')]);
    // A user who just made an agent would otherwise watch it vanish.
    expect(groups).toHaveLength(1);
    expect(groups[0]?.conversations).toEqual([]);
  });

  it('still shows a conversation whose agent the server did not list', () => {
    const groups = groupConversationsByAgent([conversation('a', 'gone-template', 1)], [agent('moss-agent:user:u1', '宋一民', 'default')]);
    // Dropping it would hide a conversation the user can open from the only
    // place they can find it.
    expect(groups.map((g) => g.ref)).toContain('gone-template');
    expect(groups.find((g) => g.ref === 'gone-template')?.conversations.map((c) => c.id)).toEqual(['a']);
  });

  it('sorts within a group by latest activity', () => {
    const groups = groupConversationsByAgent([conversation('old', 'x', 1), conversation('new', 'x', 5), conversation('mid', 'x', 3)], [agent('x', 'X', 'template')]);
    expect(groups[0]?.conversations.map((c) => c.id)).toEqual(['new', 'mid', 'old']);
  });
});

describe('getRecentConversations', () => {
  it('crosses agents and is newest first', () => {
    // Grouping only by agent would make "find the one from last week" start
    // with "remember whose it was".
    const recent = getRecentConversations([conversation('a', 'agent-1', 1), conversation('b', 'agent-2', 9), conversation('c', 'agent-1', 5)]);
    expect(recent.map((c) => c.id)).toEqual(['b', 'c', 'a']);
  });

  it('caps the list and leaves the input untouched', () => {
    const input = Array.from({ length: 20 }, (_, i) => conversation(`c${i}`, 'x', i));
    const recent = getRecentConversations(input, 3);
    expect(recent.map((c) => c.id)).toEqual(['c19', 'c18', 'c17']);
    expect(input[0]?.id).toBe('c0');
  });
});
