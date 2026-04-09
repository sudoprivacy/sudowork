/**
 * Skill Manager - 统一管理 skill 的安装、禁用、启用、列表获取
 * Skill Manager - Unified management of skill install, disable, enable, list
 */

import fs from 'fs/promises';
import path from 'path';
import { existsSync, mkdirSync, existsSync as fsExistsSync } from 'fs';
import { app } from 'electron';
import { getSkillsDir, getHubSkillsDir, getBuiltinSkillsDir, getCustomSkillsDir, SKILL_SUBDIRS } from './initStorage';
import { toAssetUrl } from '@/extensions/assetProtocol';
import { mainLog, mainWarn, mainError } from './utils/mainLogger';

const UPLOAD_SKILL_DEFAULT_ICON_FILE = 'upload_skill_default.svg';

const SKILL_HUB_META_FILE = '_sudowork_meta.json';
const VERSION_FILE_NAME = 'version.txt';
/** Legacy version file written by older install flows. Kept for backward compatibility reads. */
const LEGACY_VERSION_FILE_NAME = 'sudowork-version';

// Skill 分类
export type SkillCategory = 'custom' | 'hub' | 'system';

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
  source_type?: 'hub' | 'upload';
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
  private skillsDir: string;
  private hubDir: string;
  private systemDir: string;
  private customDir: string;

  constructor() {
    this.skillsDir = getSkillsDir();
    this.hubDir = getHubSkillsDir();
    this.systemDir = getBuiltinSkillsDir();
    this.customDir = getCustomSkillsDir();
    this.ensureDirs();
  }

  // 确保所有目录存在
  private ensureDirs(): void {
    const dirs = [this.skillsDir, this.hubDir, this.systemDir, this.customDir];
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
    const candidates = [
      path.join(appPath, 'resources', UPLOAD_SKILL_DEFAULT_ICON_FILE),
      path.join(appPath, '..', 'resources', UPLOAD_SKILL_DEFAULT_ICON_FILE),
      path.join(appPath, '..', '..', 'resources', UPLOAD_SKILL_DEFAULT_ICON_FILE),
    ];

    const existing = candidates.find((candidate) => fsExistsSync(candidate));
    return existing || candidates[0];
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

    try {
      const raw = await fs.readFile(path.join(skillDir, SKILL_HUB_META_FILE), 'utf-8');
      meta = JSON.parse(raw) as ISkillMeta;

      if (meta.is_builtin !== undefined) {
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
    } catch {
      // 没有 metadata 文件，默认为自定义
      meta = { source_type: 'upload' };
      isHubInstalled = false;
    }

    return {
      name: meta?.name?.trim() || dirName,
      version,
      isBuiltin,
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
    return 'custom';
  }

  // 获取所有已安装的技能列表
  async getInstalledSkills(): Promise<ISkillInfo[]> {
    const skills: ISkillInfo[] = [];

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
    // 搜索启用目录
    const searchDirs = [
      { dir: this.customDir, category: 'custom' as SkillCategory },
      { dir: this.hubDir, category: 'hub' as SkillCategory },
      { dir: this.systemDir, category: 'system' as SkillCategory },
      { dir: path.join(this.systemDir, '_builtin'), category: 'system' as SkillCategory },
    ];

    for (const { dir, category } of searchDirs) {
      const skillDir = path.join(dir, skillName);
      if (existsSync(skillDir)) {
        return { dir: skillDir, category, isDisabled: false };
      }
    }

    // 搜索禁用目录
    if (includeDisabled) {
      for (const { dir, category } of searchDirs) {
        const disableDir = this.getDisableDir(dir);
        const skillDir = path.join(disableDir, skillName);
        if (existsSync(skillDir)) {
          return { dir: skillDir, category, isDisabled: true };
        }
      }
    }

    return null;
  }

  // 禁用技能
  async disableSkill(skillName: string): Promise<{ success: boolean; msg?: string }> {
    try {
      const result = await this.findSkillDir(skillName);
      if (!result) {
        return { success: false, msg: 'Skill not found' };
      }

      const { dir: skillDir, category, isDisabled } = result;

      if (isDisabled) {
        return { success: false, msg: 'Skill is already disabled' };
      }

      // 检查是否为内置技能
      try {
        const raw = await fs.readFile(path.join(skillDir, SKILL_HUB_META_FILE), 'utf-8');
        const meta = JSON.parse(raw) as ISkillMeta;
        if (meta.is_builtin === true) {
          return { success: false, msg: '内置技能无法禁用' };
        }
      } catch {
        // 没有 metadata 文件，允许禁用
      }

      // 获取基础目录
      let baseDir: string;
      switch (category) {
        case 'system':
          baseDir = this.systemDir;
          break;
        case 'hub':
          baseDir = this.hubDir;
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
      const metaFilePath = path.join(destDir, SKILL_HUB_META_FILE);
      try {
        const raw = await fs.readFile(metaFilePath, 'utf-8');
        const meta = JSON.parse(raw) as ISkillMeta;
        meta.enabled = false;
        await fs.writeFile(metaFilePath, JSON.stringify(meta, null, 2), 'utf-8');
      } catch {
        // 没有 meta 文件，创建一个
        const newMeta = { enabled: false, source_type: 'upload' };
        await fs.writeFile(metaFilePath, JSON.stringify(newMeta, null, 2), 'utf-8');
      }

      mainLog('SkillManager', `Disabled skill: ${skillName}`);
      return { success: true };
    } catch (error) {
      mainError('SkillManager', 'Failed to disable skill:', error);
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  }

  // 启用技能
  async enableSkill(skillName: string): Promise<{ success: boolean; msg?: string }> {
    try {
      const result = await this.findSkillDir(skillName, true);
      if (!result) {
        return { success: false, msg: 'Skill not found' };
      }

      const { dir: skillDir, category, isDisabled } = result;

      if (!isDisabled) {
        return { success: false, msg: 'Skill is already enabled' };
      }

      // 获取基础目录
      let baseDir: string;
      switch (category) {
        case 'system':
          baseDir = this.systemDir;
          break;
        case 'hub':
          baseDir = this.hubDir;
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
      const metaFilePath = path.join(destDir, SKILL_HUB_META_FILE);
      try {
        const raw = await fs.readFile(metaFilePath, 'utf-8');
        const meta = JSON.parse(raw) as ISkillMeta;
        meta.enabled = true;
        await fs.writeFile(metaFilePath, JSON.stringify(meta, null, 2), 'utf-8');
      } catch {
        // 没有 meta 文件，创建一个
        const newMeta = { enabled: true, source_type: 'upload' };
        await fs.writeFile(metaFilePath, JSON.stringify(newMeta, null, 2), 'utf-8');
      }

      mainLog('SkillManager', `Enabled skill: ${skillName}`);
      return { success: true };
    } catch (error) {
      mainError('SkillManager', 'Failed to enable skill:', error);
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  }

  // 卸载技能
  async uninstallSkill(skillName: string): Promise<{ success: boolean; msg?: string }> {
    try {
      const result = await this.findSkillDir(skillName, true);
      if (!result) {
        return { success: false, msg: 'Skill not found' };
      }

      const { dir: skillDir, isDisabled } = result;

      // 检查是否为内置技能
      try {
        const raw = await fs.readFile(path.join(skillDir, SKILL_HUB_META_FILE), 'utf-8');
        const meta = JSON.parse(raw) as ISkillMeta;
        if (meta.is_builtin === true) {
          return { success: false, msg: '内置技能无法卸载' };
        }
      } catch {
        // 没有 meta 文件，允许卸载
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