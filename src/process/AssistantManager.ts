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
import { isEnterpriseMode } from '@/common/enterpriseDebugConfig';
import { getAssistantsDir, getHubAssistantsDir, getSystemAssistantsDir, getCustomAssistantsDir, getSudoworkServerBaseUrlSync } from './initStorage';
import { ASSISTANT_META_FILE, MOSS_ASSISTANT_META_FILE } from './constants/assistantStorage';
import { mainLog, mainWarn, mainError } from './utils/mainLogger';
import type { IAssistantMeta } from './constants/assistantStorage';
import { getEnterpriseTenantAssistantsDir } from './constants/enterpriseStorage';

export type AssistantCategory = 'custom' | 'hub' | 'system' | 'tenant';

export interface IAssistantEnhancement {
  enabled: boolean;
  mode?: 'agent-chat' | 'workflow' | 'rag-only';
  /** Surfaced for debugging; client code should not call Dify directly with it. */
  difyAppId?: string;
}

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
  /**
   * Filled in when `getInstalledAssistantsWithVisibility(accessToken)` is
   * called. `undefined` means we haven't checked / can't check (offline);
   * `{enabled: false}` is the explicit "no enhancement" answer.
   */
  enhancement?: IAssistantEnhancement;
}

type AssistantPromptsI18n = Record<string, string[]>;

interface VisibleAssistantEntry {
  assistant_id: string;
  promptsI18n?: AssistantPromptsI18n;
  prompts_i18n?: AssistantPromptsI18n;
  enhancement?: {
    enabled?: boolean;
    mode?: 'agent-chat' | 'workflow' | 'rag-only';
    dify_app_id?: string;
  };
}

interface VisibleAssistantOverlay {
  enhancement: IAssistantEnhancement;
  promptsI18n?: AssistantPromptsI18n;
}

interface VisibleResponse {
  success: boolean;
  data?: VisibleAssistantEntry[];
  msg?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === 'string');
}

function normalizePromptsI18n(value: unknown): AssistantPromptsI18n | undefined {
  if (!isRecord(value)) return undefined;

  const zhCN = Array.from(new Set((stringArray(value['zh-CN']) || []).map((item) => item.trim()).filter(Boolean)));
  if (zhCN.length === 0) return undefined;

  return { 'zh-CN': zhCN };
}

function firstPromptsI18n(...values: unknown[]): AssistantPromptsI18n | undefined {
  for (const value of values) {
    const normalized = normalizePromptsI18n(value);
    if (normalized) return normalized;
  }
  return undefined;
}

function applyVisibleOverlay(item: IAssistantInfo, overlay: VisibleAssistantOverlay | undefined, fallbackEnhancement: IAssistantEnhancement): IAssistantInfo {
  const promptsI18n = overlay?.promptsI18n;
  return {
    ...item,
    meta: promptsI18n ? { ...item.meta, promptsI18n } : item.meta,
    enhancement: overlay?.enhancement ?? fallbackEnhancement,
  };
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
  private get tenantDir(): string {
    return getEnterpriseTenantAssistantsDir();
  }

  private ensureDirs(): void {
    const dirs = [getAssistantsDir(), this.hubDir, this.systemDir, this.customDir];
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
    if (isEnterpriseMode() && assistantPath.startsWith(this.tenantDir)) return 'tenant';
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
   * Scans system/, hub/, custom/, tenant/ directories (enterprise) or _system/, _hub/, _my-custom-assistant/ (personal).
   */
  async getInstalledAssistants(): Promise<IAssistantInfo[]> {
    this.ensureDirs();
    const assistants: IAssistantInfo[] = [];

    const baseDirs = [this.systemDir, this.hubDir, this.customDir];
    // Add tenant directory in enterprise mode
    if (isEnterpriseMode()) {
      baseDirs.push(this.tenantDir);
    }

    for (const baseDir of baseDirs) {
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
   * Variant of `getInstalledAssistants` that reconciles the local disk view
   * with sudowork-server's visibility/enhancement table.
   *
   * Behavior:
   *   - For `system` and `custom` assistants the server is bypassed; these
   *     are local-only artifacts and the server has no opinion.
   *   - For `hub` and `tenant` assistants we look up each entry by its meta
   *     `id`. Missing from the visible list = filtered out (admin revoked
   *     access). Present = annotated with the `enhancement` field.
   *   - On any server error we degrade to the unfiltered list with
   *     `enhancement` set to `{enabled: false}` — the user keeps working,
   *     they just don't get Dify augmentation until the server is back.
   *
   * Callers (renderer) pass their access token because the main process
   * doesn't cache it.
   */
  async getInstalledAssistantsWithVisibility(accessToken: string): Promise<IAssistantInfo[]> {
    const installed = await this.getInstalledAssistants();
    if (!accessToken) return installed;

    let visibleMap: Map<string, VisibleAssistantOverlay> | null = null;
    try {
      const resp = await fetch(`${getSudoworkServerBaseUrlSync()}/api/v1/agents/visible`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const body = (await resp.json()) as VisibleResponse;
      if (body.success && Array.isArray(body.data)) {
        visibleMap = new Map();
        for (const entry of body.data) {
          if (!entry.assistant_id) continue;
          const enh = entry.enhancement;
          visibleMap.set(entry.assistant_id, {
            enhancement: {
              enabled: !!enh?.enabled,
              mode: enh?.mode,
              difyAppId: enh?.dify_app_id,
            },
            promptsI18n: firstPromptsI18n(entry.promptsI18n, entry.prompts_i18n),
          });
        }
      }
    } catch (err) {
      mainWarn('AssistantManager', 'visible probe failed, degrading gracefully:', err);
    }

    if (!visibleMap) {
      // server unreachable: keep the list, mark enhancement undefined
      return installed.map((item): IAssistantInfo => ({ ...item, enhancement: undefined }));
    }

    const out: IAssistantInfo[] = [];
    for (const item of installed) {
      const needsAclGate = item.category === 'tenant';
      const assistantId = item.meta.id ?? item.id;
      const visibleOverlay = assistantId ? visibleMap.get(assistantId) : undefined;
      if (!needsAclGate) {
        out.push(applyVisibleOverlay(item, visibleOverlay, { enabled: false }));
        continue;
      }
      if (!assistantId) {
        // Old-format hub assistant without server id: keep visible (legacy compat)
        out.push({ ...item, enhancement: { enabled: false } });
        continue;
      }
      if (!visibleOverlay) {
        // not in visible list → admin revoked or assistant was deleted server-side
        mainLog('AssistantManager', `hiding hub assistant ${assistantId}: not in visible set`);
        continue;
      }
      out.push(applyVisibleOverlay(item, visibleOverlay, { enabled: false }));
    }
    return out;
  }

  /**
   * Find an assistant directory by name (or id) across all categories.
   * Searches: custom → tenant → hub → system. Also tries stripping 'builtin-' prefix for system lookup.
   */
  findAssistantDir(name: string): { dir: string; category: AssistantCategory } | null {
    const searchDirs: Array<{ dir: string; category: AssistantCategory }> = [
      { dir: this.customDir, category: 'custom' },
      { dir: this.hubDir, category: 'hub' },
      { dir: this.systemDir, category: 'system' },
    ];

    // Add tenant directory in enterprise mode
    if (isEnterpriseMode()) {
      searchDirs.splice(1, 0, { dir: this.tenantDir, category: 'tenant' }); // Insert after custom
    }

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
   * Find an assistant directory by name and category (precise lookup).
   * If category is specified, only searches in that category's directory.
   */
  findAssistantDirByCategory(name: string, category?: AssistantCategory): { dir: string; category: AssistantCategory } | null {
    // If category is specified, search only in that directory
    if (category) {
      const categoryDirMap: Record<AssistantCategory, string> = {
        custom: this.customDir,
        hub: this.hubDir,
        system: this.systemDir,
        tenant: this.tenantDir,
      };
      const baseDir = categoryDirMap[category];
      const assistantDir = path.join(baseDir, name);
      if (existsSync(assistantDir)) {
        return { dir: assistantDir, category };
      }
      // Try stripping 'builtin-' prefix for system dir lookup
      if (category === 'system' && name.startsWith('builtin-')) {
        const stripped = name.slice('builtin-'.length);
        const systemPath = path.join(this.systemDir, stripped);
        if (existsSync(systemPath)) {
          return { dir: systemPath, category: 'system' };
        }
      }
      return null;
    }
    // No category specified, use default search order
    return this.findAssistantDir(name);
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
   * Read an assistant's metadata together with its resolved on-disk directory.
   *
   * `getAssistantMeta` discards the directory `findAssistantDir` resolved, which
   * forces downstream code (e.g. presetRuntime) to fall back to the relative
   * `resourceDir` field in the meta JSON — that relative path is wrong once the
   * assistant is installed under hub/custom/system. Callers that need to locate
   * the assistant's `scripts/` or ops entry point on disk must use this method
   * and resolve paths against `dir`.
   */
  async getAssistantMetaWithDir(name: string): Promise<{ meta: IAssistantMeta; dir: string; category: AssistantCategory } | null> {
    const result = this.findAssistantDir(name);
    if (!result) return null;

    const metaResult = await this.readAssistantMetaFile(result.dir);
    if (!metaResult) return null;

    return {
      meta: JSON.parse(metaResult.content) as IAssistantMeta,
      dir: result.dir,
      category: result.category,
    };
  }

  /**
   * Merge partial updates into an assistant's metadata file.
   */
  async updateAssistantMeta(name: string, updates: Partial<IAssistantMeta>, category?: AssistantCategory): Promise<{ success: boolean; msg?: string }> {
    try {
      mainLog('AssistantManager', `updateAssistantMeta called: name=${name}, category=${category || 'auto'}`);
      const result = this.findAssistantDirByCategory(name, category);
      if (!result) {
        mainWarn('AssistantManager', `Assistant not found: ${name} (category: ${category || 'auto'})`);
        return { success: false, msg: 'Assistant not found' };
      }

      mainLog('AssistantManager', `Found assistant at: ${result.dir} (category: ${result.category})`);

      let meta: IAssistantMeta = {};
      const metaResult = await this.readAssistantMetaFile(result.dir);
      if (metaResult) {
        meta = JSON.parse(metaResult.content) as IAssistantMeta;
      }

      const merged = { ...meta, ...updates };
      await this.writeAssistantMetaFile(result.dir, merged);
      mainLog('AssistantManager', `Successfully updated meta for: ${name}`);
      return { success: true };
    } catch (error) {
      mainError('AssistantManager', 'Failed to update assistant meta:', error);
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Enable an assistant (set meta.enabled = true).
   */
  async enableAssistant(name: string, category?: AssistantCategory): Promise<{ success: boolean; msg?: string }> {
    mainLog('AssistantManager', `Enabling assistant: ${name} (category: ${category || 'auto'})`);
    return this.updateAssistantMeta(name, { enabled: true }, category);
  }

  /**
   * Disable an assistant (set meta.enabled = false).
   */
  async disableAssistant(name: string, category?: AssistantCategory): Promise<{ success: boolean; msg?: string }> {
    mainLog('AssistantManager', `Disabling assistant: ${name} (category: ${category || 'auto'})`);
    return this.updateAssistantMeta(name, { enabled: false }, category);
  }

  /**
   * Update enabled skills for an assistant.
   */
  async setEnabledSkills(name: string, skills: string[], category?: AssistantCategory): Promise<{ success: boolean; msg?: string }> {
    return this.updateAssistantMeta(name, { enabledSkills: skills }, category);
  }

  /**
   * Update preset agent type for an assistant.
   */
  async setPresetAgentType(name: string, agentType: string, category?: AssistantCategory): Promise<{ success: boolean; msg?: string }> {
    return this.updateAssistantMeta(name, { presetAgentType: agentType }, category);
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
        mainLog('AssistantManager', `Writing AGENT.md for assistant: ${id}, ruleContent length: ${ruleContent.length}`);
        await fs.writeFile(path.join(assistantDir, 'AGENT.md'), ruleContent, 'utf-8');
        ruleFile = 'AGENT.md';
        mainLog('AssistantManager', `AGENT.md written successfully for: ${id}`);
      } else {
        mainLog('AssistantManager', `No ruleContent provided for assistant: ${id}, skipping AGENT.md`);
      }

      const fullMeta: IAssistantMeta = {
        source_type: 'custom',
        enabled: true,
        ruleFile: ruleFile,
        ...meta,
      };
      await this.writeAssistantMetaFile(assistantDir, fullMeta);

      mainLog('AssistantManager', `Created assistant: ${id} at ${assistantDir}`);
      return { success: true };
    } catch (error) {
      mainError('AssistantManager', 'Failed to create assistant:', error);
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Uninstall an assistant (delete directory; blocks builtins).
   */
  async uninstallAssistant(name: string, category?: AssistantCategory): Promise<{ success: boolean; msg?: string }> {
    try {
      const result = this.findAssistantDirByCategory(name, category);
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
      mainLog('AssistantManager', `Uninstalled assistant: ${name} from ${result.category}`);

      return { success: true };
    } catch (error) {
      mainError('AssistantManager', 'Failed to uninstall assistant:', error);
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  }
}

// Export singleton
export const assistantManager = new AssistantManager();
