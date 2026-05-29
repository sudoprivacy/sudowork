import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { scanWorkspaceSkills } from '@/process/utils/scanWorkspaceSkills';

const createdDirs: string[] = [];

async function createSkill(dir: string, name: string) {
  const skillDir = path.join(dir, name);
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(
    path.join(skillDir, 'SKILL.md'),
    `---
name: ${name}
description: ${name} description
---
# ${name}
`,
    'utf-8'
  );
  return skillDir;
}

afterEach(async () => {
  await Promise.all(
    createdDirs.splice(0).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true });
    })
  );
});

describe('scanWorkspaceSkills', () => {
  it('returns an empty list when the skills directory does not exist', async () => {
    const missingDir = path.join(os.tmpdir(), `scan-workspace-skills-missing-${Date.now()}-${Math.random().toString(16).slice(2)}`);

    const skills = await scanWorkspaceSkills(missingDir);

    expect(skills).toEqual([]);
  });

  it('finds direct subdirectory skills', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scan-workspace-skills-'));
    createdDirs.push(root);
    await createSkill(root, 'alpha');

    const skills = await scanWorkspaceSkills(root);

    expect(skills.map((skill) => skill.name)).toEqual(['alpha']);
  });

  it('finds symlinked skill directories', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scan-workspace-skills-'));
    const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'scan-workspace-skills-src-'));
    createdDirs.push(root, sourceRoot);

    const sourceSkillDir = await createSkill(sourceRoot, 'linked-skill');
    const linkPath = path.join(root, 'linked-skill');
    const linkType = process.platform === 'win32' ? 'junction' : 'dir';
    await fs.symlink(sourceSkillDir, linkPath, linkType);

    const skills = await scanWorkspaceSkills(root);

    expect(skills.map((skill) => skill.name)).toEqual(['linked-skill']);
    expect(skills[0]?.path).toBe(linkPath);
  });

  it('prefers icon and display fields from _sudowork_meta.json', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scan-workspace-skills-'));
    createdDirs.push(root);
    const skillDir = await createSkill(root, 'browser');
    await fs.writeFile(
      path.join(skillDir, '_sudowork_meta.json'),
      JSON.stringify(
        {
          display_name: '浏览器',
          description: 'meta description',
          icon: 'icon.svg',
          emoji: '🌐',
        },
        null,
        2
      ),
      'utf-8'
    );
    await fs.writeFile(path.join(skillDir, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'utf-8');

    const [skill] = await scanWorkspaceSkills(root);

    expect(skill).toMatchObject({
      name: 'browser',
      displayName: '浏览器',
      description: 'meta description',
      emoji: '🌐',
    });
    expect(skill?.iconUrl).toContain('/icon.svg');
    expect(skill?.iconUrl?.startsWith('aion-asset://')).toBe(true);
  });

  it('supports remote icon urls declared in SKILL.md frontmatter', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scan-workspace-skills-'));
    createdDirs.push(root);
    const skillDir = path.join(root, 'remote-icon');
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, 'SKILL.md'),
      `---
name: remote-icon
description: remote icon skill
icon: https://example.com/icon.png
---
# remote-icon
`,
      'utf-8'
    );

    const [skill] = await scanWorkspaceSkills(root);

    expect(skill).toMatchObject({
      name: 'remote-icon',
      icon: 'https://example.com/icon.png',
      iconUrl: 'https://example.com/icon.png',
    });
  });
});
