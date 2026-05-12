/**
 * Assistant Manager - Unified management of assistant preset install, disable, enable, list.
 * Parallel to SkillManager.ts for skills.
 *
 * Metadata file: _moss_meta.json (enterprise) or _sudowork_meta.json (personal)
 * Enable/disable = flip meta.enabled field (no directory moves).
 */

import fs from 'fs/promises';
import path from 'path';
import { existsSync, mkdirSync } from 'fs';
import { getAssistantsDir, getHubAssistantsDir, getSystemAssistantsDir, getCustomAssistantsDir } from './initStorage';
import { ASSISTANT_META_FILE, MOSS_ASSISTANT_META_FILE } from './constants/assistantStorage';
import { mainLog, mainError } from './utils/mainLogger';
import type { IAssistantMeta } from './constants/assistantStorage';
import { isEnterpriseMode } from '@/common/enterpriseDebugConfig';

export type AssistantCategory = 'custom' | 'hub' | 'system';

export interface IAssistantInfo {
  /** Unique identifier from server */
  id?: string;
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
  // Use getters for dynamic directory resolution based on current mode
  private get hubDir(): string {
    return getHubAssistantsDir();
  }
  private get systemDir(): string {
    return getSystemAssistantsDir();
  }
  private get customDir(): string {
    return getCustomAssistantsDir();
  }

  private ensureDirs(): void {
    for (const dir of [getAssistantsDir(), this.hubDir, this.systemDir, this.customDir]) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }
  }

  /**
   * Read assistant metadata file, trying both Moss and Sudowork meta file names
   * Enterprise mode: _moss_meta.json (primary), _sudowork_meta.json (fallback)
   * Personal mode: _sudowork_meta.json (primary), _moss_meta.json (fallback)
   */
  private async readAssistantMetaFile(assistantDir: string): Promise<{ content: string; fileName: string } | null> {
    const isEnterprise = isEnterpriseMode();
    const metaFiles = isEnterprise ? [MOSS_ASSISTANT_META_FILE, ASSISTANT_META_FILE] : [ASSISTANT_META_FILE, MOSS_ASSISTANT_META_FILE];

    for (const fileName of metaFiles) {
      const filePath = path.join(assistantDir, fileName);
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
   * Write assistant metadata file, using correct file name based on current mode
   */
  private async writeAssistantMetaFile(assistantDir: string, meta: IAssistantMeta): Promise<void> {
    const isEnterprise = isEnterpriseMode();
    const fileName = isEnterprise ? MOSS_ASSISTANT_META_FILE : ASSISTANT_META_FILE;
    const filePath = path.join(assistantDir, fileName);
    await fs.writeFile(filePath, JSON.stringify(meta, null, 2), 'utf-8');
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

    const metaResult = await this.readAssistantMetaFile(assistantDir);
    if (metaResult) {
      const meta = JSON.parse(metaResult.content) as IAssistantMeta;

      return {
        id: meta.id,
        name: dirName,
        isBuiltin: meta.is_builtin === true,
        isHubInstalled: meta.source_type === 'hub',
        enabled: meta.enabled !== false,
        category,
        meta,
      };
    } else {
      // No valid metadata — treat as custom with defaults
      return {
        id: dirName,
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
   * Scans system/, hub/, custom/ directories (enterprise) or _system/, _hub/, _my-custom-assistant/ (personal).
   */
  async getInstalledAssistants(): Promise<IAssistantInfo[]> {
    this.ensureDirs();
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
   * Read metadata file for a specific assistant.
   */
  async getAssistantMeta(name: string): Promise<IAssistantMeta | null> {
    const result = this.findAssistantDir(name);
    if (!result) return null;

    const metaResult = await this.readAssistantMetaFile(result.dir);
    if (metaResult) {
      return JSON.parse(metaResult.content) as IAssistantMeta;
    }
    return null;
  }

  /**
   * Merge partial updates into an assistant's metadata file.
   */
  async updateAssistantMeta(name: string, updates: Partial<IAssistantMeta>): Promise<{ success: boolean; msg?: string }> {
    try {
      const result = this.findAssistantDir(name);
      if (!result) return { success: false, msg: 'Assistant not found' };

      let meta: IAssistantMeta = {};
      const metaResult = await this.readAssistantMetaFile(result.dir);
      if (metaResult) {
        meta = JSON.parse(metaResult.content) as IAssistantMeta;
      }

      const merged = { ...meta, ...updates };
      await this.writeAssistantMetaFile(result.dir, merged);
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
   * Create a new custom assistant in custom directory.
   * Writes metadata file and optionally AGENT.md.
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
      await this.writeAssistantMetaFile(assistantDir, fullMeta);

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
      const metaResult = await this.readAssistantMetaFile(result.dir);
      if (metaResult) {
        const meta = JSON.parse(metaResult.content) as IAssistantMeta;
        if (meta.is_builtin === true) {
          return { success: false, msg: 'Builtin assistants cannot be uninstalled' };
        }
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
