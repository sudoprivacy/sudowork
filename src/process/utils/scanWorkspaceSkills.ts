/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs/promises';
import path from 'path';
import { toAssetUrl } from '@/extensions/assetProtocol';

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

function toSkillItem(
  skillPath: string,
  parsed: { name?: string; description?: string; icon?: string; color?: string } | undefined,
  meta?: SkillMeta
): ScannedWorkspaceSkill | undefined {
  if (!parsed?.name) return undefined;
  const iconUrl = resolveDeclaredIconUrl(skillPath, meta?.icon) || resolveDeclaredIconUrl(skillPath, parsed.icon);
  return {
    name: parsed.name,
    displayName: meta?.display_name?.trim() || undefined,
    description: meta?.description?.trim() || parsed.description || '',
    path: skillPath,
    icon: parsed.icon,
    iconUrl,
    color: parsed.color,
    emoji: meta?.emoji,
  };
}

function resolveDeclaredIconUrl(skillPath: string, icon?: string): string | undefined {
  const normalized = icon?.trim();
  if (!normalized) return undefined;
  if (normalized.startsWith('http') || normalized.startsWith('/') || normalized.startsWith('aion-asset://') || normalized.startsWith('data:')) {
    return normalized;
  }
  if (!IMAGE_FILE_RE.test(normalized)) {
    return undefined;
  }
  return toAssetUrl(path.join(skillPath, normalized));
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

  await fs.access(folderPath);
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
