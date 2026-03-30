/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'path';

export type ParsedSkillFrontmatter = {
  name?: string;
  displayName?: string;
  description?: string;
  icon?: string;
  emoji?: string;
  category?: string;
  homepage?: string;
  version?: string;
};

function stripQuotes(value: string): string {
  return value
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .trim();
}

function matchFrontmatterValue(frontmatter: string, key: string): string | undefined {
  const directMatch = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  if (directMatch) {
    return stripQuotes(directMatch[1]);
  }

  const nestedMatch = frontmatter.match(new RegExp(`['"]${key}['"]\\s*:\\s*['"]([^'"]+)['"]`, 'm'));
  if (nestedMatch) {
    return nestedMatch[1].trim();
  }

  return undefined;
}

export function parseSkillFrontmatter(content: string): ParsedSkillFrontmatter {
  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    return {};
  }

  const frontmatter = frontmatterMatch[1];
  return {
    name: matchFrontmatterValue(frontmatter, 'name'),
    displayName: matchFrontmatterValue(frontmatter, 'display_name'),
    description: matchFrontmatterValue(frontmatter, 'description'),
    icon: matchFrontmatterValue(frontmatter, 'icon'),
    emoji: matchFrontmatterValue(frontmatter, 'emoji'),
    category: matchFrontmatterValue(frontmatter, 'category'),
    homepage: matchFrontmatterValue(frontmatter, 'homepage'),
    version: matchFrontmatterValue(frontmatter, 'version'),
  };
}

export function buildSkillDisplayName(skillName: string): string {
  return skillName
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function resolveSkillIconFromFiles(fileNames: Iterable<string>): string | undefined {
  const iconCandidates = new Set(['icon.svg', 'icon.png', 'icon.jpg', 'icon.jpeg', 'icon.webp', 'logo.svg', 'logo.png', 'logo.jpg', 'logo.jpeg', 'logo.webp']);

  for (const fileName of fileNames) {
    const normalized = fileName.replaceAll('\\', '/').replace(/^\.\/+/, '');
    const baseName = path.posix.basename(normalized).toLowerCase();
    if (iconCandidates.has(baseName)) {
      return normalized;
    }
  }

  return undefined;
}
