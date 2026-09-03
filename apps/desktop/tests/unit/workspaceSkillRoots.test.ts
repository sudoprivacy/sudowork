import { describe, expect, it } from 'vitest';

import { resolveWorkspaceSkillRoot } from '@renderer/pages/conversation/workspace/skillRoots';

describe('resolveWorkspaceSkillRoot', () => {
  it('uses workspace skills for openclaw conversations', () => {
    expect(resolveWorkspaceSkillRoot('/tmp/workspace', 'openclaw-gateway')).toEqual({
      path: '/tmp/workspace/skills',
      source: 'skills',
    });
  });

  it('uses .claude skills for claude acp conversations', () => {
    expect(resolveWorkspaceSkillRoot('/tmp/workspace', 'claude')).toEqual({
      path: '/tmp/workspace/.claude/skills',
      source: 'claude-skills',
    });
  });

  it('uses workspace skills for non-claude acp conversations', () => {
    expect(resolveWorkspaceSkillRoot('/tmp/workspace', 'codex')).toEqual({
      path: '/tmp/workspace/skills',
      source: 'skills',
    });
  });
});
