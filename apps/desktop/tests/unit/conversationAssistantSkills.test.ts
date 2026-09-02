import { describe, expect, it, vi } from 'vitest';

import type { TChatConversation } from '@/common/storage';
import { areSkillSelectionsEqual, resolveConversationAssistantId, resolveLatestConversationEnabledSkills } from '@/process/utils/conversationAssistantSkills';

describe('conversationAssistantSkills', () => {
  it('prefers presetAssistantId when resolving the current assistant id', () => {
    const conversation = {
      id: 'conv-1',
      name: 'Assistant',
      type: 'acp',
      createTime: Date.now(),
      modifyTime: Date.now(),
      extra: {
        workspace: '/tmp/workspace',
        presetAssistantId: 'builtin-cowork',
        customAgentId: 'legacy-id',
      },
      model: {
        id: 'default',
        platform: 'openai',
        name: 'default',
        baseUrl: '',
        apiKey: '',
        useModel: 'default',
      },
    } as TChatConversation;

    expect(resolveConversationAssistantId(conversation)).toBe('builtin-cowork');
  });

  it('loads the latest enabled skills from the current assistant config', async () => {
    const conversation = {
      id: 'conv-2',
      name: 'Assistant',
      type: 'acp',
      createTime: Date.now(),
      modifyTime: Date.now(),
      extra: {
        workspace: '/tmp/workspace',
        presetAssistantId: 'builtin-cowork',
        enabledSkills: ['old-skill'],
      },
      model: {
        id: 'default',
        platform: 'openai',
        name: 'default',
        baseUrl: '',
        apiKey: '',
        useModel: 'default',
      },
    } as TChatConversation;

    const getAssistantMeta = vi.fn(async () => ({ name: 'Cowork', enabledSkills: ['pptx', 'xlsx'] }));

    await expect(
      resolveLatestConversationEnabledSkills(conversation, {
        getAssistantMeta,
        warn: vi.fn(),
      })
    ).resolves.toEqual(['pptx', 'xlsx']);
  });

  it('falls back to the stored conversation skills when the latest assistant config is unavailable', async () => {
    const conversation = {
      id: 'conv-3',
      name: 'Assistant',
      type: 'acp',
      createTime: Date.now(),
      modifyTime: Date.now(),
      extra: {
        workspace: '/tmp/workspace',
        presetAssistantId: 'builtin-cowork',
        enabledSkills: ['pptx'],
      },
      model: {
        id: 'default',
        platform: 'openai',
        name: 'default',
        baseUrl: '',
        apiKey: '',
        useModel: 'default',
      },
    } as TChatConversation;

    await expect(
      resolveLatestConversationEnabledSkills(conversation, {
        getAssistantMeta: vi.fn(async () => null),
        warn: vi.fn(),
      })
    ).resolves.toEqual(['pptx']);
  });

  it('compares skill selections ignoring order and whitespace', () => {
    expect(areSkillSelectionsEqual([' pptx ', 'xlsx'], ['xlsx', 'pptx'])).toBe(true);
  });
});
