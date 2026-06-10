/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { toAssetUrl } from '@/extensions/assetProtocol';
import { COS_HUB_BASE } from '@/shared/cos';

/** COS base URL for Hub skill icons (role-based hub bucket; primary). */
const HUB_SKILL_ICON_COS_BASE = `${COS_HUB_BASE}/`;

export type ScannedWorkspaceSkill = {
  name: string;
  description: string;
  path: string;
  displayName?: string;
  icon?: string;
  iconUrl?: string;
  color?: string;
  emoji?: string | null;
};

type SkillMeta = {
  display_name?: string;
  description?: string;
  icon?: string;
  emoji?: string | null;
};

const IMAGE_FILE_RE = /\.(svg|png|jpe?g|webp|gif|avif)$/i;

const cleanYamlValue = (raw: string): string => {
  let v = raw.trim();
  if (!(v.startsWith('"') || v.startsWith("'"))) {
    const hashIdx = v.indexOf('#');
    if (hashIdx > 0) v = v.slice(0, hashIdx).trim();
  }
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  return v;
};

const parseFrontMatter = (content: string): { name?: string; description?: string; icon?: string; color?: string } | undefined => {
  const frontMatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!frontMatterMatch) return undefined;
  const yaml = frontMatterMatch[1];
  const pick = (key: string): string | undefined => {
    const re = new RegExp(`^${key}:\\s*(.+)$`, 'mi');
    const m = yaml.match(re);
    if (!m) return undefined;
    const v = cleanYamlValue(m[1]);
    return v || undefined;
  };
  return {
    name: pick('name'),
    description: pick('description'),
    icon: pick('icon'),
    color: pick('color'),
  };
};

async function isDirectoryLike(entryPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(entryPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

function toSkillItem(skillPath: string, parsed: { name?: string; description?: string; icon?: string; color?: string } | undefined, meta?: SkillMeta): ScannedWorkspaceSkill | undefined {
  if (!parsed?.name) return undefined;
  const iconUrl = resolveDeclaredIconUrl(skillPath, meta?.icon) || resolveDeclaredIconUrl(skillPath, parsed.icon);
  return {
    name: parsed.name,
    displayName: meta?.display_name?.trim() || undefined,
    description: meta?.description?.trim() || parsed.description || '',
    path: skillPath,
    icon: meta?.icon || parsed.icon,
    iconUrl,
    color: parsed.color,
    emoji: meta?.emoji,
  };
}

/**
 * Check if a URL is a relative path (not absolute URL or protocol URL)
 * Used to detect Hub skill icon paths that need COS URL prefix.
 */
function isRelativePath(url: string): boolean {
  if (!url) return false;
  return !url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('data:') && !url.startsWith('/') && !url.startsWith('aion-asset://') && !url.startsWith('file://') && !url.startsWith('./');
}

function resolveDeclaredIconUrl(skillPath: string, icon?: string): string | undefined {
  const normalized = icon?.trim();
  if (!normalized) return undefined;

  // Keep the upload fallback icon token intact so the renderer can map it to
  // the bundled local asset instead of treating it as a Hub CDN path.
  if (normalized === 'upload_skill_default.svg') {
    return normalized;
  }

  // Absolute URLs and protocol URLs: return directly
  if (normalized.startsWith('http://') || normalized.startsWith('https://') || normalized.startsWith('/') || normalized.startsWith('aion-asset://') || normalized.startsWith('data:') || normalized.startsWith('file://')) {
    return normalized;
  }

  // Relative paths that are NOT image files: treat as Hub skill icon path
  // e.g., "skills/some-skill/icon.png" from Hub API
  if (!IMAGE_FILE_RE.test(normalized)) {
    // If it looks like a relative path (contains path separators), prepend COS URL
    if (isRelativePath(normalized)) {
      return `${HUB_SKILL_ICON_COS_BASE}${normalized}`;
    }
    return undefined;
  }

  // Image file paths: try to resolve locally
  const iconPath = path.join(skillPath, normalized);
  if (!existsSync(iconPath)) {
    // File not found locally: if it's a relative path, prepend COS URL
    if (isRelativePath(normalized)) {
      return `${HUB_SKILL_ICON_COS_BASE}${normalized}`;
    }
    return undefined;
  }
  return toAssetUrl(iconPath);
}

async function readSkillMeta(skillPath: string): Promise<SkillMeta | undefined> {
  try {
    const raw = await fs.readFile(path.join(skillPath, '_sudowork_meta.json'), 'utf-8');
    return JSON.parse(raw) as SkillMeta;
  } catch {
    return undefined;
  }
}

export async function scanWorkspaceSkills(folderPath: string): Promise<ScannedWorkspaceSkill[]> {
  const skills: ScannedWorkspaceSkill[] = [];

  try {
    await fs.access(folderPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return skills;
    }
    throw error;
  }
  const entries = await fs.readdir(folderPath, { withFileTypes: true });

  for (const entry of entries) {
    const skillDir = path.join(folderPath, entry.name);
    const directoryLike = entry.isDirectory() || (entry.isSymbolicLink() && (await isDirectoryLike(skillDir)));
    if (!directoryLike) continue;

    const skillMdPath = path.join(skillDir, 'SKILL.md');
    try {
      const content = await fs.readFile(skillMdPath, 'utf-8');
      const meta = await readSkillMeta(skillDir);
      const item = toSkillItem(skillDir, parseFrontMatter(content), meta);
      if (item) {
        skills.push(item);
      }
    } catch {
      // Skill directory without SKILL.md, skip
    }
  }

  if (skills.length === 0) {
    const skillMdPath = path.join(folderPath, 'SKILL.md');
    try {
      const content = await fs.readFile(skillMdPath, 'utf-8');
      const meta = await readSkillMeta(folderPath);
      const item = toSkillItem(folderPath, parseFrontMatter(content), meta);
      if (item) {
        skills.push(item);
      }
    } catch {
      // Not a skill directory
    }
  }

  return skills;
}
