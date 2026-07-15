import { normalizeSkillVersion } from '@/renderer/utils/skillDisplay';
import { resolveExtensionAssetUrl } from '@/renderer/utils/platform';
import coworkSvg from '@/renderer/assets/cowork.svg';
import type { IAssistantHubSkill, IAssistantHubVersionLike, IInstalledSkillInfo } from '@/common/ipcBridge';
import type { AssistantLatestVersion } from '../types';

const AVATAR_IMAGE_MAP: Record<string, string> = {
  'cowork.svg': coworkSvg,
  '🛠️': coworkSvg,
};

export function resolveAvatarImageSrc(avatar: string | undefined): string | undefined {
  const value = avatar?.trim();
  if (!value) return undefined;
  const mapped = AVATAR_IMAGE_MAP[value];
  if (mapped) return mapped;
  const resolved = resolveExtensionAssetUrl(value) || value;
  const isImage = /\.(svg|png|jpe?g|webp|gif)$/i.test(resolved) || /^(https?:|aion-asset:\/\/|file:\/\/|data:)/i.test(resolved);
  return isImage ? resolved : undefined;
}

export function isEmoji(str: string): boolean {
  if (!str) return false;
  const emojiRegex = /^(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:\u200D(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F))*$/u;
  return emojiRegex.test(str);
}

export const normalizeAssistantVersion = (version?: string | null) => normalizeSkillVersion(version).replace(/^v(?=\d)/i, '');

export const normalizeAssistantLookupKey = (value: string | null | undefined) => value?.trim().toLowerCase();

export const resolveAssistantVersionLike = (assistant: IAssistantHubSkill, versionLike?: IAssistantHubVersionLike | null): AssistantLatestVersion | null => {
  const sourceUrl = versionLike?.source_url || versionLike?.sourceUrl || assistant._sourceUrl;
  const version = normalizeAssistantVersion(versionLike?.version || assistant.version);
  if (!sourceUrl || !version) return null;
  return {
    version,
    sourceUrl,
    checksum: versionLike?.checksum || '',
    fetchedAt: Date.now(),
  };
};

export function isAutoInjectedBuiltinSkill(skill: IInstalledSkillInfo): boolean {
  return skill.isAutoInjectedBuiltin === true;
}

export function getSelectableAssistantSkills(installedSkills: IInstalledSkillInfo[]): IInstalledSkillInfo[] {
  return installedSkills.filter((skill) => !isAutoInjectedBuiltinSkill(skill) && (skill.isBuiltin || skill.enabled !== false));
}

export function getAssistantSkillId(skill: IInstalledSkillInfo): string {
  return skill.meta?.id || skill.name;
}

export function getAssistantSkillAliases(skill: IInstalledSkillInfo): string[] {
  return Array.from(new Set([getAssistantSkillId(skill), skill.name].filter(Boolean)));
}

export function isAssistantSkillSelected(selectedSkills: string[], skill: IInstalledSkillInfo): boolean {
  return selectedSkills.includes(getAssistantSkillId(skill));
}

export function toggleAssistantSkillSelection(selectedSkills: string[], skill: IInstalledSkillInfo): string[] {
  const aliases = getAssistantSkillAliases(skill);
  if (aliases.some((alias) => selectedSkills.includes(alias))) {
    return selectedSkills.filter((selected) => !aliases.includes(selected));
  }
  return [...selectedSkills, getAssistantSkillId(skill)];
}

export function sanitizeAssistantEnabledSkills(enabledSkills: string[] | undefined, installedSkills: IInstalledSkillInfo[]): string[] {
  const canonicalByAlias = new Map<string, string | null>();
  getSelectableAssistantSkills(installedSkills).forEach((skill) => {
    const skillId = getAssistantSkillId(skill);
    getAssistantSkillAliases(skill).forEach((alias) => {
      const existing = canonicalByAlias.get(alias);
      if (existing && existing !== skillId) {
        canonicalByAlias.set(alias, null);
        return;
      }
      canonicalByAlias.set(alias, skillId);
    });
  });
  const sanitized = (enabledSkills || []).map((skillId) => canonicalByAlias.get(skillId)).filter((skillId): skillId is string => typeof skillId === 'string');
  return Array.from(new Set(sanitized));
}
