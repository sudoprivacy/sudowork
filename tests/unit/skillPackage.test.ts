/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { buildSkillDisplayName, parseSkillFrontmatter, resolveSkillIconFromFiles } from '../../src/process/utils/skillPackage';

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
});
