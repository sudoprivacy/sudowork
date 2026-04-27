/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ACP Skill Manager - 为 ACP agents (Claude/OpenCode/Codex) 提供 skills 按需加载能力
 * 借鉴 aioncli-core 的 SkillManager 设计
 *
 * ACP Skill Manager - Provides on-demand skill loading for ACP agents (Claude/OpenCode/Codex)
 * Inspired by aioncli-core's SkillManager design
 */

import fs from 'fs/promises';
import { mainLog, mainWarn, mainError } from '@process/utils/mainLogger';
import path from 'path';
import { existsSync } from 'fs';
import { getSkillsDir, getBuiltinSkillsDir, getHubSkillsDir, getCustomSkillsDir, isUserSkillEnabled } from '../initStorage';
import { ExtensionRegistry } from '@/extensions';

/**
 * Skill 定义（与 aioncli-core 兼容）
 * Skill definition (compatible with aioncli-core)
 */
export interface SkillDefinition {
  /** 技能唯一名称 / Unique skill name */
  name: string;
  /** 技能描述（用于索引）/ Skill description (for indexing) */
  description: string;
  /** 文件路径 / File path */
  location: string;
  /** 完整内容（延迟加载）/ Full content (lazy loaded) */
  body?: string;
}

/**
 * Skill 索引（轻量级，用于首条消息注入）
 * Skill index (lightweight, for first message injection)
 */
export interface SkillIndex {
  name: string;
  description: string;
}

/**
 * 解析 SKILL.md 的 frontmatter
 * Parse frontmatter from SKILL.md
 */
function parseFrontmatter(content: string): { name?: string; description?: string } {
  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    return {};
  }

  const frontmatter = frontmatterMatch[1];
  const result: { name?: string; description?: string } = {};

  // 解析 name
  const nameMatch = frontmatter.match(/^name:\s*['"]?([^'"\n]+)['"]?\s*$/m);
  if (nameMatch) {
    result.name = nameMatch[1].trim();
  }

  // 解析 description（支持单引号、双引号、无引号）
  const descMatch = frontmatter.match(/^description:\s*['"]?(.+?)['"]?\s*$/m);
  if (descMatch) {
    result.description = descMatch[1].trim();
  }

  return result;
}

/**
 * 移除 frontmatter，只保留 body 内容
 * Remove frontmatter, keep only body content
 */
function extractBody(content: string): string {
  return content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '').trim();
}

/**
 * ACP Skill Manager
 * 为 ACP agents 提供 skills 的索引加载和按需获取能力
 *
 * 使用单例模式避免重复文件系统扫描
 * Uses singleton pattern to avoid repeated filesystem scans
 *
 * 支持两类 skills:
 * - 内置 skills (_builtin/): 所有场景自动注入
 * - 可选 skills: 通过 enabledSkills 参数控制
 */
export class AcpSkillManager {
  /**
   * Per-key instance cache.
   *
   * Previously a single mutable instance keyed by enabledSkills was kept; when
   * two concurrent conversations had different enabledSkills lists the second
   * caller's getInstance() would replace the first caller's manager mid-flight,
   * dropping any in-progress discoverSkills() work.  A Map keyed by the same
   * canonical cacheKey lets independent conversations coexist; resetInstance()
   * still clears everything (the `skill change → reset` workflow is preserved).
   */
  private static cache: Map<string, AcpSkillManager> = new Map();

  private skills: Map<string, SkillDefinition> = new Map();
  private builtinSkills: Map<string, SkillDefinition> = new Map();
  /** Hub-installed skills */
  private hubSkills: Map<string, SkillDefinition> = new Map();
  /** Custom uploaded skills */
  private customSkills: Map<string, SkillDefinition> = new Map();
  /** Extension-contributed skills loaded from ExtensionRegistry */
  private extensionSkills: Map<string, SkillDefinition> = new Map();
  private skillsDir: string;
  private builtinSkillsDir: string;
  private hubSkillsDir: string;
  private customSkillsDir: string;
  private initialized: boolean = false;
  private builtinInitialized: boolean = false;
  private extensionInitialized: boolean = false;

  constructor(skillsDir?: string) {
    this.skillsDir = skillsDir || getSkillsDir();
    this.builtinSkillsDir = getBuiltinSkillsDir();
    this.hubSkillsDir = getHubSkillsDir();
    this.customSkillsDir = getCustomSkillsDir();
  }

  /**
   * 获取单例实例（带 enabledSkills 缓存键）
   * Get singleton instance (with enabledSkills cache key)
   *
   * @param enabledSkills - 启用的 skills 列表，用作缓存键 / Enabled skills list, used as cache key
   * @returns AcpSkillManager 实例 / AcpSkillManager instance
   */
  static getInstance(enabledSkills?: string[]): AcpSkillManager {
    // Distinguish between undefined (non-preset → load all) and [] (preset with
    // no skills → load none).  An empty array must NOT map to 'all'.
    const cacheKey = enabledSkills ? (enabledSkills.length > 0 ? [...enabledSkills].sort().join(',') : '__none__') : 'all';

    let instance = AcpSkillManager.cache.get(cacheKey);
    if (!instance) {
      instance = new AcpSkillManager();
      AcpSkillManager.cache.set(cacheKey, instance);
    }
    return instance;
  }

  /**
   * 清空所有缓存的实例（用于测试或 skills 目录变更后强制重新发现）
   * Clear all cached instances (for tests or to force rediscovery after skills directory changes)
   */
  static resetInstance(): void {
    AcpSkillManager.cache.clear();
  }

  /**
   * 初始化：发现并加载内置 skills 的索引（所有场景自动注入）
   * Initialize: discover and load index of builtin skills (auto-injected for all scenarios)
   */
  async discoverBuiltinSkills(): Promise<void> {
    if (this.builtinInitialized) return;

    const builtinDir = this.builtinSkillsDir;
    if (!existsSync(builtinDir)) {
      mainLog('AcpSkillManager', `Builtin skills directory not found: ${builtinDir}`);
      this.builtinInitialized = true;
      return;
    }

    try {
      const entries = await fs.readdir(builtinDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const skillName = entry.name;
        const skillFile = path.join(builtinDir, skillName, 'SKILL.md');
        if (!existsSync(skillFile)) continue;

        try {
          const content = await fs.readFile(skillFile, 'utf-8');
          const { name, description } = parseFrontmatter(content);

          const skillDef: SkillDefinition = {
            name: name || skillName,
            description: description || `Builtin Skill: ${skillName}`,
            location: skillFile,
            // body 不在这里加载，按需获取
          };

          this.builtinSkills.set(skillName, skillDef);
        } catch (error) {
          mainWarn('AcpSkillManager', `Failed to load builtin skill ${skillName}:`, error);
        }
      }

      mainLog('AcpSkillManager', `Discovered ${this.builtinSkills.size} builtin skills`);
    } catch (error) {
      mainError('AcpSkillManager', `Failed to discover builtin skills:`, error);
    }

    this.builtinInitialized = true;
  }

  /**
   * 从 ExtensionRegistry 加载扩展贡献的 skills
   * Load extension-contributed skills from ExtensionRegistry
   *
   * 扩展 skills 通过 aion-extension.json 的 contributes.skills 声明，
   * 由 SkillResolver 解析后缓存在 ExtensionRegistry 中。
   * 这里将它们合并到 AcpSkillManager 中，使 agent 能够按需加载。
   */
  private async discoverExtensionSkills(enabledSkills?: string[]): Promise<void> {
    if (this.extensionInitialized) return;

    try {
      const registry = ExtensionRegistry.getInstance();
      const extSkills = registry.getSkills();

      if (extSkills.length === 0) {
        this.extensionInitialized = true;
        return;
      }

      for (const extSkill of extSkills) {
        // 如果指定了 enabledSkills，只加载被启用的扩展 skills
        // If enabledSkills is specified, only load enabled extension skills.
        // An empty array means "no skills" (preset assistant with none selected).
        if (enabledSkills && !enabledSkills.includes(extSkill.name)) {
          continue;
        }

        // 避免与内置/可选 skills 冲突 / Avoid conflicts with builtin/optional skills
        if (this.builtinSkills.has(extSkill.name) || this.skills.has(extSkill.name)) {
          mainWarn('AcpSkillManager', `Extension skill "${extSkill.name}" conflicts with existing skill, skipping`);
          continue;
        }

        const skillDef: SkillDefinition = {
          name: extSkill.name,
          description: extSkill.description,
          location: extSkill.location,
        };

        this.extensionSkills.set(extSkill.name, skillDef);
      }

      if (this.extensionSkills.size > 0) {
        mainLog('AcpSkillManager', `Loaded ${this.extensionSkills.size} extension skills`);
      }
    } catch (error) {
      mainWarn('AcpSkillManager', 'Failed to load extension skills:', error);
    }

    this.extensionInitialized = true;
  }

  /**
   * 初始化：发现并加载所有 skills 的索引（不加载 body）
   * Initialize: discover and load index of all skills (without body)
   */
  /**
   * Helper to discover skills from a specific directory
   */
  private async discoverSkillsFromDir(dir: string, targetMap: Map<string, SkillDefinition>, enabledSkills?: string[], skipDisabledCheck = false): Promise<void> {
    if (!existsSync(dir)) return;

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillName = entry.name;

        // An empty array means "no skills" (preset assistant with none selected).
        if (enabledSkills && !enabledSkills.includes(skillName)) {
          continue;
        }

        if (!skipDisabledCheck && !(await isUserSkillEnabled(skillName))) {
          continue;
        }

        const skillFile = path.join(dir, skillName, 'SKILL.md');
        if (!existsSync(skillFile)) continue;

        try {
          const content = await fs.readFile(skillFile, 'utf-8');
          const { name, description } = parseFrontmatter(content);

          const skillDef: SkillDefinition = {
            name: name || skillName,
            description: description || `Skill: ${skillName}`,
            location: skillFile,
          };

          targetMap.set(skillName, skillDef);
        } catch (error) {
          mainWarn('AcpSkillManager', `Failed to load skill ${skillName} from ${dir}:`, error);
        }
      }
    } catch (error) {
      mainError('AcpSkillManager', `Failed to discover skills from ${dir}:`, error);
    }
  }

  async discoverSkills(enabledSkills?: string[]): Promise<void> {
    // 始终先加载内置 skills / Always load builtin skills first
    await this.discoverBuiltinSkills();

    // 加载扩展贡献的 skills / Load extension-contributed skills
    await this.discoverExtensionSkills(enabledSkills);

    if (this.initialized) return;

    // When enabledSkills is undefined (non-preset agent), load ALL installed &
    // user-enabled workspace skills so that standalone agents like Claude Code
    // can also use skills such as "browser".
    // When enabledSkills is an explicit list (preset agent), only load those.

    const skillsDir = this.skillsDir;
    if (!existsSync(skillsDir)) {
      mainWarn('AcpSkillManager', `Skills directory not found: ${skillsDir}`);
      this.initialized = true;
      return;
    }

    // Discover skills from all three subdirectories
    // Priority: custom > hub > builtin (builtin already loaded above)
    await this.discoverSkillsFromDir(this.customSkillsDir, this.customSkills, enabledSkills);
    await this.discoverSkillsFromDir(this.hubSkillsDir, this.hubSkills, enabledSkills);

    // Merge custom and hub skills into the main skills map (custom takes priority)
    for (const [key, skill] of this.customSkills) {
      if (!this.skills.has(key)) {
        this.skills.set(key, skill);
      }
    }
    for (const [key, skill] of this.hubSkills) {
      if (!this.skills.has(key)) {
        this.skills.set(key, skill);
      }
    }

    // Legacy: also scan flat directories for backward compatibility
    try {
      const entries = await fs.readdir(skillsDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const skillName = entry.name;

        // Skip all `_` prefixed directories (new structure dirs)
        if (skillName.startsWith('_')) continue;

        // Skip if already found in subdirectories
        if (this.skills.has(skillName)) continue;

        // An empty array means "no skills" (preset assistant with none selected).
        if (enabledSkills && !enabledSkills.includes(skillName)) {
          continue;
        }

        if (!(await isUserSkillEnabled(skillName))) {
          continue;
        }

        const skillFile = path.join(skillsDir, skillName, 'SKILL.md');
        if (!existsSync(skillFile)) continue;

        try {
          const content = await fs.readFile(skillFile, 'utf-8');
          const { name, description } = parseFrontmatter(content);

          const skillDef: SkillDefinition = {
            name: name || skillName,
            description: description || `Skill: ${skillName}`,
            location: skillFile,
          };

          this.skills.set(skillName, skillDef);
        } catch (error) {
          mainWarn('AcpSkillManager', `Failed to load skill ${skillName}:`, error);
        }
      }
    } catch (error) {
      mainError('AcpSkillManager', `Failed to discover legacy skills:`, error);
    }

    mainLog('AcpSkillManager', `Discovered ${this.skills.size} optional skills (custom: ${this.customSkills.size}, hub: ${this.hubSkills.size})`);

    this.initialized = true;
  }

  /**
   * 获取所有 skills 的索引（轻量级）
   * 包含内置 skills + 可选 skills
   * Get index of all skills (lightweight)
   * Includes builtin skills + optional skills
   */
  getSkillsIndex(): SkillIndex[] {
    // 合并内置 skills、可选 skills 和扩展 skills
    // Merge builtin, optional, and extension skills
    const allSkills: SkillIndex[] = [];

    // 内置 skills 优先 / Builtin skills first
    for (const skill of this.builtinSkills.values()) {
      allSkills.push({
        name: skill.name,
        description: skill.description,
      });
    }

    // 然后是可选 skills / Then optional skills
    for (const skill of this.skills.values()) {
      allSkills.push({
        name: skill.name,
        description: skill.description,
      });
    }

    // 最后是扩展 skills / Then extension skills
    for (const skill of this.extensionSkills.values()) {
      allSkills.push({
        name: skill.name,
        description: skill.description,
      });
    }

    return allSkills;
  }

  /**
   * 获取内置 skills 的索引
   * Get index of builtin skills only
   */
  getBuiltinSkillsIndex(): SkillIndex[] {
    return Array.from(this.builtinSkills.values()).map((skill) => ({
      name: skill.name,
      description: skill.description,
    }));
  }

  /**
   * 检查是否有任何 skills（内置或可选）
   * Check if there are any skills (builtin or optional)
   */
  hasAnySkills(): boolean {
    return this.customSkills.size > 0 || this.hubSkills.size > 0 || this.builtinSkills.size > 0 || this.skills.size > 0 || this.extensionSkills.size > 0;
  }

  /**
   * 按名称获取单个 skill 的完整内容（按需加载）
   * 先查找内置 skills，再查找可选 skills
   * Get full content of a skill by name (on-demand loading)
   * Search builtin skills first, then optional skills
   */
  async getSkill(name: string): Promise<SkillDefinition | null> {
    // 按优先级查找：自定义 > Hub > 合并的 skills > 内置 > 扩展
    // Search by priority: custom > hub > merged skills > builtin > extension
    let skill = this.customSkills.get(name);
    if (!skill) {
      skill = this.hubSkills.get(name);
    }
    if (!skill) {
      skill = this.skills.get(name);
    }
    if (!skill) {
      skill = this.builtinSkills.get(name);
    }
    if (!skill) {
      skill = this.extensionSkills.get(name);
    }
    if (!skill) return null;

    // 如果 body 还没加载，现在加载
    if (skill.body === undefined) {
      try {
        const content = await fs.readFile(skill.location, 'utf-8');
        skill.body = extractBody(content);
      } catch (error) {
        mainWarn('AcpSkillManager', `Failed to load skill body for ${name}:`, error);
        skill.body = '';
      }
    }

    return skill;
  }

  /**
   * 获取多个 skills 的完整内容
   * Get full content of multiple skills
   */
  async getSkills(names: string[]): Promise<SkillDefinition[]> {
    const results: SkillDefinition[] = [];
    for (const name of names) {
      const skill = await this.getSkill(name);
      if (skill) {
        results.push(skill);
      }
    }
    return results;
  }

  /**
   * 检查 skill 是否存在（包括内置和可选）
   * Check if a skill exists (including builtin and optional)
   */
  hasSkill(name: string): boolean {
    return this.customSkills.has(name) || this.hubSkills.has(name) || this.builtinSkills.has(name) || this.skills.has(name) || this.extensionSkills.has(name);
  }

  /**
   * 清除缓存的 body 内容（用于刷新）
   * Clear cached body content (for refresh)
   */
  clearCache(): void {
    for (const skill of this.builtinSkills.values()) {
      skill.body = undefined;
    }
    for (const skill of this.customSkills.values()) {
      skill.body = undefined;
    }
    for (const skill of this.hubSkills.values()) {
      skill.body = undefined;
    }
    for (const skill of this.skills.values()) {
      skill.body = undefined;
    }
    for (const skill of this.extensionSkills.values()) {
      skill.body = undefined;
    }
  }
}

/**
 * 构建 skills 索引文本（用于首条消息注入）
 * Build skills index text (for first message injection)
 */
export function buildSkillsIndexText(skills: SkillIndex[]): string {
  if (skills.length === 0) return '';

  const lines = skills.map((s) => `- ${s.name}: ${s.description}`);

  return `[Available Skills]
The following skills are available. When you need detailed instructions for a specific skill,
you can request it by outputting: [LOAD_SKILL: skill-name]

${lines.join('\n')}`;
}

/**
 * 检测消息中是否请求加载 skill
 * Detect if message requests loading a skill
 */
export function detectSkillLoadRequest(content: string): string[] {
  const matches = content.matchAll(/\[LOAD_SKILL:\s*([^\]]+)\]/gi);
  const requested: string[] = [];
  for (const match of matches) {
    requested.push(match[1].trim());
  }
  return requested;
}

/**
 * 构建 skill 内容文本（用于注入）
 * Build skill content text (for injection)
 */
export function buildSkillContentText(skills: SkillDefinition[]): string {
  if (skills.length === 0) return '';

  return skills.map((s) => `[Skill: ${s.name}]\n${s.body}`).join('\n\n');
}
