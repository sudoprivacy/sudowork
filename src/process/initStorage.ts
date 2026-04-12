/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdirSync as _mkdirSync, existsSync, readdirSync, readFileSync } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { app } from 'electron';
import { application } from '../common/ipcBridge';
import type { TMessage } from '@/common/chatLib';
import type { IAssistantMeta } from './constants/assistantStorage';
import type { IChatConversationRefer, IConfigStorageRefer, IEnvStorageRefer, IMcpServer } from '../common/storage';
import { ChatMessageStorage, ChatStorage, ConfigStorage, EnvStorage } from '../common/storage';
import { copyDirectoryRecursively, ensureDirectory, getConfigPath, getDataPath, getTempPath, verifyDirectoryFiles } from './utils';
import { getDatabase } from './database/export';
import { perfLog, mainLog, mainWarn, mainError } from './utils/mainLogger';
import { SKILL_SUBDIRS } from './constants/skillStorage';
import { ASSISTANT_SUBDIRS } from './constants/assistantStorage';
import { registerAssistantMetas } from '@/common/presets/presetResolver';
import { assistantManager } from './AssistantManager';
// Platform and architecture types (moved from deleted updateConfig)
type PlatformType = 'win32' | 'darwin' | 'linux';
type ArchitectureType = 'x64' | 'arm64' | 'ia32' | 'arm';

const nodePath = path;

const STORAGE_PATH = {
  config: 'sudowork-config.txt',
  chatMessage: 'sudowork-chat-message.txt',
  chat: 'sudowork-chat.txt',
  env: '.sudowork-env',
  assistants: 'assistants',
  skills: 'skills',
};

const getHomePage = getConfigPath;

const mkdirSync = (path: string) => {
  return _mkdirSync(path, { recursive: true });
};

const WriteFile = (path: string, data: string) => {
  return fs.writeFile(path, data);
};

const ReadFile = (path: string) => {
  return fs.readFile(path);
};

const RmFile = (path: string) => {
  return fs.rm(path, { recursive: true });
};

const CopyFile = (src: string, dest: string) => {
  return fs.copyFile(src, dest);
};

const FileBuilder = (file: string) => {
  const stack: (() => Promise<unknown>)[] = [];
  let isRunning = false;
  const run = () => {
    if (isRunning || !stack.length) return;
    isRunning = true;
    void stack
      .shift()?.()
      .finally(() => {
        isRunning = false;
        run();
      });
  };
  const pushStack = <R>(fn: () => Promise<R>) => {
    return new Promise<R>((resolve, reject) => {
      stack.push(() => fn().then(resolve).catch(reject));
      run();
    });
  };
  return {
    path: file,
    write(data: string) {
      return pushStack(() => WriteFile(file, data));
    },
    read() {
      return pushStack(() =>
        ReadFile(file).then((data) => {
          return data.toString();
        })
      );
    },
    copy(dist: string) {
      return pushStack(() => CopyFile(file, dist));
    },
    rm() {
      return pushStack(() => RmFile(file));
    },
  };
};

const JsonFileBuilder = <S extends object = Record<string, unknown>>(path: string) => {
  const file = FileBuilder(path);
  const encode = (data: unknown) => {
    return btoa(encodeURIComponent(String(data)));
  };

  const decode = (base64: string) => {
    return decodeURIComponent(atob(base64));
  };

  // In-memory cache: after first read, subsequent reads use cache instead of disk I/O.
  // This avoids repeated file reads during startup (configFile.get is called 8-10 times).
  let memoryCache: S | null = null;

  const toJson = async (): Promise<S> => {
    if (memoryCache) return { ...memoryCache };
    try {
      const result = await file.read();
      if (!result) return {} as S;

      // 验证文件内容不为空且不是损坏的base64
      if (result.trim() === '') {
        mainWarn('Storage', `Empty file detected: ${path}`);
        return {} as S;
      }

      const decoded = decode(result);
      if (!decoded || decoded.trim() === '') {
        mainWarn('Storage', `Empty or corrupted content after decode: ${path}`);
        return {} as S;
      }

      const parsed = JSON.parse(decoded) as S;

      // 额外验证：如果是聊天历史文件且解析结果为空对象，警告用户
      if (path.includes('chat.txt') && Object.keys(parsed).length === 0) {
        mainWarn('Storage', `Chat history file appears to be empty: ${path}`);
      }

      memoryCache = parsed;
      return { ...parsed };
    } catch (e) {
      // console.error(`[Storage] Error reading/parsing file ${path}:`, e);
      return {} as S;
    }
  };

  const setJson = async (data: S): Promise<S> => {
    try {
      memoryCache = { ...data };
      await file.write(encode(JSON.stringify(data)));
      return data;
    } catch (e) {
      memoryCache = null; // Invalidate cache on write failure
      return Promise.reject(e);
    }
  };

  const toJsonSync = (): S => {
    if (memoryCache) return { ...memoryCache };
    try {
      const parsed = JSON.parse(decode(readFileSync(path).toString())) as S;
      memoryCache = parsed;
      return { ...parsed };
    } catch (e) {
      return {} as S;
    }
  };

  return {
    toJson,
    setJson,
    toJsonSync,
    /** Invalidate the in-memory cache, forcing the next read to hit disk. */
    invalidateCache() {
      memoryCache = null;
    },
    async set<K extends keyof S>(key: K, value: Awaited<S>[K]): Promise<Awaited<S>[K]> {
      const data = await toJson();
      data[key] = value;
      await setJson(data);
      return value;
    },
    async get<K extends keyof S>(key: K): Promise<Awaited<S>[K]> {
      const data = await toJson();
      return data[key] as Awaited<S>[K];
    },
    async remove<K extends keyof S>(key: K) {
      const data = await toJson();
      delete data[key];
      return setJson(data);
    },
    clear() {
      memoryCache = null;
      return setJson({} as S);
    },
    getSync<K extends keyof S>(key: K): S[K] {
      const data = toJsonSync();
      return data[key];
    },
    update<K extends keyof S>(key: K, updateFn: (value: S[K], data: S) => Promise<S[K]>) {
      return toJson().then((data) => {
        return updateFn(data[key], data).then((value) => {
          data[key] = value;
          return setJson(data);
        });
      });
    },
    backup(fullName: string) {
      const dir = nodePath.dirname(fullName);
      if (!existsSync(dir)) {
        mkdirSync(dir);
      }
      memoryCache = null; // Invalidate cache since file is being moved
      return file.copy(fullName).then(() => file.rm());
    },
  };
};

const envFile = JsonFileBuilder<IEnvStorageRefer>(path.join(getHomePage(), STORAGE_PATH.env));

const dirConfig = envFile.getSync('nexus.dir');

const cacheDir = dirConfig?.cacheDir || getHomePage();
const dataDir = getDataPath(); // ~/.nexus

const configFile = JsonFileBuilder<IConfigStorageRefer>(path.join(cacheDir, STORAGE_PATH.config));
type ConversationHistoryData = Record<string, TMessage[]>;

const _chatMessageFile = JsonFileBuilder<ConversationHistoryData>(path.join(cacheDir, STORAGE_PATH.chatMessage));
const _chatFile = JsonFileBuilder<IChatConversationRefer>(path.join(cacheDir, STORAGE_PATH.chat));

// 创建带字段迁移的聊天历史代理
const chatFile = {
  ..._chatFile,
  async get<K extends keyof IChatConversationRefer>(key: K): Promise<IChatConversationRefer[K]> {
    return await _chatFile.get(key);
  },
  async set<K extends keyof IChatConversationRefer>(key: K, value: IChatConversationRefer[K]): Promise<IChatConversationRefer[K]> {
    return await _chatFile.set(key, value);
  },
};

const buildMessageListStorage = (conversation_id: string, dir: string) => {
  const fullName = path.join(dir, 'sudowork-chat-history', conversation_id + '.txt');
  if (!existsSync(fullName)) {
    mkdirSync(path.join(dir, 'sudowork-chat-history'));
  }
  return JsonFileBuilder<TMessage[]>(path.join(dir, 'sudowork-chat-history', conversation_id + '.txt'));
};

const conversationHistoryProxy = (options: typeof _chatMessageFile, dir: string) => {
  return {
    ...options,
    async set(key: string, data: TMessage[]) {
      const conversation_id = key;
      const storage = buildMessageListStorage(conversation_id, dir);
      return await storage.setJson(data);
    },
    async get(key: string): Promise<TMessage[]> {
      const conversation_id = key;
      const storage = buildMessageListStorage(conversation_id, dir);
      const data = await storage.toJson();
      if (Array.isArray(data)) return data;
      return [];
    },
    backup(conversation_id: string) {
      const storage = buildMessageListStorage(conversation_id, dir);
      return storage.backup(path.join(dir, 'sudowork-chat-history', 'backup', conversation_id + '_' + Date.now() + '.txt'));
    },
  };
};

const chatMessageFile = conversationHistoryProxy(_chatMessageFile, cacheDir);

/**
 * 获取助手规则目录路径
 * Get assistant rules directory path
 */
const getAssistantsDir = () => {
  return path.join(dataDir, 'assistants');
};

/**
 * 获取技能脚本目录路径
 * Get skills scripts directory path
 */
const getSkillsDir = () => {
  return path.join(dataDir, 'skills');
};

/**
 * 获取系统技能根目录路径（_system 子目录）
 * Get system skills root directory path (_system subdirectory)
 */
const getSystemSkillsDir = () => {
  return path.join(getSkillsDir(), SKILL_SUBDIRS.system);
};

/**
 * 获取内置技能目录路径（_system/_builtin 子目录）
 * Get builtin skills directory path (_system/_builtin subdirectory)
 * Skills in this directory are automatically injected for ALL agents and scenarios
 */
const getBuiltinSkillsDir = () => {
  return path.join(getSystemSkillsDir(), SKILL_SUBDIRS.legacyBuiltin);
};

/**
 * 获取 Hub 安装技能目录路径
 * Get hub-installed skills directory path
 */
const getHubSkillsDir = () => {
  return path.join(getSkillsDir(), SKILL_SUBDIRS.hub);
};

/**
 * 获取自定义上传技能目录路径
 * Get custom uploaded skills directory path
 */
const getCustomSkillsDir = () => {
  return path.join(getSkillsDir(), SKILL_SUBDIRS.custom);
};

/**
 * Get hub-installed assistants directory path
 */
const getAssistantsHubDir = () => {
  return path.join(getAssistantsDir(), ASSISTANT_SUBDIRS.hub);
};

/**
 * Get system assistants root directory path (_system subdirectory)
 */
const getAssistantsSystemDir = () => {
  return path.join(getAssistantsDir(), ASSISTANT_SUBDIRS.system);
};

/**
 * Get custom assistants directory path
 */
const getAssistantsCustomDir = () => {
  return path.join(getAssistantsDir(), ASSISTANT_SUBDIRS.custom);
};

/**
 * 启动时异步迁移旧目录结构到新的分目录结构
 * Migrate legacy flat skill directory structure to categorized subdirectories on startup
 *
 * Migration logic:
 * 1. Scan ~/.nexus/skills for non-`_` prefixed directories (legacy skills)
 * 2. Read _sudowork_meta.json from each directory
 * 3. Move to appropriate subdirectory based on source_type / is_builtin
 * 4. Move _builtin/ contents to _system/ if _builtin/ still exists
 */
const migrateSkillsToSubdirectories = async (): Promise<void> => {
  const skillsDir = getSkillsDir();
  if (!existsSync(skillsDir)) {
    return;
  }

  mainLog('SkillMigration', 'Starting skill subdirectory migration...');

  const hubDir = getHubSkillsDir();
  const systemDir = getSystemSkillsDir();
  const builtinDir = getBuiltinSkillsDir();
  const customDir = getCustomSkillsDir();

  // Ensure target directories exist
  for (const dir of [hubDir, systemDir, builtinDir, customDir]) {
    if (!existsSync(dir)) {
      mkdirSync(dir);
    }
  }

  try {
    // 1. Migrate legacy root-level _builtin/ contents to _system/_builtin/
    const legacyBuiltinDir = path.join(skillsDir, SKILL_SUBDIRS.legacyBuiltin);
    if (existsSync(legacyBuiltinDir)) {
      try {
        const builtinEntries = readdirSync(legacyBuiltinDir, { withFileTypes: true });
        for (const entry of builtinEntries) {
          if (!entry.isDirectory()) continue;
          const src = path.join(legacyBuiltinDir, entry.name);
          const dest = path.join(builtinDir, entry.name);
          try {
            if (existsSync(dest)) {
              await fs.rm(dest, { recursive: true, force: true });
            }
            await fs.rename(src, dest);
            mainLog('SkillMigration', `Moved builtin skill "${entry.name}" from _builtin to _system/_builtin`);
          } catch (error) {
            mainWarn('SkillMigration', `Failed to move builtin skill "${entry.name}":`, error);
          }
        }
        // Remove empty _builtin directory
        await fs.rm(legacyBuiltinDir, { recursive: true, force: true }).catch(() => {});
      } catch (error) {
        mainWarn('SkillMigration', 'Failed to process legacy _builtin directory:', error);
      }
    }

    // 2. Scan for non-`_` prefixed directories (legacy flat skills)
    const entries = readdirSync(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      // Skip all `_` prefixed directories (new structure or legacy _builtin)
      if (entry.name.startsWith('_')) continue;

      const skillDir = path.join(skillsDir, entry.name);
      const metaFilePath = path.join(skillDir, '_sudowork_meta.json');

      let targetParentDir = customDir; // Default: treat as custom if no metadata

      try {
        const raw = await fs.readFile(metaFilePath, 'utf-8');
        const meta = JSON.parse(raw) as { source_type?: string; is_builtin?: boolean };

        if (meta.is_builtin === true) {
          targetParentDir = systemDir;
        } else if (meta.source_type === 'hub') {
          targetParentDir = hubDir;
        } else if (meta.source_type === 'upload') {
          targetParentDir = customDir;
        }
      } catch {
        // No metadata file - check if there's a SKILL.md (custom skill without meta)
        if (!existsSync(path.join(skillDir, 'SKILL.md'))) {
          continue; // Skip directories without SKILL.md
        }
        targetParentDir = customDir;
      }

      const dest = path.join(targetParentDir, entry.name);
      try {
        if (existsSync(dest)) {
          await fs.rm(dest, { recursive: true, force: true });
        }
        await fs.rename(skillDir, dest);
        mainLog('SkillMigration', `Migrated skill "${entry.name}" to ${path.basename(targetParentDir)}/`);
      } catch (error) {
        mainWarn('SkillMigration', `Failed to migrate skill "${entry.name}":`, error);
      }
    }

    mainLog('SkillMigration', 'Skill subdirectory migration completed');
  } catch (error) {
    mainError('SkillMigration', 'Skill subdirectory migration failed:', error);
  }
};

/** User-controlled fields in _sudowork_meta.json that survive version upgrades */
const USER_PRESERVED_META_FIELDS: (keyof IAssistantMeta)[] = ['enabled', 'enabledSkills', 'presetAgentType'];

/**
 * Resolve a bundled resource directory path for both dev and production.
 * In production, resources are in asarUnpack at app.asar.unpacked/.
 */
const resolveBuiltinDir = (dirPath: string): string => {
  const appPath = app.getAppPath();
  let candidates: string[];
  if (app.isPackaged) {
    const unpackedPath = appPath.replace('app.asar', 'app.asar.unpacked');
    candidates = [
      path.join(unpackedPath, dirPath),
      path.join(appPath, dirPath),
    ];
  } else {
    candidates = [path.join(appPath, dirPath), path.join(appPath, '..', dirPath), path.join(appPath, '..', '..', dirPath), path.join(appPath, '..', '..', '..', dirPath), path.join(process.cwd(), dirPath)];
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  mainWarn('Sudowork', `Could not find builtin ${dirPath} directory, tried:`, candidates);
  return candidates[0];
};

/**
 * Initialize builtin assistant and skill files to user directory.
 * Directory-driven: scans bundled assistant/ for _sudowork_meta.json files.
 *
 * - Builtin assistants (is_builtin: true) → _system/{id}/
 *   Overwritten on version change, but user fields (enabled, enabledSkills, presetAgentType) are preserved.
 * - Non-builtin bundled assistants → _my-custom-assistant/{id}/
 *   Only installed if not already present (user customizations preserved).
 */
const initBuiltinAssistantRules = async (): Promise<void> => {
  const assistantsDir = getAssistantsDir();
  const skillsDir = getSkillsDir();

  const currentVersion = app.getVersion();
  const lastCopiedVersion = await configFile.get('system.lastBuiltinResourcesVersion').catch(() => '');

  const skillsDirExists = existsSync(skillsDir);
  const assistantsDirExists = existsSync(assistantsDir);

  // Scan bundled assistant/ directory for subdirs with _sudowork_meta.json
  const bundledAssistantDir = resolveBuiltinDir('assistant');
  const bundledEntries = existsSync(bundledAssistantDir)
    ? readdirSync(bundledAssistantDir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('_'))
    : [];

  // Check if all builtin assistants have their AGENT.md installed
  const builtinAssistantsDir = getAssistantsSystemDir();
  const hasAllAssistantRules = assistantsDirExists && bundledEntries.every((entry) => {
    const metaPath = path.join(bundledAssistantDir, entry.name, '_sudowork_meta.json');
    if (!existsSync(metaPath)) return true; // No meta = skip
    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8')) as IAssistantMeta;
      if (!meta.is_builtin) return true; // Non-builtin checked separately
      const id = meta.id || entry.name;
      return existsSync(path.join(builtinAssistantsDir, id, 'AGENT.md'));
    } catch {
      return true;
    }
  });

  const needsCopy = lastCopiedVersion !== currentVersion || !skillsDirExists || !assistantsDirExists || !hasAllAssistantRules;

  if (!needsCopy) {
    mainLog('Sudowork', `Builtin resources already up-to-date (v${currentVersion}), skipping copy`);
    return;
  }

  mainLog('Sudowork', `Copying builtin resources (v${lastCopiedVersion || 'none'} -> v${currentVersion})...`);

  const builtinSkillsDir = resolveBuiltinDir('skills');
  const userSkillsDir = getSkillsDir();

  // Copy bundled skills directory to user config directory's _system subdirectory
  if (existsSync(builtinSkillsDir)) {
    try {
      if (!existsSync(userSkillsDir)) {
        mkdirSync(userSkillsDir);
      }
      const userSystemSkillsDir = getSystemSkillsDir();
      if (!existsSync(userSystemSkillsDir)) {
        mkdirSync(userSystemSkillsDir);
      }
      await copyDirectoryRecursively(builtinSkillsDir, userSystemSkillsDir, { overwrite: true });
    } catch (error) {
      mainWarn('Sudowork', `Failed to copy skills directory:`, error);
    }
  }

  // Ensure assistant directory structure exists
  for (const dir of [assistantsDir, getAssistantsSystemDir(), getAssistantsHubDir(), getAssistantsCustomDir()]) {
    if (!existsSync(dir)) {
      mkdirSync(dir);
    }
  }

  // Process all bundled assistants in parallel
  await Promise.all(
    bundledEntries.map(async (entry) => {
      const srcDir = path.join(bundledAssistantDir, entry.name);
      const metaPath = path.join(srcDir, '_sudowork_meta.json');

      // Must have _sudowork_meta.json
      if (!existsSync(metaPath)) return;

      let bundledMeta: IAssistantMeta;
      try {
        bundledMeta = JSON.parse(await fs.readFile(metaPath, 'utf-8')) as IAssistantMeta;
      } catch (error) {
        mainWarn('Sudowork', `Failed to read bundled meta for ${entry.name}:`, error);
        return;
      }

      const isBuiltin = bundledMeta.is_builtin === true;
      const id = bundledMeta.id || entry.name;

      if (isBuiltin) {
        // ── Builtin → _system/{id}/ ──
        const destDir = path.join(getAssistantsSystemDir(), id);
        if (!existsSync(destDir)) {
          mkdirSync(destDir);
        }

        // Read existing meta to preserve user fields
        const existingMetaPath = path.join(destDir, '_sudowork_meta.json');
        let userOverrides: Partial<IAssistantMeta> = {};
        if (existsSync(existingMetaPath)) {
          try {
            const existingMeta = JSON.parse(await fs.readFile(existingMetaPath, 'utf-8')) as IAssistantMeta;
            for (const field of USER_PRESERVED_META_FIELDS) {
              if (existingMeta[field] !== undefined) {
                (userOverrides as Record<string, unknown>)[field] = existingMeta[field];
              }
            }
          } catch {
            // Corrupted existing meta, overwrite fully
          }
        }

        // Write merged meta: bundled values + preserved user fields
        const mergedMeta: IAssistantMeta = {
          ...bundledMeta,
          ...userOverrides,
          installed_at: new Date().toISOString(),
          installed_version: currentVersion,
        };
        await fs.writeFile(existingMetaPath, JSON.stringify(mergedMeta, null, 2), 'utf-8');

        // Resolve resourceDir for rule/skill file sources
        const resourceDir = bundledMeta.resourceDir ? resolveBuiltinDir(bundledMeta.resourceDir) : srcDir;

        // Copy ruleFile → AGENT.md
        if (bundledMeta.ruleFile) {
          const sourceRulesPath = path.join(resourceDir, bundledMeta.ruleFile);
          if (existsSync(sourceRulesPath)) {
            try {
              let content = await fs.readFile(sourceRulesPath, 'utf-8');
              content = content.replace(/skills\//g, userSkillsDir + '/');
              await fs.writeFile(path.join(destDir, 'AGENT.md'), content, 'utf-8');
            } catch (error) {
              mainWarn('Sudowork', `Failed to copy rule file for ${id}:`, error);
            }
          } else {
            mainWarn('Sudowork', `Source rule file not found: ${sourceRulesPath}`);
          }
        }

        // Copy skillFile → SKILLS.md
        if (bundledMeta.skillFile) {
          const sourceSkillsPath = path.join(resourceDir, bundledMeta.skillFile);
          if (existsSync(sourceSkillsPath)) {
            try {
              let content = await fs.readFile(sourceSkillsPath, 'utf-8');
              content = content.replace(/skills\//g, userSkillsDir + '/');
              await fs.writeFile(path.join(destDir, 'SKILLS.md'), content, 'utf-8');
            } catch (error) {
              mainWarn('Sudowork', `Failed to copy skill file for ${id}:`, error);
            }
          }
        }
      } else {
        // ── Non-builtin: route by source_type ──
        const isHub = bundledMeta.source_type === 'hub';
        const targetParentDir = isHub ? getAssistantsHubDir() : getAssistantsCustomDir();
        const destDir = path.join(targetParentDir, entry.name);

        // Skip if already installed — don't overwrite user customizations
        if (existsSync(destDir)) return;

        try {
          mkdirSync(destDir);

          // Copy _sudowork_meta.json
          await fs.copyFile(metaPath, path.join(destDir, '_sudowork_meta.json'));

          // Copy ruleFile → AGENT.md
          if (bundledMeta.ruleFile && existsSync(path.join(srcDir, bundledMeta.ruleFile))) {
            let content = await fs.readFile(path.join(srcDir, bundledMeta.ruleFile), 'utf-8');
            content = content.replace(/skills\//g, userSkillsDir + '/');
            await fs.writeFile(path.join(destDir, 'AGENT.md'), content, 'utf-8');
          }

          // Copy skillFile → SKILLS.md
          if (bundledMeta.skillFile && existsSync(path.join(srcDir, bundledMeta.skillFile))) {
            let content = await fs.readFile(path.join(srcDir, bundledMeta.skillFile), 'utf-8');
            content = content.replace(/skills\//g, userSkillsDir + '/');
            await fs.writeFile(path.join(destDir, 'SKILLS.md'), content, 'utf-8');
          }

          mainLog('Sudowork', `Installed bundled ${isHub ? 'hub' : 'custom'} assistant: ${entry.name}`);
        } catch (error) {
          mainWarn('Sudowork', `Failed to install bundled assistant ${entry.name}:`, error);
        }
      }
    })
  );

  // Save current version to skip copy on next startup
  await configFile.set('system.lastBuiltinResourcesVersion', currentVersion);
  mainLog('Sudowork', `Builtin resources copied successfully (v${currentVersion})`);
};

/**
 * 创建默认的 MCP 服务器配置
 */
const getDefaultMcpServers = (): IMcpServer[] => {
  const now = Date.now();
  const defaultConfig = {
    mcpServers: {
      'chrome-devtools': {
        command: 'npx',
        args: ['-y', 'chrome-devtools-mcp@latest'],
      },
    },
  };

  return Object.entries(defaultConfig.mcpServers).map(([name, config], index) => ({
    id: `mcp_default_${now}_${index}`,
    name,
    description: `Default MCP server: ${name}`,
    enabled: false, // 默认不启用，让用户手动开启
    transport: {
      type: 'stdio' as const,
      command: config.command,
      args: config.args,
    },
    createdAt: now,
    updatedAt: now,
    originalJson: JSON.stringify({ [name]: config }, null, 2),
  }));
};

/**
 * 启动时清理异常遗留的健康检测临时会话
 * Cleanup orphaned health-check temporary conversations on startup
 */
const cleanupOrphanedHealthCheckConversations = () => {
  try {
    const db = getDatabase();
    const pageSize = 1000;
    const idsToDelete: string[] = [];
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const result = db.getUserConversations(undefined, page, pageSize);
      result.data.forEach((conversation) => {
        const extra = conversation.extra as { isHealthCheck?: boolean } | undefined;
        if (extra?.isHealthCheck === true) {
          idsToDelete.push(conversation.id);
        }
      });
      hasMore = result.hasMore;
      page += 1;
    }

    let deletedCount = 0;
    idsToDelete.forEach((id) => {
      const deleted = db.deleteConversation(id);
      if (deleted.success && deleted.data) {
        deletedCount += 1;
      }
    });

    if (deletedCount > 0) {
      mainLog('Sudowork', `Cleaned up ${deletedCount} orphaned health-check conversation(s) on startup`);
    }
  } catch (error) {
    mainWarn('Sudowork', 'Failed to cleanup orphaned health-check conversations:', error);
  }
};

const initStorage = async () => {
  mainLog('Sudowork', 'Starting storage initialization...');
  const startTime = Date.now();

  // 2. 创建必要的目录（迁移后再创建，确保迁移能正常进行）
  // Use ensureDirectory to handle cases where a regular file blocks the path (#841)
  ensureDirectory(getHomePage());
  ensureDirectory(getDataPath());

  // 3. 初始化存储系统
  ConfigStorage.interceptor(configFile);
  ChatStorage.interceptor(chatFile);
  ChatMessageStorage.interceptor(chatMessageFile);
  EnvStorage.interceptor(envFile);

  // 4. 初始化 MCP 配置（为所有用户提供默认配置）
  try {
    const existingMcpConfig = await configFile.get('mcp.config').catch((): undefined => undefined);

    // 仅当配置不存在或为空时，写入默认值（适用于新用户和老用户）
    if (!existingMcpConfig || !Array.isArray(existingMcpConfig) || existingMcpConfig.length === 0) {
      const defaultServers = getDefaultMcpServers();
      await configFile.set('mcp.config', defaultServers);
      mainLog('Sudowork', 'Default MCP servers initialized');
    }
  } catch (error) {
    mainError('Sudowork', 'Failed to initialize default MCP servers:', error);
  }

  // 4.5 异步迁移旧技能目录结构到分目录结构
  // Async migrate legacy skill directory structure to categorized subdirectories
  await migrateSkillsToSubdirectories();

  // 4.6 初始化 mcporter（后台执行，不阻塞启动）
  void (async () => {
    try {
      const mcpConfig = await configFile.get('mcp.config').catch((): undefined => undefined);
      if (mcpConfig && Array.isArray(mcpConfig) && mcpConfig.length > 0) {
        // 动态导入避免循环依赖
        const { mcporterService } = await import('./services/mcporter');
        await mcporterService.initialize(mcpConfig);
        mainLog('Sudowork', 'mcporter initialized');
      }
    } catch (error) {
      // mcporter 初始化失败不影响应用启动
      mainWarn('Sudowork', 'Failed to initialize mcporter (non-critical):', error);
    }
  })();

  // 5. 初始化内置助手（Assistants）— runs in parallel with database init (step 6)
  // Filesystem-only: scans bundled assistant/ dirs, installs to ~/.nexus/assistants/
  // No acp.customAgents in ConfigStorage — _sudowork_meta.json is the SSOT
  const assistantsPromise = (async () => {
    try {
      await initBuiltinAssistantRules();

      // Populate the preset resolver registry so synchronous lookups work
      const installed = await assistantManager.getInstalledAssistants();
      const metas = installed.map((a) => a.meta).filter((m): m is IAssistantMeta => !!m);
      registerAssistantMetas(metas);
    } catch (error) {
      mainError('Sudowork', 'Failed to initialize builtin assistants:', error);
    }
  })();

  // 6. 初始化数据库（better-sqlite3）— runs in parallel with step 5
  const dbPromise = (async () => {
    const dbStart = Date.now();
    try {
      getDatabase();
      cleanupOrphanedHealthCheckConversations();
    } catch (error) {
      mainError('InitStorage', 'Database initialization failed, falling back to file-based storage:', error);
    }
    perfLog('initStorage.database', Date.now() - dbStart);
  })();

  // Wait for both assistant config and database init to complete
  await Promise.all([assistantsPromise, dbPromise]);

  perfLog('initStorage.total', Date.now() - startTime);

  application.systemInfo.provider(() => {
    return Promise.resolve(getSystemDir());
  });
};

export const ProcessConfig = configFile;

export const ProcessChat = chatFile;

export const ProcessChatMessage = chatMessageFile;

export const ProcessEnv = envFile;

export const getSystemDir = () => {
  return {
    cacheDir: cacheDir,
    // getDataPath() returns CLI-safe path (symlink on macOS) to avoid spaces
    // getDataPath() 返回 CLI 安全路径（macOS 上的符号链接）以避免空格问题
    workDir: dirConfig?.workDir || getDataPath(),
    platform: process.platform as PlatformType,
    arch: process.arch as ArchitectureType,
  };
};

/**
 * 获取助手规则目录路径（供其他模块使用）
 * Get assistant rules directory path (for use by other modules)
 */
export { getAssistantsDir, getAssistantsHubDir, getAssistantsSystemDir, getAssistantsCustomDir, getSkillsDir, getSystemSkillsDir, getBuiltinSkillsDir, getHubSkillsDir, getCustomSkillsDir, SKILL_SUBDIRS, ASSISTANT_SUBDIRS };

/**
 * Skills 内容缓存，避免重复从文件系统读取
 * Skills content cache to avoid repeated file system reads
 */
const skillsContentCache = new Map<string, string>();
const SKILL_HUB_META_FILE = '_sudowork_meta.json';

export async function isUserSkillEnabled(skillName: string): Promise<boolean> {
  // Search in all subdirectories for the skill metadata
  const subdirs = [SKILL_SUBDIRS.custom, SKILL_SUBDIRS.hub, SKILL_SUBDIRS.system];
  for (const subdir of subdirs) {
    const skillMetaPath = path.join(getSkillsDir(), subdir, skillName, SKILL_HUB_META_FILE);
    try {
      const raw = await fs.readFile(skillMetaPath, 'utf-8');
      const meta = JSON.parse(raw) as { enabled?: boolean };
      return meta.enabled !== false;
    } catch {
      // Not found in this subdir, continue
    }
  }

  // Fallback: check legacy flat path for backward compatibility
  const legacyMetaPath = path.join(getSkillsDir(), skillName, SKILL_HUB_META_FILE);
  try {
    const raw = await fs.readFile(legacyMetaPath, 'utf-8');
    const meta = JSON.parse(raw) as { enabled?: boolean };
    return meta.enabled !== false;
  } catch {
    return true;
  }
}

/**
 * 加载指定 skills 的内容（带缓存）
 * Load content of specified skills (with caching)
 * @param enabledSkills - skill 名称列表 / list of skill names
 * @returns 合并后的 skills 内容 / merged skills content
 */
export const loadSkillsContent = async (enabledSkills: string[]): Promise<string> => {
  if (!enabledSkills || enabledSkills.length === 0) {
    return '';
  }

  // 使用排序后的 skill 名称作为缓存 key，确保相同组合命中缓存
  // Use sorted skill names as cache key to ensure same combinations hit cache
  const cacheKey = [...enabledSkills].sort().join(',');
  const cached = skillsContentCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const skillsDir = getSkillsDir();
  const skillContents: string[] = [];

  for (const skillName of enabledSkills) {
    // 按优先级搜索：自定义 > Hub > 内置 > 旧版扁平结构
    // Search by priority: custom > hub > builtin > legacy flat structure
    const candidates = [
      { file: path.join(skillsDir, SKILL_SUBDIRS.custom, skillName, 'SKILL.md'), checkEnabled: true },
      { file: path.join(skillsDir, SKILL_SUBDIRS.hub, skillName, 'SKILL.md'), checkEnabled: true },
      { file: path.join(skillsDir, SKILL_SUBDIRS.system, skillName, 'SKILL.md'), checkEnabled: false },
      // Legacy paths for backward compatibility
      { file: path.join(skillsDir, skillName, 'SKILL.md'), checkEnabled: true },
      { file: path.join(skillsDir, `${skillName}.md`), checkEnabled: false },
    ];

    try {
      let content: string | null = null;

      for (const candidate of candidates) {
        if (!existsSync(candidate.file)) continue;
        if (candidate.checkEnabled && !(await isUserSkillEnabled(skillName))) {
          continue;
        }
        content = await fs.readFile(candidate.file, 'utf-8');
        break;
      }

      if (content && content.trim()) {
        skillContents.push(`## Skill: ${skillName}\n${content}`);
      }
    } catch (error) {
      mainWarn('Sudowork', `Failed to load skill ${skillName}:`, error);
    }
  }

  const result = skillContents.length === 0 ? '' : `[Available Skills]\n${skillContents.join('\n\n')}`;

  // 缓存结果 / Cache result
  skillsContentCache.set(cacheKey, result);

  return result;
};

/**
 * 清除 skills 缓存（在 skills 文件更新后调用）
 * Clear skills cache (call after skills files are updated)
 */
export const clearSkillsCache = (): void => {
  skillsContentCache.clear();
};

export default initStorage;
