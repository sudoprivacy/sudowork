import { describe, expect, it } from 'vitest';

import type { TChatConversation } from '@/common/storage';
import { shouldSyncWorkspaceSkills } from '@/common/utils/workspaceSkillSync';

describe('workspace skill sync gating', () => {
  it('enables workspace skill sync for openclaw conversations with a workspace', () => {
    const conversation = {
      id: 'conv-openclaw',
      name: 'OpenClaw',
      type: 'openclaw-gateway',
      createTime: Date.now(),
      modifyTime: Date.now(),
      extra: {
        workspace: '/tmp/openclaw-workspace',
      },
      model: {
        id: 'default',
        platform: 'openclaw',
        name: 'default',
        baseUrl: '',
        apiKey: '',
        useModel: 'default',
      },
    } as TChatConversation;

    expect(shouldSyncWorkspaceSkills(conversation)).toBe(true);
  });

  it('disables workspace skill sync for acp conversations even if they have a workspace', () => {
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

  it('disables workspace skill sync when openclaw conversation has no workspace', () => {
    const conversation = {
      id: 'conv-openclaw-no-workspace',
      name: 'OpenClaw',
      type: 'openclaw-gateway',
      createTime: Date.now(),
      modifyTime: Date.now(),
      extra: {},
      model: {
        id: 'default',
        platform: 'openclaw',
        name: 'default',
        baseUrl: '',
        apiKey: '',
        useModel: 'default',
      },
    } as TChatConversation;

    expect(shouldSyncWorkspaceSkills(conversation)).toBe(false);
  });
});
