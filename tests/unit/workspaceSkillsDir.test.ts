import { describe, expect, it } from 'vitest';

import type { TChatConversation } from '@/common/storage';
import { resolveWorkspaceSkillsDir } from '@/process/utils/workspaceSkillsDir';

describe('resolveWorkspaceSkillsDir', () => {
  it('uses workspace/skills for openclaw conversations', () => {
    const conversation = {
      type: 'openclaw-gateway',
      extra: {
        workspace: '/tmp/workspace',
      },
    } as Pick<TChatConversation, 'type' | 'extra'>;

    expect(resolveWorkspaceSkillsDir(conversation)).toBe('/tmp/workspace/skills');
  });

  it('falls back to workspace/skills for generic ACP conversations', () => {
    const conversation = {
      type: 'acp',
      extra: {
        workspace: '/tmp/workspace',
        backend: 'codex',
      },
    } as Pick<TChatConversation, 'type' | 'extra'>;

    expect(resolveWorkspaceSkillsDir(conversation)).toBe('/tmp/workspace/skills');
  });
});
