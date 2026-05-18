/**
 * Skill Manager - 统一管理 skill 的安装、禁用、启用、列表获取
 * Skill Manager - Unified management of skill install, disable, enable, list
 */

import fs from 'fs/promises';
import path from 'path';
import { existsSync, mkdirSync, existsSync as fsExistsSync } from 'fs';
import { app } from 'electron';
import { getSkillsDir, getSystemSkillsDir, getHubSkillsDir, getCustomSkillsDir } from './initStorage';
import { toAssetUrl } from '@/extensions/assetProtocol';
import { mainLog, mainError } from './utils/mainLogger';
import { isEnterpriseMode } from '@/common/enterpriseDebugConfig';
import { MOSS_SKILL_META_FILE } from './constants/skillStorage';
import { getEnterpriseTenantSkillsDir } from './constants/enterpriseStorage';

const UPLOAD_SKILL_DEFAULT_ICON_FILE = 'upload_skill_default.svg';

const SKILL_HUB_META_FILE = '_sudowork_meta.json';
const VERSION_FILE_NAME = 'version.txt';
/** Legacy version file written by older install flows. Kept for backward compatibility reads. */
const LEGACY_VERSION_FILE_NAME = 'sudowork-version';

// Skill 分类
export type SkillCategory = 'custom' | 'hub' | 'system' | 'tenant';

// Skill 状态
export type SkillStatus = 'enabled' | 'disabled';

// Skill 元数据（完整字段，与 ISkillHubMeta 兼容）
export interface ISkillMeta {
  id?: string;
  name?: string;
  display_name?: string;
  description?: string;
  icon?: string;
  emoji?: string | null;
  category?: string;
  categories?: string[];
  applicable_scenarios?: string | null;
  core_features?: string | null;
  homepage?: string | null;
  author_id?: string;
  source_type?: 'hub' | 'upload' | 'custom';
  is_builtin?: boolean;
  enabled?: boolean;
  installed_version?: string;
  installed_at?: string;
}

// Skill 信息（用于列表展示）
export interface ISkillInfo {
  name: string;
  version: string;
  isBuiltin: boolean;
  isAutoInjectedBuiltin?: boolean;
  isHubInstalled: boolean;
  enabled: boolean;
  category: SkillCategory;
  status: SkillStatus;
  meta?: ISkillMeta;
}

/**
 * Skill Manager 类
 */
export class SkillManager {
  // Use getters for dynamic directory resolution based on current mode
  private get skillsDir(): string {
    return getSkillsDir();
  }
  private get hubDir(): string {
    return getHubSkillsDir();
  }
  private get systemDir(): string {
    return getSystemSkillsDir();
  }
  private get customDir(): string {
    return getCustomSkillsDir();
  }
  private get tenantDir(): string {
    return getEnterpriseTenantSkillsDir();
  }

  constructor() {
    // Directory paths are now resolved dynamically via getters
    // ensureDirs() is called on first access if needed
  }

  // 确保所有目录存在
  private ensureDirs(): void {
    const dirs = [this.skillsDir, this.hubDir, this.systemDir, this.customDir];
    // Add tenant dir in enterprise mode
    if (isEnterpriseMode()) {
      dirs.push(this.tenantDir);
    }
    for (const dir of dirs) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }
  }

  // 获取禁用目录路径
  private getDisableDir(baseDir: string): string {
    return path.join(baseDir, '_disable');
  }

  // 获取默认上传技能图标路径
  private getUploadSkillDefaultIconPath(): string {
    if (app.isPackaged) {
      return path.join(process.resourcesPath!, UPLOAD_SKILL_DEFAULT_ICON_FILE);
    }

    const appPath = app.getAppPath();
    const candidates = [path.join(appPath, 'resources', UPLOAD_SKILL_DEFAULT_ICON_FILE), path.join(appPath, '..', 'resources', UPLOAD_SKILL_DEFAULT_ICON_FILE), path.join(appPath, '..', '..', 'resources', UPLOAD_SKILL_DEFAULT_ICON_FILE)];

    const existing = candidates.find((candidate) => fsExistsSync(candidate));
    return existing || candidates[0];
  }

  /**
   * Read skill metadata file, trying both Moss and Sudowork meta file names
   * Enterprise mode: _moss_meta.json (primary), _sudowork_meta.json (fallback)
   * Personal mode: _sudowork_meta.json (primary), _moss_meta.json (fallback)
   */
  private async readSkillMetaFile(skillDir: string): Promise<{ content: string; fileName: string } | null> {
    const isEnterprise = isEnterpriseMode();
    const metaFiles = isEnterprise ? [MOSS_SKILL_META_FILE, SKILL_HUB_META_FILE] : [SKILL_HUB_META_FILE, MOSS_SKILL_META_FILE];

    for (const fileName of metaFiles) {
      const filePath = path.join(skillDir, fileName);
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        return { content, fileName };
      } catch {
        // Try next file
      }
    }
    return null;
  }

  /**
   * Write skill metadata file, using correct file name based on current mode
   */
  private async writeSkillMetaFile(skillDir: string, meta: ISkillMeta): Promise<void> {
    const isEnterprise = isEnterpriseMode();
    const fileName = isEnterprise ? MOSS_SKILL_META_FILE : SKILL_HUB_META_FILE;
    const filePath = path.join(skillDir, fileName);
    await fs.writeFile(filePath, JSON.stringify(meta, null, 2), 'utf-8');
  }

  // 搜索技能目录（排除 _ 开头的目录）
  private async scanSkillDirs(baseDir: string): Promise<string[]> {
    const dirs: string[] = [];
    try {
      await fs.access(baseDir);
    } catch {
      return dirs;
    }

    const entries = await fs.readdir(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      // 排除 _ 开头的目录
      if (entry.name.startsWith('_')) continue;
      dirs.push(path.join(baseDir, entry.name));
    }
    return dirs;
  }

  // 递归搜索所有技能目录（包括嵌套目录如 _system/_builtin）
  private async scanAllSkillDirs(): Promise<string[]> {
    const dirs: string[] = [];

    // 扫描主目录
    for (const dir of [this.customDir, this.hubDir, this.systemDir]) {
      const subDirs = await this.scanSkillDirs(dir);
      dirs.push(...subDirs);
    }

    // 额外扫描 _system/_builtin 目录
    const builtinDir = path.join(this.systemDir, '_builtin');
    if (existsSync(builtinDir)) {
      const builtinSubDirs = await this.scanSkillDirs(builtinDir);
      dirs.push(...builtinSubDirs);
    }

    // 扫描企业模式下的 tenant 目录
    if (isEnterpriseMode()) {
      const tenantSubDirs = await this.scanSkillDirs(this.tenantDir);
      dirs.push(...tenantSubDirs);
    }

    return dirs;
  }

  // 扫描所有禁用目录中的技能
  private async scanDisabledSkillDirs(): Promise<{ dir: string; skillDirs: string[] }[]> {
    const results: { dir: string; skillDirs: string[] }[] = [];

    const disableDirs = [
      { base: this.customDir, category: 'custom' as SkillCategory },
      { base: this.hubDir, category: 'hub' as SkillCategory },
      { base: this.systemDir, category: 'system' as SkillCategory },
      { base: path.join(this.systemDir, '_builtin'), category: 'system' as SkillCategory },
    ];

    // Add tenant disable directory in enterprise mode
    if (isEnterpriseMode()) {
      disableDirs.push({ base: this.tenantDir, category: 'tenant' as SkillCategory });
    }

    for (const { base } of disableDirs) {
      const disableDir = this.getDisableDir(base);
      if (existsSync(disableDir)) {
        const skillDirs = await this.scanSkillDirs(disableDir);
        if (skillDirs.length > 0) {
          results.push({ dir: disableDir, skillDirs });
        }
      }
    }

    return results;
  }

  // 读取单个 skill 的信息
  private async readSkillInfo(skillDir: string, category: SkillCategory, forceBuiltin = false): Promise<ISkillInfo | null> {
    const dirName = path.basename(skillDir);
    const builtinDir = path.join(this.systemDir, '_builtin');

    // 读取版本 — try version.txt first, then legacy sudowork-version, then SKILL.md frontmatter
    let version = '';
    try {
      version = (await fs.readFile(path.join(skillDir, VERSION_FILE_NAME), 'utf-8')).trim();
    } catch {
      // Try legacy version file (sudowork-version) written by older install flows
      try {
        version = (await fs.readFile(path.join(skillDir, LEGACY_VERSION_FILE_NAME), 'utf-8')).trim();
      } catch {
        // 尝试从 SKILL.md frontmatter 读取
        try {
          const content = await fs.readFile(path.join(skillDir, 'SKILL.md'), 'utf-8');
          const m = content.match(/^version:\s*(.+)$/m);
          if (m) version = m[1].trim();
        } catch {
          /* ignore */
        }
      }
    }

    // 读取 metadata
    let meta: ISkillMeta | undefined;
    let isBuiltin = forceBuiltin;
    let isHubInstalled = category === 'hub';
    let enabled = true;

    const metaResult = await this.readSkillMetaFile(skillDir);
    if (metaResult) {
      meta = JSON.parse(metaResult.content) as ISkillMeta;

      if (!forceBuiltin && meta.is_builtin !== undefined) {
        isBuiltin = meta.is_builtin === true;
      }
      isHubInstalled = meta.source_type === 'hub';
      enabled = meta.enabled !== false;
      version = meta.installed_version || version;

      // 处理图标路径
      if (meta) {
        // 处理自定义技能的上传图标
        if (meta.icon === UPLOAD_SKILL_DEFAULT_ICON_FILE && meta.source_type === 'upload') {
          meta.icon = toAssetUrl(this.getUploadSkillDefaultIconPath());
        } else if (meta.icon && !meta.icon.startsWith('http') && !meta.icon.startsWith('/') && !meta.icon.startsWith('aion-asset://') && !meta.icon.startsWith('data:')) {
          // 处理相对路径图标
          const iconAbsPath = path.join(skillDir, meta.icon);
          if (fsExistsSync(iconAbsPath)) {
            meta.icon = toAssetUrl(iconAbsPath);
          }
        }
      }
    } else {
      // 没有 metadata 文件，默认为自定义
      meta = { source_type: 'upload' };
      isHubInstalled = false;
    }

    return {
      name: meta?.name?.trim() || dirName,
      version,
      isBuiltin,
      isAutoInjectedBuiltin: skillDir.startsWith(`${builtinDir}${path.sep}`) || skillDir === builtinDir,
      isHubInstalled,
      enabled,
      category,
      status: 'enabled',
      meta,
    };
  }

  // 根据目录路径确定分类
  private getCategoryFromPath(skillPath: string): SkillCategory {
    if (skillPath.startsWith(this.systemDir) || skillPath.startsWith(path.join(this.systemDir, '_builtin'))) {
      return 'system';
    }
    if (skillPath.startsWith(this.hubDir)) {
      return 'hub';
    }
    if (isEnterpriseMode() && skillPath.startsWith(this.tenantDir)) {
      return 'tenant';
    }
    return 'custom';
  }

  // 获取所有已安装的技能列表
  async getInstalledSkills(): Promise<ISkillInfo[]> {
    this.ensureDirs();
    const skills: ISkillInfo[] = [];

    // Debug: log enterprise mode and directories
    const isEnterprise = isEnterpriseMode();
    mainLog('SkillManager', `getInstalledSkills: isEnterpriseMode=${isEnterprise}, hubDir=${this.hubDir}`);

    // 1. 扫描所有启用的技能目录
    const enabledDirs = await this.scanAllSkillDirs();
    for (const skillDir of enabledDirs) {
      const category = this.getCategoryFromPath(skillDir);
      const isSystem = category === 'system';
      const skill = await this.readSkillInfo(skillDir, category, isSystem);
      if (skill) {
        skill.status = 'enabled';
        skills.push(skill);
      }
    }

    // 2. 扫描所有禁用的技能目录
    const disabledResults = await this.scanDisabledSkillDirs();
    for (const { skillDirs } of disabledResults) {
      for (const skillDir of skillDirs) {
        const category = this.getCategoryFromPath(skillDir);
        const isSystem = category === 'system';
        const skill = await this.readSkillInfo(skillDir, category, isSystem);
        if (skill) {
          skill.status = 'disabled';
          skill.enabled = false;
          skills.push(skill);
        }
      }
    }

    return skills;
  }
  // 查找技能目录
  private async findSkillDir(skillName: string, includeDisabled = true): Promise<{ dir: string; category: SkillCategory; isDisabled: boolean } | null> {
    // Trim skillName to handle cases where metadata had leading/trailing spaces
    const trimmedName = skillName.trim();

    // 搜索启用目录
    const searchDirs = [
      { dir: this.customDir, category: 'custom' as SkillCategory },
      { dir: this.hubDir, category: 'hub' as SkillCategory },
      { dir: this.systemDir, category: 'system' as SkillCategory },
      { dir: path.join(this.systemDir, '_builtin'), category: 'system' as SkillCategory },
    ];

    // Add tenant directory in enterprise mode
    if (isEnterpriseMode()) {
      searchDirs.splice(1, 0, { dir: this.tenantDir, category: 'tenant' as SkillCategory }); // Insert after custom
    }

    // Try trimmed name first, then original name (for backward compatibility with dirs created with spaces)
    const namesToTry = [trimmedName, skillName].filter((n, i, arr) => arr.indexOf(n) === i);

    for (const name of namesToTry) {
      for (const { dir, category } of searchDirs) {
        const skillDir = path.join(dir, name);
        if (existsSync(skillDir)) {
          return { dir: skillDir, category, isDisabled: false };
        }
      }
    }

    // 搜索禁用目录
    if (includeDisabled) {
      for (const name of namesToTry) {
        for (const { dir, category } of searchDirs) {
          const disableDir = this.getDisableDir(dir);
          const skillDir = path.join(disableDir, name);
          if (existsSync(skillDir)) {
            return { dir: skillDir, category, isDisabled: true };
          }
        }
      }
    }

    return null;
  }

  // 根据分类查找技能目录（优先按指定分类查找）
  private async findSkillDirByCategory(skillName: string, category?: SkillCategory, includeDisabled = true): Promise<{ dir: string; category: SkillCategory; isDisabled: boolean } | null> {
    // Trim skillName to handle cases where metadata had leading/trailing spaces
    const trimmedName = skillName.trim();
    const namesToTry = [trimmedName, skillName].filter((n, i, arr) => arr.indexOf(n) === i);

    // 如果指定了分类，优先在该分类目录中查找
    if (category) {
      const categoryDirMap: Record<SkillCategory, string> = {
        custom: this.customDir,
        hub: this.hubDir,
        system: this.systemDir,
        tenant: this.tenantDir,
      };
      const baseDir = categoryDirMap[category];

      // 搜索启用目录
      for (const name of namesToTry) {
        const skillDir = path.join(baseDir, name);
        if (existsSync(skillDir)) {
          return { dir: skillDir, category, isDisabled: false };
        }
      }

      // 搜索禁用目录
      if (includeDisabled) {
        for (const name of namesToTry) {
          const disableDir = this.getDisableDir(baseDir);
          const skillDir = path.join(disableDir, name);
          if (existsSync(skillDir)) {
            return { dir: skillDir, category, isDisabled: true };
          }
        }
      }

      // 如果指定了分类但没找到，返回 null（不回退到其他分类）
      return null;
    }

    // 未指定分类时，使用默认搜索顺序
    return this.findSkillDir(skillName, includeDisabled);
  }

  // 禁用技能
  async disableSkill(skillName: string, category?: SkillCategory): Promise<{ success: boolean; msg?: string }> {
    try {
      const result = await this.findSkillDirByCategory(skillName, category);
      if (!result) {
        return { success: false, msg: 'Skill not found' };
      }

      const { dir: skillDir, category: foundCategory, isDisabled } = result;

      if (isDisabled) {
        return { success: false, msg: 'Skill is already disabled' };
      }

      // 检查是否为内置技能
      const metaResult = await this.readSkillMetaFile(skillDir);
      if (metaResult) {
        const meta = JSON.parse(metaResult.content) as ISkillMeta;
        if (meta.is_builtin === true) {
          return { success: false, msg: '内置技能无法禁用' };
        }
      }

      // 获取基础目录
      let baseDir: string;
      switch (foundCategory) {
        case 'system':
          baseDir = this.systemDir;
          break;
        case 'hub':
          baseDir = this.hubDir;
          break;
        case 'tenant':
          baseDir = this.tenantDir;
          break;
        default:
          baseDir = this.customDir;
      }

      // 移动到 _disable 目录
      const disableDir = this.getDisableDir(baseDir);
      if (!existsSync(disableDir)) {
        mkdirSync(disableDir, { recursive: true });
      }

      const destDir = path.join(disableDir, skillName);
      if (existsSync(destDir)) {
        await fs.rm(destDir, { recursive: true, force: true });
      }
      await fs.rename(skillDir, destDir);

      // 修改 meta
      const existingMeta = await this.readSkillMetaFile(destDir);
      if (existingMeta) {
        const meta = JSON.parse(existingMeta.content) as ISkillMeta;
        meta.enabled = false;
        await this.writeSkillMetaFile(destDir, meta);
      } else {
        // 没有 meta 文件，创建一个
        const newMeta: ISkillMeta = { enabled: false, source_type: 'upload' };
        await this.writeSkillMetaFile(destDir, newMeta);
      }

      mainLog('SkillManager', `Disabled skill: ${skillName} (category: ${foundCategory})`);
      return { success: true };
    } catch (error) {
      mainError('SkillManager', 'Failed to disable skill:', error);
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  }

  // 启用技能
  async enableSkill(skillName: string, category?: SkillCategory): Promise<{ success: boolean; msg?: string }> {
    try {
      const result = await this.findSkillDirByCategory(skillName, category, true);
      if (!result) {
        return { success: false, msg: 'Skill not found' };
      }

      const { dir: skillDir, category: foundCategory, isDisabled } = result;

      if (!isDisabled) {
        return { success: false, msg: 'Skill is already enabled' };
      }

      // 获取基础目录
      let baseDir: string;
      switch (foundCategory) {
        case 'system':
          baseDir = this.systemDir;
          break;
        case 'hub':
          baseDir = this.hubDir;
          break;
        case 'tenant':
          baseDir = this.tenantDir;
          break;
        default:
          baseDir = this.customDir;
      }

      // 从 _disable 目录移动回基础目录
      const destDir = path.join(baseDir, skillName);
      if (existsSync(destDir)) {
        await fs.rm(destDir, { recursive: true, force: true });
      }
      await fs.rename(skillDir, destDir);

      // 修改 meta
      const existingMeta = await this.readSkillMetaFile(destDir);
      if (existingMeta) {
        const meta = JSON.parse(existingMeta.content) as ISkillMeta;
        meta.enabled = true;
        await this.writeSkillMetaFile(destDir, meta);
      } else {
        // 没有 meta 文件，创建一个
        const newMeta: ISkillMeta = { enabled: true, source_type: 'upload' };
        await this.writeSkillMetaFile(destDir, newMeta);
      }

      mainLog('SkillManager', `Enabled skill: ${skillName} (category: ${foundCategory})`);
      return { success: true };
    } catch (error) {
      mainError('SkillManager', 'Failed to enable skill:', error);
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  }

  // 卸载技能
  async uninstallSkill(skillName: string, category?: SkillCategory): Promise<{ success: boolean; msg?: string }> {
    try {
      const result = await this.findSkillDirByCategory(skillName, category, true);
      if (!result) {
        return { success: false, msg: 'Skill not found' };
      }

      const { dir: skillDir, isDisabled } = result;

      // 检查是否为内置技能
      const metaResult = await this.readSkillMetaFile(skillDir);
      if (metaResult) {
        const meta = JSON.parse(metaResult.content) as ISkillMeta;
        if (meta.is_builtin === true) {
          return { success: false, msg: '内置技能无法卸载' };
        }
      }

      await fs.rm(skillDir, { recursive: true, force: true });
      mainLog('SkillManager', `Uninstalled skill: ${skillName} (was disabled: ${isDisabled})`);
      return { success: true };
    } catch (error) {
      mainError('SkillManager', 'Failed to uninstall skill:', error);
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  }
}

// 导出单例
export const skillManager = new SkillManager();
