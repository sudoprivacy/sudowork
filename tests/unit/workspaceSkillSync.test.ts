import { describe, expect, it } from 'vitest';

import type { TChatConversation } from '@/common/storage';
import { shouldSyncWorkspaceSkills } from '@/common/utils/workspaceSkillSync';

describe('workspace skill sync gating', () => {
  it('enables workspace skill sync for scode acp conversations with a workspace', () => {
    const conversation = {
      id: 'conv-scode',
      name: 'Scode',
      type: 'acp',
      createTime: Date.now(),
      modifyTime: Date.now(),
      extra: {
        workspace: '/tmp/scode-workspace',
        backend: 'scode',
      },
      model: {
        id: 'default',
        platform: 'scode',
        name: 'default',
        baseUrl: '',
        apiKey: '',
        useModel: 'default',
      },
    } as TChatConversation;

    expect(shouldSyncWorkspaceSkills(conversation)).toBe(true);
  });

  it('enables workspace skill sync for acp preset conversations with enabled skills', () => {
    const conversation = {
      id: 'conv-acp',
      name: 'ACP',
      type: 'acp',
      createTime: Date.now(),
      modifyTime: Date.now(),
      extra: {
        workspace: '/tmp/acp-workspace',
        backend: 'codex',
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

    expect(shouldSyncWorkspaceSkills(conversation)).toBe(true);
  });

  it('enables workspace skill sync for claude conversations with a workspace', () => {
    const conversation = {
      id: 'conv-acp-claude',
      name: 'Claude',
      type: 'acp',
      createTime: Date.now(),
      modifyTime: Date.now(),
      extra: {
        workspace: '/tmp/claude-workspace',
        backend: 'claude',
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

    expect(shouldSyncWorkspaceSkills(conversation)).toBe(true);
  });

  it('enables workspace skill sync for preset conversations even when skills are resolved later', () => {
    const conversation = {
      id: 'conv-acp-preset-assistant',
      name: 'ACP',
      type: 'acp',
      createTime: Date.now(),
      modifyTime: Date.now(),
      extra: {
        workspace: '/tmp/acp-workspace',
        backend: 'codex',
        presetAssistantId: 'builtin-cowork',
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

    expect(shouldSyncWorkspaceSkills(conversation)).toBe(true);
  });

  it('enables workspace skill sync when the current message requests skills', () => {
    const conversation = {
      id: 'conv-acp-requested-skill',
      name: 'ACP',
      type: 'acp',
      createTime: Date.now(),
      modifyTime: Date.now(),
      extra: {
        workspace: '/tmp/acp-workspace',
        backend: 'codex',
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

    expect(shouldSyncWorkspaceSkills(conversation, ['pptx'])).toBe(true);
  });

  it('disables workspace skill sync for acp conversations without assistant or message skills', () => {
    const conversation = {
      id: 'conv-acp',
      name: 'ACP',
      type: 'acp',
      createTime: Date.now(),
      modifyTime: Date.now(),
      extra: {
        workspace: '/tmp/acp-workspace',
        backend: 'codex',
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

    expect(shouldSyncWorkspaceSkills(conversation)).toBe(false);
  });

  it('disables workspace skill sync when scode conversation has no workspace', () => {
    const conversation = {
      id: 'conv-scode-no-workspace',
      name: 'Scode',
      type: 'acp',
      createTime: Date.now(),
      modifyTime: Date.now(),
      extra: { backend: 'scode' },
      model: {
        id: 'default',
        platform: 'scode',
        name: 'default',
        baseUrl: '',
        apiKey: '',
        useModel: 'default',
      },
    } as TChatConversation;

    expect(shouldSyncWorkspaceSkills(conversation)).toBe(false);
  });
});
