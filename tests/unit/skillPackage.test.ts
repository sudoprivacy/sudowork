/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { buildSkillDisplayName, canonicalizeSkillMarkdownPath, findRootSkillMarkdownFileName, isSkillMarkdownFileName, parseSkillFrontmatter, resolveSkillIconFromFiles } from '../../src/process/utils/skillPackage';

describe('skillPackage utils', () => {
  it('parses basic frontmatter fields from SKILL.md', () => {
    const parsed = parseSkillFrontmatter(`---
name: demo-skill
display_name: Demo Skill
description: "A demo skill"
icon: icon.svg
emoji: "🧪"
category: tools
homepage: https://example.com
version: 1.2.3
---

# Demo
`);

    expect(parsed).toEqual({
      name: 'demo-skill',
      displayName: 'Demo Skill',
      description: 'A demo skill',
      icon: 'icon.svg',
      emoji: '🧪',
      category: 'tools',
      homepage: 'https://example.com',
      version: '1.2.3',
    });
  });

  it('extracts nested metadata values when direct keys are absent', () => {
    const parsed = parseSkillFrontmatter(`---
name: moltbook
metadata: { 'moltbot': { 'emoji': '🦞', 'category': 'social' } }
---
`);

    expect(parsed.emoji).toBe('🦞');
    expect(parsed.category).toBe('social');
  });

  it('finds a default icon candidate from extracted files', () => {
    expect(resolveSkillIconFromFiles(['README.md', 'assets/icon.svg', 'cover.png'])).toBe('assets/icon.svg');
  });

  it('builds a fallback display name from the skill identifier', () => {
    expect(buildSkillDisplayName('pptx-generator')).toBe('Pptx Generator');
  });

  it('matches SKILL.md case-insensitively', () => {
    expect(isSkillMarkdownFileName('SKILL.md')).toBe(true);
    expect(isSkillMarkdownFileName('skill.MD')).toBe(true);
    expect(isSkillMarkdownFileName('docs/SKILL.md')).toBe(true);
    expect(isSkillMarkdownFileName('README.md')).toBe(false);
  });

  it('canonicalizes skill markdown paths to SKILL.md', () => {
    expect(canonicalizeSkillMarkdownPath('skill.md')).toBe('SKILL.md');
    expect(canonicalizeSkillMarkdownPath('./nested/Skill.MD')).toBe('nested/SKILL.md');
    expect(canonicalizeSkillMarkdownPath('nested/README.md')).toBe('nested/README.md');
  });

  it('finds a root-level SKILL.md file case-insensitively', () => {
    expect(findRootSkillMarkdownFileName(['README.md', 'skill.md', 'assets'])).toBe('skill.md');
    expect(findRootSkillMarkdownFileName(['nested/SKILL.md', 'README.md'])).toBeUndefined();
  });

  it('rejects multiple root-level SKILL.md variants', () => {
    expect(() => findRootSkillMarkdownFileName(['SKILL.md', 'skill.md'])).toThrow('Multiple SKILL.md files found in the selected directory root');
  });
});
