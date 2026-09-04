import path from 'path';
import { describe, expect, it } from 'vitest';

import type { TChatConversation } from '@sudowork/common/storage';
import { resolveWorkspaceSkillsDir } from '@/process/utils/workspaceSkillsDir';

describe('resolveWorkspaceSkillsDir', () => {
  it('uses workspace/skills for openclaw conversations', () => {
    const conversation = {
      type: 'openclaw-gateway',
      extra: {
        workspace: '/tmp/workspace',
      },
    } as Pick<TChatConversation, 'type' | 'extra'>;

    expect(resolveWorkspaceSkillsDir(conversation)).toBe(path.join('/tmp/workspace', 'skills'));
  });

  it('uses workspace/.claude/skills for claude ACP conversations', () => {
    const conversation = {
      type: 'acp',
      extra: {
        workspace: '/tmp/workspace',
        backend: 'claude',
      },
    } as Pick<TChatConversation, 'type' | 'extra'>;

    expect(resolveWorkspaceSkillsDir(conversation)).toBe(path.join('/tmp/workspace', '.claude', 'skills'));
  });

  it('falls back to workspace/skills for non-claude ACP conversations', () => {
    const conversation = {
      type: 'acp',
      extra: {
        workspace: '/tmp/workspace',
        backend: 'codex',
      },
    } as Pick<TChatConversation, 'type' | 'extra'>;

    expect(resolveWorkspaceSkillsDir(conversation)).toBe(path.join('/tmp/workspace', 'skills'));
  });
});
