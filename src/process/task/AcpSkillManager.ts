/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ACP Skill Manager — provides on-demand skill loading for ACP agents
 * (Claude / OpenCode / Codex / sudo-code).  Inspired by aioncli-core's
 * SkillManager design.
 */

import fs from 'fs/promises';
import { mainLog, mainWarn, mainError } from '@process/utils/mainLogger';
import path from 'path';
import { existsSync } from 'fs';
import { getSkillsDir, getBuiltinSkillsDir, getHubSkillsDir, getCustomSkillsDir, isUserSkillEnabled } from '../initStorage';
import { ExtensionRegistry } from '@/extensions';

/** Skill definition (shape compatible with aioncli-core). */
export interface SkillDefinition {
  /** Unique skill name. */
  name: string;
  /** Description used for the index injected into the agent prompt. */
  description: string;
  /** Filesystem location of the SKILL.md file. */
  location: string;
  /** Full skill body (lazily loaded — undefined until first read). */
  body?: string;
}

/** Lightweight index entry used when injecting skills into the first message. */
export interface SkillIndex {
  name: string;
  description: string;
}

/** Parse the YAML frontmatter from a SKILL.md (supports name + description). */
function parseFrontmatter(content: string): { name?: string; description?: string } {
  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    return {};
  }

  const frontmatter = frontmatterMatch[1];
  const result: { name?: string; description?: string } = {};

  const nameMatch = frontmatter.match(/^name:\s*['"]?([^'"\n]+)['"]?\s*$/m);
  if (nameMatch) {
    result.name = nameMatch[1].trim();
  }

  // Description supports single-quoted, double-quoted, or unquoted values.
  const descMatch = frontmatter.match(/^description:\s*['"]?(.+?)['"]?\s*$/m);
  if (descMatch) {
    result.description = descMatch[1].trim();
  }

  return result;
}

/** Strip the frontmatter and return only the SKILL.md body. */
function extractBody(content: string): string {
  return content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '').trim();
}

/**
 * Loads and caches skill indexes/bodies for ACP agents.
 *
 * Skill sources, in priority order:
 *   - builtin   (_system/_builtin/): auto-injected for every conversation
 *   - custom    (_custom/): user-uploaded; enabledSkills-gated
 *   - hub       (_hub/): hub-installed; enabledSkills-gated
 *   - extension (registered via aion-extension.json): enabledSkills-gated
 *   - legacy    (flat top-level layout, deprecated): enabledSkills-gated
 *
 * Filesystem scans are cached per enabledSkills key so that concurrent
 * conversations with different skill lists don't trigger repeated scans
 * (see the `cache` field doc for the concurrency rationale).
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
   * Get the manager instance for a given enabledSkills list.
   *
   * The list (or undefined) is canonicalised to a cache key; concurrent
   * conversations with different enabledSkills get independent managers
   * (see the `cache` field doc for why).
   *
   * @param enabledSkills - the conversation's enabledSkills (cache key)
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
   * Clear all cached instances. Used by tests and by skillHubBridge after
   * skills directory mutations (install / uninstall) to force rediscovery.
   */
  static resetInstance(): void {
    AcpSkillManager.cache.clear();
  }

  /**
   * Discover and load the index of builtin skills (auto-injected for every
   * conversation, regardless of enabledSkills).
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
            // body is loaded on demand via getSkill() — see lazy-load below.
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
   * Load extension-contributed skills from ExtensionRegistry.
   *
   * Extensions declare skills via aion-extension.json's `contributes.skills`;
   * SkillResolver parses and caches them in ExtensionRegistry.  This pass
   * merges them into the manager so agents can load them on demand.
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
        // If enabledSkills is provided, only load extension skills in that
        // list.  An empty array means "no skills" (preset assistant with
        // none selected) — distinct from undefined (no preset, load all).
        if (enabledSkills && !enabledSkills.includes(extSkill.name)) {
          continue;
        }

        // Avoid conflicts with builtin/optional skills.
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
   * Helper: scan a single skills directory and populate a target map.
   *
   * Filters (all opt-in):
   *  - enabledSkills:    if provided, only include skill names in this list
   *                      (an empty array means "no skills enabled")
   *  - skipDisabledCheck: bypass isUserSkillEnabled() — used for sources where
   *                      every directory entry is implicitly enabled (e.g.
   *                      hub/custom managed by the skills UI)
   *  - skipUnderscorePrefix: skip directory names starting with "_" — used by
   *                      the legacy-flat scan to avoid descending into the
   *                      structured _builtin/_hub/_custom subdirs
   *  - skipIfPresentIn:  skip skill names already loaded into this map — used
   *                      by the legacy-flat scan so it doesn't shadow newer
   *                      structured locations
   */
  private async discoverSkillsFromDir(
    dir: string,
    targetMap: Map<string, SkillDefinition>,
    enabledSkills?: string[],
    options: {
      skipDisabledCheck?: boolean;
      skipUnderscorePrefix?: boolean;
      skipIfPresentIn?: Map<string, SkillDefinition>;
    } = {}
  ): Promise<void> {
    if (!existsSync(dir)) return;

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillName = entry.name;

        if (options.skipUnderscorePrefix && skillName.startsWith('_')) continue;
        if (options.skipIfPresentIn && options.skipIfPresentIn.has(skillName)) continue;

        // An empty array means "no skills" (preset assistant with none selected).
        if (enabledSkills && !enabledSkills.includes(skillName)) continue;

        if (!options.skipDisabledCheck && !(await isUserSkillEnabled(skillName))) continue;

        const skillFile = path.join(dir, skillName, 'SKILL.md');
        if (!existsSync(skillFile)) continue;

        try {
          const content = await fs.readFile(skillFile, 'utf-8');
          const { name, description } = parseFrontmatter(content);

          targetMap.set(skillName, {
            name: name || skillName,
            description: description || `Skill: ${skillName}`,
            location: skillFile,
          });
        } catch (error) {
          mainWarn('AcpSkillManager', `Failed to load skill ${skillName} from ${dir}:`, error);
        }
      }
    } catch (error) {
      mainError('AcpSkillManager', `Failed to discover skills from ${dir}:`, error);
    }
  }

  /**
   * Discover and load the index of all optional skills (without body).
   *
   * Sources scanned, in priority order (first writer wins for `this.skills`):
   *   1. custom  (skillsDir/_custom/)
   *   2. hub     (skillsDir/_hub/)
   *   3. legacy  (skillsDir/<name>/, flat layout kept for backward compat)
   *
   * Builtin skills (skillsDir/_system/_builtin/) and extension skills live in
   * their own maps and are merged into the index by getSkillsIndex().
   */
  async discoverSkills(enabledSkills?: string[]): Promise<void> {
    // Always load builtin skills first.
    await this.discoverBuiltinSkills();

    // Load extension-contributed skills.
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

    // Priority order: custom > hub > legacy-flat.  Each scan populates its
    // dedicated map AND mirrors into this.skills using first-writer-wins so
    // the union map preserves priority for getSkillsIndex / hasSkill lookups.
    await this.discoverSkillsFromDir(this.customSkillsDir, this.customSkills, enabledSkills);
    for (const [key, skill] of this.customSkills) if (!this.skills.has(key)) this.skills.set(key, skill);

    await this.discoverSkillsFromDir(this.hubSkillsDir, this.hubSkills, enabledSkills);
    for (const [key, skill] of this.hubSkills) if (!this.skills.has(key)) this.skills.set(key, skill);

    // Legacy flat layout (deprecated): scan skillsDir directly for any
    // remaining top-level skill folders not in _custom/_hub/_builtin.  Pass
    // skipUnderscorePrefix to avoid re-entering the structured dirs and
    // skipIfPresentIn=this.skills so legacy entries don't shadow newer ones.
    await this.discoverSkillsFromDir(skillsDir, this.skills, enabledSkills, {
      skipUnderscorePrefix: true,
      skipIfPresentIn: this.skills,
    });

    mainLog('AcpSkillManager', `Discovered ${this.skills.size} optional skills (custom: ${this.customSkills.size}, hub: ${this.hubSkills.size})`);

    this.initialized = true;
  }

  /**
   * Get a lightweight index of every loaded skill (builtin + optional +
   * extension).  Used to inject the [Available Skills] block into the first
   * message.
   */
  getSkillsIndex(): SkillIndex[] {
    const allSkills: SkillIndex[] = [];

    // Builtin first, then optional (custom/hub/legacy union), then extension.
    for (const skill of this.builtinSkills.values()) {
      allSkills.push({ name: skill.name, description: skill.description });
    }
    for (const skill of this.skills.values()) {
      allSkills.push({ name: skill.name, description: skill.description });
    }
    for (const skill of this.extensionSkills.values()) {
      allSkills.push({ name: skill.name, description: skill.description });
    }

    return allSkills;
  }

  /** Get a lightweight index of builtin skills only. */
  getBuiltinSkillsIndex(): SkillIndex[] {
    return Array.from(this.builtinSkills.values()).map((skill) => ({
      name: skill.name,
      description: skill.description,
    }));
  }

  /** Check whether any skill (builtin, optional, or extension) is loaded. */
  hasAnySkills(): boolean {
    return this.customSkills.size > 0 || this.hubSkills.size > 0 || this.builtinSkills.size > 0 || this.skills.size > 0 || this.extensionSkills.size > 0;
  }

  /**
   * Get a single skill by name with full body loaded.
   * Search order (priority): custom > hub > merged skills > builtin > extension.
   * Body is read from disk on first access and cached on the SkillDefinition.
   */
  async getSkill(name: string): Promise<SkillDefinition | null> {
    const skill = this.customSkills.get(name) || this.hubSkills.get(name) || this.skills.get(name) || this.builtinSkills.get(name) || this.extensionSkills.get(name);
    if (!skill) return null;

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

  /** Get multiple skills with bodies loaded; missing names are silently dropped. */
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

  /** Check whether a skill exists across any source (builtin, optional, extension). */
  hasSkill(name: string): boolean {
    return this.customSkills.has(name) || this.hubSkills.has(name) || this.builtinSkills.has(name) || this.skills.has(name) || this.extensionSkills.has(name);
  }

  /** Drop cached body content across every source so the next getSkill() re-reads from disk. */
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

/** Build the [Available Skills] block injected into a first message. */
export function buildSkillsIndexText(skills: SkillIndex[]): string {
  if (skills.length === 0) return '';

  const lines = skills.map((s) => `- ${s.name}: ${s.description}`);

  return `[Available Skills]
The following skills are available. When you need detailed instructions for a specific skill,
you can request it by outputting: [LOAD_SKILL: skill-name]

${lines.join('\n')}`;
}

/** Extract any [LOAD_SKILL: <name>] requests emitted by the agent. */
export function detectSkillLoadRequest(content: string): string[] {
  const matches = content.matchAll(/\[LOAD_SKILL:\s*([^\]]+)\]/gi);
  const requested: string[] = [];
  for (const match of matches) {
    requested.push(match[1].trim());
  }
  return requested;
}

/** Build the [Skill: <name>] content blocks injected when a skill is loaded. */
export function buildSkillContentText(skills: SkillDefinition[]): string {
  if (skills.length === 0) return '';

  return skills.map((s) => `[Skill: ${s.name}]\n${s.body}`).join('\n\n');
}
