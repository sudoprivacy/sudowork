/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import type { TChatConversation } from '@/common/storage';
import { listWorkspaceSkillTargets, resolveConversationEnabledSkillNames } from '../../src/process/utils/workspaceSkillTargets';

const createdDirs: string[] = [];

async function createSkill(baseDir: string, relativeDir: string, options?: { enabled?: boolean; name?: string; isBuiltin?: boolean }) {
  const skillDir = path.join(baseDir, relativeDir);
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(path.join(skillDir, 'SKILL.md'), '# skill', 'utf-8');

  if (options) {
    await fs.writeFile(
      path.join(skillDir, '_sudowork_meta.json'),
      JSON.stringify({
        enabled: options.enabled,
        name: options.name,
        is_builtin: options.isBuiltin,
      }),
      'utf-8'
    );
  }
}

describe('listWorkspaceSkillTargets', () => {
  afterEach(async () => {
    await Promise.all(
      createdDirs.splice(0).map(async (dir) => {
        await fs.rm(dir, { recursive: true, force: true });
      })
    );
  });

  it('includes enabled non-builtin skills when no assistant filter is provided', async () => {
    const skillsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-skill-targets-'));
    createdDirs.push(skillsDir);

    await createSkill(skillsDir, '_builtin/cron');
    await createSkill(skillsDir, 'pptx');
    await createSkill(skillsDir, 'disabled-skill', { enabled: false });
    await createSkill(skillsDir, 'alias-dir', { name: 'alias-skill' });

    const targets = await listWorkspaceSkillTargets(skillsDir);

    expect([...targets.keys()].sort()).toEqual(['alias-skill', 'pptx']);
  });

  it('filters linked skills to the assistant enabledSkills list while excluding builtin skills', async () => {
    const skillsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-skill-targets-'));
    createdDirs.push(skillsDir);

    await createSkill(skillsDir, '_builtin/cron');
    await createSkill(skillsDir, '_builtin/browser');
    await createSkill(skillsDir, 'pptx');
    await createSkill(skillsDir, 'alias-dir', { name: 'alias-skill' });

    const targets = await listWorkspaceSkillTargets(skillsDir, new Set(['cron', 'alias-skill']));

    expect([...targets.keys()].sort()).toEqual(['alias-skill']);
  });

  it('returns no linked skills when the assistant explicitly enables none', async () => {
    const skillsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-skill-targets-'));
    createdDirs.push(skillsDir);

    await createSkill(skillsDir, '_builtin/cron');
    await createSkill(skillsDir, 'pptx');

    const targets = await listWorkspaceSkillTargets(skillsDir, new Set());

    expect([...targets.keys()]).toEqual([]);
  });

  it('keeps system-directory skills even if metadata marks them builtin', async () => {
    const skillsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-skill-targets-'));
    createdDirs.push(skillsDir);

    await createSkill(skillsDir, '_system/builtin-like', { isBuiltin: true });
    await createSkill(skillsDir, '_system/system-tool');

    const targets = await listWorkspaceSkillTargets(skillsDir);

    expect([...targets.keys()].sort()).toEqual(['builtin-like', 'system-tool']);
  });

  it('auto-injects skills under _system/_builtin even when the assistant filter excludes them', async () => {
    // Auto-injected builtin skills (image-generation, cron, ...) must always
    // land in the workspace so their script paths resolve, regardless of the
    // active assistant's per-assistant enabledSkills list.
    const skillsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-skill-targets-'));
    createdDirs.push(skillsDir);

    await createSkill(skillsDir, '_system/_builtin/image-generation', { isBuiltin: true });
    await createSkill(skillsDir, '_system/_builtin/cron', { isBuiltin: true });
    await createSkill(skillsDir, '_system/pptx', { isBuiltin: true });

    // Assistant only enables pptx — image-generation and cron must still be auto-injected.
    const targets = await listWorkspaceSkillTargets(skillsDir, new Set(['pptx']));

    expect([...targets.keys()].sort()).toEqual(['cron', 'image-generation', 'pptx']);
  });

  it('prefers _system/_builtin over a stale _system entry of the same name', async () => {
    // After a skill moves from `_system/<name>/` into `_system/_builtin/<name>/`,
    // upgraded installs still have the stale `_system/<name>/` directory on disk.
    // The workspace symlink must point at the new `_system/_builtin/<name>/` copy.
    const skillsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-skill-targets-'));
    createdDirs.push(skillsDir);

    await createSkill(skillsDir, '_system/image-generation', { isBuiltin: true });
    await createSkill(skillsDir, '_system/_builtin/image-generation', { isBuiltin: true });

    const targets = await listWorkspaceSkillTargets(skillsDir);

    expect(targets.get('image-generation')).toBe(path.join(skillsDir, '_system', '_builtin', 'image-generation'));
  });

  it('merges assistant enabled skills with message-selected skills', () => {
    const conversation = {
      id: 'conv-1',
      name: 'Assistant',
      type: 'acp',
      createTime: Date.now(),
      modifyTime: Date.now(),
      extra: {
        workspace: '/tmp/workspace',
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

    expect([...(resolveConversationEnabledSkillNames(conversation, ['xlsx', 'pptx']) ?? [])].sort()).toEqual(['pptx', 'xlsx']);
  });

  it('uses message-selected skills when the conversation has no enabled skill filter', () => {
    const conversation = {
      id: 'conv-2',
      name: 'Assistant',
      type: 'acp',
      createTime: Date.now(),
      modifyTime: Date.now(),
      extra: {
        workspace: '/tmp/workspace',
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

    expect([...(resolveConversationEnabledSkillNames(conversation, ['xlsx']) ?? [])]).toEqual(['xlsx']);
  });
});
