/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { listWorkspaceSkillTargets } from '../../src/process/utils/workspaceSkillTargets';

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

  it('includes builtin skills and enabled custom skills when no assistant filter is provided', async () => {
    const skillsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-skill-targets-'));
    createdDirs.push(skillsDir);

    await createSkill(skillsDir, '_builtin/cron');
    await createSkill(skillsDir, 'pptx');
    await createSkill(skillsDir, 'disabled-skill', { enabled: false });
    await createSkill(skillsDir, 'alias-dir', { name: 'alias-skill' });

    const targets = await listWorkspaceSkillTargets(skillsDir);

    expect([...targets.keys()].sort()).toEqual(['alias-skill', 'cron', 'pptx']);
  });

  it('filters linked skills to the assistant enabledSkills list', async () => {
    const skillsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-skill-targets-'));
    createdDirs.push(skillsDir);

    await createSkill(skillsDir, '_builtin/cron');
    await createSkill(skillsDir, '_builtin/browser');
    await createSkill(skillsDir, 'pptx');
    await createSkill(skillsDir, 'alias-dir', { name: 'alias-skill' });

    const targets = await listWorkspaceSkillTargets(skillsDir, new Set(['cron', 'alias-skill']));

    expect([...targets.keys()].sort()).toEqual(['alias-skill', 'cron']);
  });

  it('returns no linked skills when the assistant explicitly enables none', async () => {
    const skillsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-skill-targets-'));
    createdDirs.push(skillsDir);

    await createSkill(skillsDir, '_builtin/cron');
    await createSkill(skillsDir, 'pptx');

    const targets = await listWorkspaceSkillTargets(skillsDir, new Set());

    expect([...targets.keys()]).toEqual([]);
  });
});
