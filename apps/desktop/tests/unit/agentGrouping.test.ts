/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { buildGroupedHistory, groupConversationsByAgent } from '@renderer/pages/conversation/grouped-history/utils/groupingHelpers';
import { getLatestAgentConversation } from '@renderer/pages/conversation/utils/agentIdentity';
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
    expect(groups.map((g) => [g.displayName, g.conversations.map((c) => c.id)])).toEqual([['宋一民', ['b']]]);
  });

  it('keeps the order the server gave, so the sidebar does not reshuffle', () => {
    // Newest activity is in the last agent; the list must not reorder around it.
    const groups = groupConversationsByAgent([conversation('a', 'tpl-recruit', 99)], [agent('moss-agent:user:u1', '宋一民', 'default'), agent('moss-agent:own:p1', '项目 A', 'own'), agent('tpl-recruit', '招聘专家', 'template')]);
    expect(groups.map((g) => g.displayName)).toEqual(['宋一民', '项目 A']);
  });

  it('lists an agent with no conversations, because it is somewhere to start one', () => {
    const groups = groupConversationsByAgent([], [agent('moss-agent:own:p1', '项目 A', 'own')]);
    // A user who just made an agent would otherwise watch it vanish.
    expect(groups).toHaveLength(1);
    expect(groups[0]?.conversations).toEqual([]);
  });

  it('keeps unclassified references in the session view', () => {
    const groups = groupConversationsByAgent([conversation('a', 'gone-template', 1)], [agent('moss-agent:user:u1', '宋一民', 'default')]);
    expect(groups.map((g) => g.ref)).not.toContain('gone-template');
    const history = buildGroupedHistory([conversation('a', 'gone-template', 1)], (key) => key);
    expect(history.timelineSections.flatMap((section) => section.items.map((item) => item.conversation?.id))).toEqual(['a']);
  });

  it('sorts within a group by latest activity', () => {
    const groups = groupConversationsByAgent([conversation('old', 'x', 1), conversation('new', 'x', 5), conversation('mid', 'x', 3)], [agent('x', 'X', 'own')]);
    expect(groups[0]?.conversations.map((c) => c.id)).toEqual(['new', 'mid', 'old']);
  });

  it('keeps unavailable personal Agents readable without showing identity references', () => {
    const reference = 'moss-agent:own:22222222-2222-4222-8222-222222222222';
    const saved = { ...conversation('saved', reference, 1), extra: { mossAssistantRef: reference, agentName: 'Saved name' } } as ConversationItem;
    expect(groupConversationsByAgent([saved], [])[0]).toMatchObject({ ref: reference, displayName: 'Saved name' });
    expect(groupConversationsByAgent([conversation('unnamed', reference, 1)], [])[0]).toMatchObject({ ref: reference, displayName: '' });
  });

  it('uses managed identity and separates same-named Agents owned by different users', () => {
    const sessions = ['alice', 'bob'].map(
      (ownerId) =>
        ({
          ...conversation(ownerId, 'research', 1),
          extra: { agentManagement: { ownerId, ownerName: ownerId, agentName: 'research', displayName: 'Research Agent' } },
        }) as ConversationItem
    );
    const groups = groupConversationsByAgent(sessions, []);
    expect(groups.map((group) => [group.ref, group.kind, group.conversations[0].id])).toEqual([
      ['moss-managed:alice:research', 'managed', 'alice'],
      ['moss-managed:bob:research', 'managed', 'bob'],
    ]);
  });
});

describe('getLatestAgentConversation', () => {
  it('resumes the most recently active session by stable identity, including pinned history', () => {
    const reference = 'moss-agent:own:22222222-2222-4222-8222-222222222222';
    const latest = { ...conversation('latest', 'Same name', 10), extra: { presetAssistantId: reference, agentName: 'Same name', pinned: true } } as ConversationItem;
    const other = { ...conversation('other-agent', 'Same name', 20), extra: { presetAssistantId: 'moss-agent:own:other', agentName: 'Same name' } } as ConversationItem;
    const cron = { ...conversation('cron', reference, 30), extra: { mossAssistantRef: reference, cronJobId: 'scheduled' } } as ConversationItem;
    const older = conversation('older', reference, 1);
    const health = { ...conversation('health', reference, 40), extra: { mossAssistantRef: reference, isHealthCheck: true } } as ConversationItem;
    const ontology = { ...conversation('ontology', reference, 50), extra: { mossAssistantRef: reference, purpose: 'ontology' } } as ConversationItem;
    const input = [older, other, cron, health, ontology, latest];
    expect(getLatestAgentConversation(input, reference)?.id).toBe('latest');
    expect(input[0]).toBe(older);
  });

  it('returns no conversation for an unused Agent', () => {
    expect(getLatestAgentConversation([conversation('other', 'other', 1)], 'unused')).toBeUndefined();
  });
});
