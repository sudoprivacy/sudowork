/**
 * Assistant Manager - Unified management of assistant preset install, disable, enable, list.
 * Parallel to SkillManager.ts for skills.
 *
 * _sudowork_meta.json is the SSOT. No ConfigStorage involved.
 * Enable/disable = flip meta.enabled field (no directory moves).
 */

import fs from 'fs/promises';
import path from 'path';
import { existsSync, mkdirSync } from 'fs';
import { getAssistantsDir } from './initStorage';
import { ASSISTANT_SUBDIRS, ASSISTANT_META_FILE } from './constants/assistantStorage';
import { mainLog, mainError } from './utils/mainLogger';
import type { IAssistantMeta } from './constants/assistantStorage';

export type AssistantCategory = 'custom' | 'hub' | 'system';

export interface IAssistantInfo {
  /** Directory name (used as lookup key) */
  name: string;
  isBuiltin: boolean;
  isHubInstalled: boolean;
  enabled: boolean;
  category: AssistantCategory;
  meta: IAssistantMeta;
}

/**
 * Assistant Manager class
 */
export class AssistantManager {
  private _hubDir?: string;
  private _systemDir?: string;
  private _customDir?: string;
  private _initialized = false;

  /** Lazy init — safe to construct before initStorage has run */
  private init(): void {
    if (this._initialized) return;
    const base = getAssistantsDir();
    this._hubDir = path.join(base, ASSISTANT_SUBDIRS.hub);
    this._systemDir = path.join(base, ASSISTANT_SUBDIRS.system);
    this._customDir = path.join(base, ASSISTANT_SUBDIRS.custom);
    this.ensureDirs();
    this._initialized = true;
  }

  private get hubDir(): string { this.init(); return this._hubDir!; }
  private get systemDir(): string { this.init(); return this._systemDir!; }
  private get customDir(): string { this.init(); return this._customDir!; }

  private ensureDirs(): void {
    for (const dir of [getAssistantsDir(), this._hubDir!, this._systemDir!, this._customDir!]) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }
  }

  /**
   * Scan non-`_` prefixed subdirectories in a base directory
   */
  private async scanAssistantDirs(baseDir: string): Promise<string[]> {
    const dirs: string[] = [];
    try {
      await fs.access(baseDir);
    } catch {
      return dirs;
    }

    const entries = await fs.readdir(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('_')) continue;
      dirs.push(path.join(baseDir, entry.name));
    }
    return dirs;
  }

  /**
   * Determine category from directory path
   */
  private getCategoryFromPath(assistantPath: string): AssistantCategory {
    if (assistantPath.startsWith(this.systemDir)) return 'system';
    if (assistantPath.startsWith(this.hubDir)) return 'hub';
    return 'custom';
  }

  /**
   * Read assistant info from a directory. Returns null if no valid meta found.
   */
  private async readAssistantInfo(assistantDir: string, category: AssistantCategory): Promise<IAssistantInfo | null> {
    const dirName = path.basename(assistantDir);

    try {
      const raw = await fs.readFile(path.join(assistantDir, ASSISTANT_META_FILE), 'utf-8');
      const meta = JSON.parse(raw) as IAssistantMeta;

      return {
        name: dirName,
        isBuiltin: meta.is_builtin === true,
        isHubInstalled: meta.source_type === 'hub',
        enabled: meta.enabled !== false,
        category,
        meta,
      };
    } catch {
      // No valid metadata — treat as custom with defaults
      return {
        name: dirName,
        isBuiltin: false,
        isHubInstalled: false,
        enabled: true,
        category,
        meta: { id: dirName, source_type: 'custom', enabled: true },
      };
    }
  }

  // ── Public API ──

  /**
   * Get all installed assistants (enabled + disabled).
   * Scans _system/, _hub/, _my-custom-assistant/ directories.
   */
  async getInstalledAssistants(): Promise<IAssistantInfo[]> {
    const assistants: IAssistantInfo[] = [];

    for (const baseDir of [this.systemDir, this.hubDir, this.customDir]) {
      const dirs = await this.scanAssistantDirs(baseDir);
      for (const assistantDir of dirs) {
        const category = this.getCategoryFromPath(assistantDir);
        const info = await this.readAssistantInfo(assistantDir, category);
        if (info) assistants.push(info);
      }
    }

    return assistants;
  }

  /**
   * Find an assistant directory by name (or id) across all categories.
   * Searches: custom → hub → system. Also tries stripping 'builtin-' prefix for system lookup.
   */
  findAssistantDir(name: string): { dir: string; category: AssistantCategory } | null {
    const searchDirs = [
      { dir: this.customDir, category: 'custom' as AssistantCategory },
      { dir: this.hubDir, category: 'hub' as AssistantCategory },
      { dir: this.systemDir, category: 'system' as AssistantCategory },
    ];

    for (const { dir, category } of searchDirs) {
      const assistantDir = path.join(dir, name);
      if (existsSync(assistantDir)) {
        return { dir: assistantDir, category };
      }
    }

    // Try stripping 'builtin-' prefix for system dir lookup
    if (name.startsWith('builtin-')) {
      const stripped = name.slice('builtin-'.length);
      const systemPath = path.join(this.systemDir, stripped);
      if (existsSync(systemPath)) {
        return { dir: systemPath, category: 'system' };
      }
    }

    return null;
  }

  /**
   * Read _sudowork_meta.json for a specific assistant.
   */
  async getAssistantMeta(name: string): Promise<IAssistantMeta | null> {
    const result = this.findAssistantDir(name);
    if (!result) return null;

    try {
      const raw = await fs.readFile(path.join(result.dir, ASSISTANT_META_FILE), 'utf-8');
      return JSON.parse(raw) as IAssistantMeta;
    } catch {
      return null;
    }
  }

  /**
   * Merge partial updates into an assistant's _sudowork_meta.json.
   */
  async updateAssistantMeta(name: string, updates: Partial<IAssistantMeta>): Promise<{ success: boolean; msg?: string }> {
    try {
      const result = this.findAssistantDir(name);
      if (!result) return { success: false, msg: 'Assistant not found' };

      const metaPath = path.join(result.dir, ASSISTANT_META_FILE);
      let meta: IAssistantMeta = {};
      try {
        meta = JSON.parse(await fs.readFile(metaPath, 'utf-8')) as IAssistantMeta;
      } catch {
        // Start fresh if corrupted
      }

      const merged = { ...meta, ...updates };
      await fs.writeFile(metaPath, JSON.stringify(merged, null, 2), 'utf-8');
      return { success: true };
    } catch (error) {
      mainError('AssistantManager', 'Failed to update assistant meta:', error);
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Enable an assistant (set meta.enabled = true).
   */
  async enableAssistant(name: string): Promise<{ success: boolean; msg?: string }> {
    mainLog('AssistantManager', `Enabling assistant: ${name}`);
    return this.updateAssistantMeta(name, { enabled: true });
  }

  /**
   * Disable an assistant (set meta.enabled = false).
   */
  async disableAssistant(name: string): Promise<{ success: boolean; msg?: string }> {
    mainLog('AssistantManager', `Disabling assistant: ${name}`);
    return this.updateAssistantMeta(name, { enabled: false });
  }

  /**
   * Update enabled skills for an assistant.
   */
  async setEnabledSkills(name: string, skills: string[]): Promise<{ success: boolean; msg?: string }> {
    return this.updateAssistantMeta(name, { enabledSkills: skills });
  }

  /**
   * Update preset agent type for an assistant.
   */
  async setPresetAgentType(name: string, agentType: string): Promise<{ success: boolean; msg?: string }> {
    return this.updateAssistantMeta(name, { presetAgentType: agentType });
  }

  /**
   * Create a new custom assistant in _my-custom-assistant/{id}/.
   * Writes _sudowork_meta.json and optionally AGENT.md.
   */
  async createAssistant(meta: IAssistantMeta, ruleContent?: string): Promise<{ success: boolean; msg?: string }> {
    try {
      const id = meta.id;
      if (!id) return { success: false, msg: 'Assistant id is required' };

      const assistantDir = path.join(this.customDir, id);
      if (existsSync(assistantDir)) {
        return { success: false, msg: `Assistant already exists: ${id}` };
      }

      await fs.mkdir(assistantDir, { recursive: true });

      // If ruleContent provided, write AGENT.md and set ruleFile
      let ruleFile: string | undefined = undefined;
      if (ruleContent) {
        await fs.writeFile(path.join(assistantDir, 'AGENT.md'), ruleContent, 'utf-8');
        ruleFile = 'AGENT.md';
      }

      const fullMeta: IAssistantMeta = {
        source_type: 'custom',
        enabled: true,
        ruleFile: ruleFile,
        ...meta,
      };
      await fs.writeFile(path.join(assistantDir, ASSISTANT_META_FILE), JSON.stringify(fullMeta, null, 2), 'utf-8');

      mainLog('AssistantManager', `Created assistant: ${id}`);
      return { success: true };
    } catch (error) {
      mainError('AssistantManager', 'Failed to create assistant:', error);
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Uninstall an assistant (delete directory; blocks builtins).
   */
  async uninstallAssistant(name: string): Promise<{ success: boolean; msg?: string }> {
    try {
      const result = this.findAssistantDir(name);
      if (!result) return { success: false, msg: 'Assistant not found' };

      // Block uninstalling builtins
      try {
        const raw = await fs.readFile(path.join(result.dir, ASSISTANT_META_FILE), 'utf-8');
        const meta = JSON.parse(raw) as IAssistantMeta;
        if (meta.is_builtin === true) {
          return { success: false, msg: 'Builtin assistants cannot be uninstalled' };
        }
      } catch {
        // No metadata file, allow uninstall
      }

      await fs.rm(result.dir, { recursive: true, force: true });
      mainLog('AssistantManager', `Uninstalled assistant: ${name}`);
      return { success: true };
    } catch (error) {
      mainError('AssistantManager', 'Failed to uninstall assistant:', error);
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  }
}

// Export singleton
export const assistantManager = new AssistantManager();
