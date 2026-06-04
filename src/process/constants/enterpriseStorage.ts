/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Enterprise Mode Directory Management
 *
 * 企业模式目录管理模块，提供企业模式下的技能和助手目录路径计算。
 * 企业模式使用不带 `_` 前缀的子目录结构（hub/custom/tenant/system）。
 */

import path from 'path';
import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import { isEnterpriseMode } from '@/common/enterpriseDebugConfig';
import { ENTERPRISE_SKILL_SUBDIRS, SKILL_SUBDIRS, SKILL_HUB_META_FILE, MOSS_SKILL_META_FILE } from './skillStorage';
import { ENTERPRISE_ASSISTANT_SUBDIRS, ASSISTANT_SUBDIRS, ASSISTANT_META_FILE, MOSS_ASSISTANT_META_FILE } from './assistantStorage';
import { getDataPath } from '@process/utils';

// Re-export for use in bridge files
export { ENTERPRISE_SKILL_SUBDIRS, ENTERPRISE_ASSISTANT_SUBDIRS };

/** Nexus root directory (<data-root>) */
export const getNexusDir = (): string => getDataPath();

/** Skills root directory */
export const getSkillsRootDir = (): string => path.join(getNexusDir(), 'skills');

/** Assistants root directory */
export const getAssistantsRootDir = (): string => path.join(getNexusDir(), 'assistants');

/** Source type for skills/assistants */
export type SourceType = 'hub' | 'custom' | 'tenant' | 'system';

/**
 * Get skill metadata file name based on current mode
 * Enterprise mode: _moss_meta.json (matches Moss Server)
 * Personal mode: _sudowork_meta.json
 */
export function getSkillMetaFileName(): string {
  if (isEnterpriseMode()) {
    return MOSS_SKILL_META_FILE;
  }
  return SKILL_HUB_META_FILE;
}

/**
 * Get assistant metadata file name based on current mode
 * Enterprise mode: _moss_meta.json (matches Moss Server)
 * Personal mode: _sudowork_meta.json
 */
export function getAssistantMetaFileName(): string {
  if (isEnterpriseMode()) {
    return MOSS_ASSISTANT_META_FILE;
  }
  return ASSISTANT_META_FILE;
}

/**
 * Get skill subdirectory name based on current mode
 * 根据当前模式获取技能子目录名称
 */
export function getSkillSubdirName(sourceType: SourceType): string {
  if (isEnterpriseMode()) {
    return ENTERPRISE_SKILL_SUBDIRS[sourceType];
  }
  // Personal mode: map 'tenant' to 'custom' since tenant doesn't exist in personal mode
  if (sourceType === 'tenant') {
    return SKILL_SUBDIRS.custom;
  }
  return SKILL_SUBDIRS[sourceType];
}

/**
 * Get assistant subdirectory name based on current mode
 * 根据当前模式获取助手子目录名称
 */
export function getAssistantSubdirName(sourceType: SourceType): string {
  if (isEnterpriseMode()) {
    return ENTERPRISE_ASSISTANT_SUBDIRS[sourceType];
  }
  // Personal mode: map 'tenant' to 'custom' since tenant doesn't exist in personal mode
  if (sourceType === 'tenant') {
    return ASSISTANT_SUBDIRS.custom;
  }
  return ASSISTANT_SUBDIRS[sourceType];
}

/**
 * Get skill install directory path
 * 获取技能安装目录路径
 *
 * @param skillName - Skill name (directory name)
 * @param sourceType - Source type (hub/custom/tenant/system)
 * @returns Full path to skill directory
 */
export function getSkillInstallDir(skillName: string, sourceType: SourceType): string {
  const subdirName = getSkillSubdirName(sourceType);
  return path.join(getSkillsRootDir(), subdirName, skillName);
}

/**
 * Get assistant install directory path
 * 获取助手安装目录路径
 *
 * @param assistantName - Assistant name (directory name)
 * @param sourceType - Source type (hub/custom/tenant/system)
 * @returns Full path to assistant directory
 */
export function getAssistantInstallDir(assistantName: string, sourceType: SourceType): string {
  const subdirName = getAssistantSubdirName(sourceType);
  return path.join(getAssistantsRootDir(), subdirName, assistantName);
}

/**
 * Get hub skills directory path
 * 获取 Hub 安装技能目录路径
 */
export function getEnterpriseHubSkillsDir(): string {
  return path.join(getSkillsRootDir(), ENTERPRISE_SKILL_SUBDIRS.hub);
}

/**
 * Get custom skills directory path
 * 获取自定义技能目录路径
 */
export function getEnterpriseCustomSkillsDir(): string {
  return path.join(getSkillsRootDir(), ENTERPRISE_SKILL_SUBDIRS.custom);
}

/**
 * Get tenant skills directory path
 * 获取企业专属技能目录路径
 */
export function getEnterpriseTenantSkillsDir(): string {
  return path.join(getSkillsRootDir(), ENTERPRISE_SKILL_SUBDIRS.tenant);
}

/**
 * Get hub assistants directory path
 * 获取 Hub 安装助手目录路径
 */
export function getEnterpriseHubAssistantsDir(): string {
  return path.join(getAssistantsRootDir(), ENTERPRISE_ASSISTANT_SUBDIRS.hub);
}

/**
 * Get custom assistants directory path
 * 获取自定义助手目录路径
 */
export function getEnterpriseCustomAssistantsDir(): string {
  return path.join(getAssistantsRootDir(), ENTERPRISE_ASSISTANT_SUBDIRS.custom);
}

/**
 * Get tenant assistants directory path
 * 获取企业专属助手目录路径
 */
export function getEnterpriseTenantAssistantsDir(): string {
  return path.join(getAssistantsRootDir(), ENTERPRISE_ASSISTANT_SUBDIRS.tenant);
}

/**
 * Initialize enterprise mode directory structure
 * 初始化企业模式目录结构
 *
 * Creates hub/custom/tenant/system subdirectories under skills/ and assistants/
 */
export function initEnterpriseDirs(): void {
  if (!isEnterpriseMode()) {
    return;
  }

  // Ensure root directories exist
  const skillsRootDir = getSkillsRootDir();
  const assistantsRootDir = getAssistantsRootDir();
  if (!existsSync(skillsRootDir)) {
    mkdirSync(skillsRootDir, { recursive: true });
  }
  if (!existsSync(assistantsRootDir)) {
    mkdirSync(assistantsRootDir, { recursive: true });
  }

  // Create enterprise mode subdirectories
  const skillSubdirs = Object.values(ENTERPRISE_SKILL_SUBDIRS);
  const assistantSubdirs = Object.values(ENTERPRISE_ASSISTANT_SUBDIRS);

  for (const subdir of skillSubdirs) {
    const dirPath = path.join(skillsRootDir, subdir);
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true });
    }
  }

  for (const subdir of assistantSubdirs) {
    const dirPath = path.join(assistantsRootDir, subdir);
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true });
    }
  }
}

/**
 * Check if enterprise directories are initialized
 * 检查企业模式目录是否已初始化
 */
export function areEnterpriseDirsInitialized(): boolean {
  if (!isEnterpriseMode()) {
    return true; // Not enterprise mode, no need to check
  }

  const requiredDirs = [getEnterpriseHubSkillsDir(), getEnterpriseCustomSkillsDir(), getEnterpriseTenantSkillsDir(), getEnterpriseHubAssistantsDir(), getEnterpriseCustomAssistantsDir(), getEnterpriseTenantAssistantsDir()];

  return requiredDirs.every((dir) => existsSync(dir));
}

/**
 * Get all skill directories by source type
 * 获取指定源类型的所有技能目录
 *
 * @param sourceType - Source type to filter
 * @returns Array of skill directory paths
 */
export async function getSkillDirsBySourceType(sourceType: SourceType): Promise<string[]> {
  const parentDir = getSkillInstallDir('', sourceType).replace(/\/$/, '');

  if (!existsSync(parentDir)) {
    return [];
  }

  const entries = await fs.readdir(parentDir, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(parentDir, entry.name));
}

/**
 * Get all assistant directories by source type
 * 获取指定源类型的所有助手目录
 *
 * @param sourceType - Source type to filter
 * @returns Array of assistant directory paths
 */
export async function getAssistantDirsBySourceType(sourceType: SourceType): Promise<string[]> {
  const parentDir = getAssistantInstallDir('', sourceType).replace(/\/$/, '');

  if (!existsSync(parentDir)) {
    return [];
  }

  const entries = await fs.readdir(parentDir, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(parentDir, entry.name));
}
