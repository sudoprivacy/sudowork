/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectWorkspaceSkillCandidateRoots, installWorkspaceSkillsFromTrackedFiles, type TrackedWorkspaceFile } from '@/process/task/workspaceSkillInstaller';

describe('workspaceSkillInstaller', () => {
  let tempRoot: string;
  let workspace: string;
  let customSkillsDir: string;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sudowork-skill-installer-'));
    workspace = path.join(tempRoot, 'workspace');
    customSkillsDir = path.join(tempRoot, 'skills', '_my-custom-skill');
    await fs.mkdir(workspace, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('collects candidate skill roots from tracked workspace files', async () => {
    const skillDir = path.join(workspace, 'video-generation');
    const trackedFiles = new Map<string, TrackedWorkspaceFile>([
      [
        'video-generation/SKILL.md',
        {
          path: path.join(skillDir, 'SKILL.md'),
          intent: 'final',
          kind: 'create',
        },
      ],
      [
        '.nexus/sudocode/skills/browser/SKILL.md',
        {
          path: path.join(workspace, '.nexus', 'sudocode', 'skills', 'browser', 'SKILL.md'),
          intent: 'final',
          kind: 'create',
        },
      ],
    ]);

    expect(collectWorkspaceSkillCandidateRoots(workspace, trackedFiles)).toContain(skillDir);
    expect(collectWorkspaceSkillCandidateRoots(workspace, trackedFiles).some((candidate) => candidate.includes(`${path.sep}.nexus${path.sep}`))).toBe(false);
  });

  it('installs a generated skill directory into custom skills', async () => {
    const skillDir = path.join(workspace, 'video-generation');
    await fs.mkdir(path.join(skillDir, 'assets'), { recursive: true });
    await fs.writeFile(
      path.join(skillDir, 'SKILL.md'),
      `---
name: video-generation
display_name: Video Generation
description: "Create product videos"
version: 2.0.0
---

# Video Generation
`,
      'utf-8'
    );
    await fs.writeFile(
      path.join(skillDir, '_sudowork_meta.json'),
      JSON.stringify({
        name: 'video-generation',
        display_name: 'Video Generation',
        description: 'Create product videos',
        icon: 'icon.svg',
        source_type: 'upload',
        enabled: true,
      }),
      'utf-8'
    );
    await fs.writeFile(path.join(skillDir, 'assets', 'example.txt'), 'example', 'utf-8');

    const clearSkillsCache = vi.fn();
    const resetAcpSkillManager = vi.fn();
    const results = await installWorkspaceSkillsFromTrackedFiles(
      workspace,
      new Map<string, TrackedWorkspaceFile>([
        [
          'video-generation/SKILL.md',
          {
            path: path.join(skillDir, 'SKILL.md'),
            intent: 'final',
            kind: 'create',
          },
        ],
      ]),
      {
        getCustomSkillsDir: () => customSkillsDir,
        clearSkillsCache,
        resetAcpSkillManager,
        now: () => new Date('2026-05-25T00:00:00.000Z'),
      }
    );

    expect(results).toEqual([
      expect.objectContaining({
        status: 'installed',
        skillName: 'video-generation',
        installedVersion: '2.0.0',
        targetDir: path.join(customSkillsDir, 'video-generation'),
      }),
    ]);
    await expect(fs.readFile(path.join(customSkillsDir, 'video-generation', 'assets', 'example.txt'), 'utf-8')).resolves.toBe('example');
    await expect(fs.readFile(path.join(customSkillsDir, 'video-generation', 'SKILL.md'), 'utf-8')).resolves.toContain('Video Generation');

    const meta = JSON.parse(await fs.readFile(path.join(customSkillsDir, 'video-generation', '_sudowork_meta.json'), 'utf-8'));
    expect(meta).toMatchObject({
      name: 'video-generation',
      display_name: 'Video Generation',
      source_type: 'upload',
      enabled: true,
      installed_version: '2.0.0',
      installed_at: '2026-05-25T00:00:00.000Z',
    });
    expect(clearSkillsCache).toHaveBeenCalledTimes(1);
    expect(resetAcpSkillManager).toHaveBeenCalledTimes(1);
  });

  it('updates an existing custom skill in the installed custom skills directory', async () => {
    const skillDir = path.join(workspace, 'video-generation');
    const targetDir = path.join(customSkillsDir, 'video-generation');
    await fs.mkdir(path.join(skillDir, 'scripts'), { recursive: true });
    await fs.writeFile(
      path.join(skillDir, 'SKILL.md'),
      `---
name: video-generation
display_name: A Share Hot Rank
description: "New skill description"
version: 2.0.0
---

# A Share Hot Rank

Updated workflow instructions.
`,
      'utf-8'
    );
    await fs.writeFile(
      path.join(skillDir, '_sudowork_meta.json'),
      JSON.stringify({
        name: 'video-generation',
        display_name: 'A Share Hot Rank',
        description: 'New skill description',
        icon: 'icon.svg',
        enabled: true,
      }),
      'utf-8'
    );
    await fs.writeFile(path.join(skillDir, 'icon.svg'), '<svg>new icon</svg>', 'utf-8');
    await fs.writeFile(path.join(skillDir, 'scripts', 'run.ts'), 'export const version = 2;', 'utf-8');
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(
      path.join(targetDir, 'SKILL.md'),
      `---
name: video-generation
display_name: Old Name
description: "Old skill description"
version: 1.0.0
---

# Old Name

Old workflow instructions.
`,
      'utf-8'
    );
    await fs.writeFile(
      path.join(targetDir, '_sudowork_meta.json'),
      JSON.stringify({
        name: 'video-generation',
        display_name: 'Old Name',
        description: 'Old skill description',
        icon: 'old-icon.svg',
        source_type: 'upload',
        enabled: false,
        installed_version: '1.0.0',
        installed_at: '2026-05-01T00:00:00.000Z',
      }),
      'utf-8'
    );
    await fs.writeFile(path.join(targetDir, 'old-icon.svg'), '<svg>old icon</svg>', 'utf-8');
    await fs.writeFile(path.join(targetDir, 'obsolete.txt'), 'remove me', 'utf-8');

    const clearSkillsCache = vi.fn();
    const resetAcpSkillManager = vi.fn();
    const results = await installWorkspaceSkillsFromTrackedFiles(
      workspace,
      new Map<string, TrackedWorkspaceFile>([
        [
          'video-generation/SKILL.md',
          {
            path: path.join(skillDir, 'SKILL.md'),
            intent: 'final',
            kind: 'create',
          },
        ],
      ]),
      {
        getCustomSkillsDir: () => customSkillsDir,
        existingCustomSkillNames: new Set(['video-generation']),
        clearSkillsCache,
        resetAcpSkillManager,
      }
    );

    expect(results).toEqual([
      expect.objectContaining({
        status: 'updated',
        skillName: 'video-generation',
        installedVersion: '2.0.0',
        sourceDir: skillDir,
        targetDir,
      }),
    ]);
    await expect(fs.readFile(path.join(targetDir, 'SKILL.md'), 'utf-8')).resolves.toContain('Updated workflow instructions.');
    await expect(fs.readFile(path.join(targetDir, 'icon.svg'), 'utf-8')).resolves.toBe('<svg>new icon</svg>');
    await expect(fs.readFile(path.join(targetDir, 'scripts', 'run.ts'), 'utf-8')).resolves.toBe('export const version = 2;');
    await expect(fs.access(path.join(targetDir, 'obsolete.txt'))).rejects.toThrow();

    const meta = JSON.parse(await fs.readFile(path.join(targetDir, '_sudowork_meta.json'), 'utf-8'));
    expect(meta).toMatchObject({
      name: 'video-generation',
      display_name: 'A Share Hot Rank',
      description: 'New skill description',
      icon: 'icon.svg',
      source_type: 'upload',
      enabled: false,
      installed_version: '2.0.0',
      installed_at: '2026-05-01T00:00:00.000Z',
    });
    expect(clearSkillsCache).toHaveBeenCalledTimes(1);
    expect(resetAcpSkillManager).toHaveBeenCalledTimes(1);
  });

  it('registers a skill already moved into custom skills by the install script', async () => {
    const sourceDir = path.join(workspace, 'video-generation');
    const targetDir = path.join(customSkillsDir, 'video-generation');
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(
      path.join(targetDir, 'SKILL.md'),
      `---
name: video-generation
description: "Create product videos"
version: 2.0.0
---
`,
      'utf-8'
    );
    await fs.writeFile(path.join(targetDir, '_sudowork_meta.json'), JSON.stringify({ name: 'video-generation', source_type: 'upload' }), 'utf-8');

    const clearSkillsCache = vi.fn();
    const resetAcpSkillManager = vi.fn();
    const results = await installWorkspaceSkillsFromTrackedFiles(
      workspace,
      new Map<string, TrackedWorkspaceFile>([
        [
          'video-generation/SKILL.md',
          {
            path: path.join(sourceDir, 'SKILL.md'),
            intent: 'final',
            kind: 'create',
          },
        ],
      ]),
      {
        getCustomSkillsDir: () => customSkillsDir,
        existingCustomSkillNames: new Set(),
        clearSkillsCache,
        resetAcpSkillManager,
      }
    );

    expect(results).toEqual([
      expect.objectContaining({
        status: 'registered',
        skillName: 'video-generation',
        installedVersion: '2.0.0',
        sourceDir,
        targetDir,
      }),
    ]);
    expect(clearSkillsCache).toHaveBeenCalledTimes(1);
    expect(resetAcpSkillManager).toHaveBeenCalledTimes(1);
  });

  it('registers a skill installed by script without moving the staged directory', async () => {
    const sourceDir = path.join(workspace, 'video-generation');
    const targetDir = path.join(customSkillsDir, 'video-generation');
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(
      path.join(sourceDir, 'SKILL.md'),
      `---
name: video-generation
description: "Create product videos"
version: 2.0.0
---
`,
      'utf-8'
    );
    await fs.writeFile(path.join(sourceDir, '_sudowork_meta.json'), JSON.stringify({ name: 'video-generation' }), 'utf-8');
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(
      path.join(targetDir, 'SKILL.md'),
      `---
name: video-generation
description: "Create product videos"
version: 2.0.0
---
`,
      'utf-8'
    );
    await fs.writeFile(path.join(targetDir, '_sudowork_meta.json'), JSON.stringify({ name: 'video-generation', source_type: 'upload' }), 'utf-8');

    const results = await installWorkspaceSkillsFromTrackedFiles(
      workspace,
      new Map<string, TrackedWorkspaceFile>([
        [
          'video-generation/SKILL.md',
          {
            path: path.join(sourceDir, 'SKILL.md'),
            intent: 'final',
            kind: 'create',
          },
        ],
      ]),
      {
        getCustomSkillsDir: () => customSkillsDir,
        existingCustomSkillNames: new Set(),
      }
    );

    expect(results).toEqual([
      expect.objectContaining({
        status: 'registered',
        skillName: 'video-generation',
        installedVersion: '2.0.0',
        sourceDir,
        targetDir,
      }),
    ]);
  });

  it('does not register a pre-existing custom skill when staged source is gone', async () => {
    const sourceDir = path.join(workspace, 'video-generation');
    const targetDir = path.join(customSkillsDir, 'video-generation');
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(
      path.join(targetDir, 'SKILL.md'),
      `---
name: video-generation
version: 2.0.0
---
`,
      'utf-8'
    );
    await fs.writeFile(path.join(targetDir, '_sudowork_meta.json'), JSON.stringify({ name: 'video-generation', source_type: 'upload' }), 'utf-8');

    const clearSkillsCache = vi.fn();
    const results = await installWorkspaceSkillsFromTrackedFiles(
      workspace,
      new Map<string, TrackedWorkspaceFile>([
        [
          'video-generation/SKILL.md',
          {
            path: path.join(sourceDir, 'SKILL.md'),
            intent: 'final',
            kind: 'create',
          },
        ],
      ]),
      {
        getCustomSkillsDir: () => customSkillsDir,
        existingCustomSkillNames: new Set(['video-generation']),
        clearSkillsCache,
      }
    );

    expect(results).toEqual([
      {
        status: 'skipped',
        sourceDir,
        reason: 'not-directory',
      },
    ]);
    expect(clearSkillsCache).not.toHaveBeenCalled();
  });

  it('promotes skills installed into the sandbox home custom skill directory', async () => {
    const sandboxSkillDir = path.join(workspace, '.sandbox-home', '.nexus', 'skills', '_my-custom-skill', 'audio-transcription');
    await fs.mkdir(path.join(sandboxSkillDir, 'scripts'), { recursive: true });
    await fs.writeFile(
      path.join(sandboxSkillDir, 'SKILL.md'),
      `---
name: audio-transcription
description: "Transcribe audio files"
version: 1.0.0
---
`,
      'utf-8'
    );
    await fs.writeFile(
      path.join(sandboxSkillDir, '_sudowork_meta.json'),
      JSON.stringify({
        name: 'audio-transcription',
        display_name: '音频转写',
        description: 'Transcribe audio files',
        source_type: 'upload',
        enabled: true,
      }),
      'utf-8'
    );
    await fs.writeFile(path.join(sandboxSkillDir, 'scripts', 'transcribe_audio.py'), '# example', 'utf-8');

    const clearSkillsCache = vi.fn();
    const resetAcpSkillManager = vi.fn();
    const results = await installWorkspaceSkillsFromTrackedFiles(workspace, new Map(), {
      getCustomSkillsDir: () => customSkillsDir,
      existingCustomSkillNames: new Set(),
      clearSkillsCache,
      resetAcpSkillManager,
      now: () => new Date('2026-05-25T00:00:00.000Z'),
    });

    expect(results).toEqual([
      expect.objectContaining({
        status: 'installed',
        skillName: 'audio-transcription',
        targetDir: path.join(customSkillsDir, 'audio-transcription'),
      }),
    ]);
    await expect(fs.readFile(path.join(customSkillsDir, 'audio-transcription', 'scripts', 'transcribe_audio.py'), 'utf-8')).resolves.toBe('# example');
    expect(clearSkillsCache).toHaveBeenCalledTimes(1);
    expect(resetAcpSkillManager).toHaveBeenCalledTimes(1);
  });
});
