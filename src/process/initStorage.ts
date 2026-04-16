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
import { ASSISTANT_PRESETS } from '@/common/presets/assistantPresets';
import type { IChatConversationRefer, IConfigStorageRefer, IEnvStorageRefer, IMcpServer } from '../common/storage';
import { ChatMessageStorage, ChatStorage, ConfigStorage, EnvStorage } from '../common/storage';
import { copyDirectoryRecursively, ensureDirectory, getConfigPath, getDataPath, getTempPath, verifyDirectoryFiles } from './utils';
import { getDatabase } from './database/export';
import type { AcpBackendConfig } from '@/types/acpTypes';
import { perfLog, mainLog, mainWarn, mainError } from './utils/mainLogger';
import { SKILL_SUBDIRS } from './constants/skillStorage';
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
 * 获取 Hub 安装助手目录路径 (_hub 子目录)
 * Get hub-installed assistants directory path
 */
const getHubAssistantsDir = () => {
  return path.join(getAssistantsDir(), '_hub');
};

/**
 * 获取系统/内置助手目录路径 (_system 子目录)
 * Get system/builtin assistants directory path
 */
const getSystemAssistantsDir = () => {
  return path.join(getAssistantsDir(), '_system');
};

/**
 * 获取自定义助手目录路径 (_my-custom-assistant 子目录)
 * Get custom assistants directory path
 */
const getCustomAssistantsDir = () => {
  return path.join(getAssistantsDir(), '_my-custom-assistant');
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

/**
 * 解析内置资源目录在磁盘上的绝对路径。
 * Resolve the absolute path of a bundled builtin resource directory.
 *
 * 开发模式下使用项目根目录，生产模式使用 app.getAppPath()
 * In development, use project root. In production, use app.getAppPath()
 * When packaged, resources are in asarUnpack, so they're at app.asar.unpacked/
 * 打包后，资源在 asarUnpack 中，所以在 app.asar.unpacked/ 目录下
 */
const resolveBuiltinResourceDir = (dirPath: string): string => {
  const appPath = app.getAppPath();
  let candidates: string[];
  if (app.isPackaged) {
    // asarUnpack extracts files to app.asar.unpacked directory
    // asarUnpack 会将文件解压到 app.asar.unpacked 目录
    const unpackedPath = appPath.replace('app.asar', 'app.asar.unpacked');
    candidates = [
      path.join(unpackedPath, dirPath), // Unpacked location (preferred)
      path.join(appPath, dirPath), // Fallback to asar path
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
 * 将内置 skills 从 bundle 同步到用户目录的 `_system/`（每次启动都强制 overwrite）。
 * Sync bundled builtin skills into the user's `_system/` directory on every startup.
 *
 * 为什么必须每次启动同步，而不复用 `initBuiltinAssistantRules` 的版本门控：
 *   - 内置 skill 是只读资源（`disableSkill` 对 `is_builtin: true` 的 skill 会直接拒绝），
 *     用户修改只可能发生在 `_custom/` 和 `_hub/`，overwrite `_system/` 是安全的。
 *   - 只变动 skill 脚本而不 bump `package.json` 版本号时（例如只修 bug），
 *     旧的 version-gate 会永久跳过刷新，导致用户本地的 skill 脚本停留在首次安装的版本。
 *
 * Why unconditional (not gated by app version like `initBuiltinAssistantRules`):
 *   - Builtin skills are read-only resources (`disableSkill` refuses to disable
 *     skills with `is_builtin: true`); user modifications only live under
 *     `_custom/` and `_hub/`. Overwriting `_system/` is therefore safe.
 *   - When a skill script is fixed without a `package.json` version bump
 *     (e.g. a pure bugfix), a version-gated copy would permanently skip the
 *     refresh, leaving users stuck on whichever script shipped at first install.
 */
const syncBuiltinSkillsToUserDir = async (): Promise<void> => {
  const builtinSkillsDir = resolveBuiltinResourceDir('skills');
  if (!existsSync(builtinSkillsDir)) {
    return;
  }

  try {
    // 确保用户技能目录和 _system 子目录存在
    // Ensure user skills dir and _system subdir exist
    const userSkillsDir = getSkillsDir();
    if (!existsSync(userSkillsDir)) {
      mkdirSync(userSkillsDir);
    }
    const userSystemSkillsDir = getSystemSkillsDir();
    if (!existsSync(userSystemSkillsDir)) {
      mkdirSync(userSystemSkillsDir);
    }
    // 复制 skills/* 到 _system/，其中资源目录自带 _builtin 子目录
    // Copy skills/* into _system/; the bundled resources already contain the _builtin subdirectory
    await copyDirectoryRecursively(builtinSkillsDir, userSystemSkillsDir, { overwrite: true });
    mainLog('Sudowork', 'Builtin skills synced to _system/ (overwrite)');
  } catch (error) {
    mainWarn('Sudowork', 'Failed to sync builtin skills directory:', error);
  }
};

/**
 * 初始化内置助手的规则和技能文件到用户目录
 * Initialize builtin assistant rule and skill files to user directory
 *
 * 分为两步：
 *   1) 内置 skill 目录同步：每次启动都强制 overwrite（见 `syncBuiltinSkillsToUserDir`）。
 *   2) 助手 rule/skill 文件复制：仍然走版本门控，避免每次启动 N 个 preset × 多 locale
 *      的并发文件 IO。新增/修改 preset 必须配合 app 版本号 bump 才会刷新。
 *
 * Two phases:
 *   1) Builtin skills dir sync: always overwrites on startup (see `syncBuiltinSkillsToUserDir`).
 *   2) Assistant rule/skill file copy: still version-gated to avoid repeated heavy I/O
 *      for N presets × multiple locales on every startup. Adding/changing a preset
 *      requires bumping the app version for the refresh to kick in.
 */
const initBuiltinAssistantRules = async (): Promise<void> => {
  // Phase 1: 始终同步内置 skill 目录（不受版本门控约束）
  // Phase 1: always sync builtin skills dir (not gated by app version)
  await syncBuiltinSkillsToUserDir();

  // Phase 2: 版本门控的助手 rule/skill 文件复制
  // Phase 2: version-gated assistant rule/skill file copy
  const assistantsDir = getAssistantsDir();

  // 检查是否需要重新复制资源文件
  // Check if we need to re-copy resource files
  const currentVersion = app.getVersion();
  const lastCopiedVersion = await configFile.get('system.lastBuiltinResourcesVersion').catch(() => '');

  // 需要复制的情况：
  // 1. 版本更新了
  // 2. 助手目录不存在（用户手动删除了）
  // 3. 有助手规则文件缺失（新增了预设助手）
  // Conditions that require copy:
  // 1. Version updated
  // 2. Assistants directory doesn't exist (user manually deleted)
  // 3. Some assistant rule files are missing (new preset added)
  const assistantsDirExists = existsSync(assistantsDir);
  const hasAllAssistantRules =
    assistantsDirExists &&
    ASSISTANT_PRESETS.every((preset) => {
      if (Object.keys(preset.ruleFiles).length === 0) return true;
      const firstLocale = Object.keys(preset.ruleFiles)[0];
      const targetFileName = `builtin-${preset.id}.${firstLocale}.md`;
      return existsSync(path.join(assistantsDir, targetFileName));
    });
  const needsCopy = lastCopiedVersion !== currentVersion || !assistantsDirExists || !hasAllAssistantRules;

  if (!needsCopy) {
    mainLog('Sudowork', `Builtin assistant resources already up-to-date (v${currentVersion}), skipping copy`);
    return;
  }

  mainLog('Sudowork', `Copying builtin assistant resources (v${lastCopiedVersion || 'none'} -> v${currentVersion})...`);

  const resolveBuiltinDir = resolveBuiltinResourceDir;

  const presetsNeedDefaultRulesDir = ASSISTANT_PRESETS.some((preset) => !preset.resourceDir && Object.keys(preset.ruleFiles).length > 0);
  const rulesDir = presetsNeedDefaultRulesDir ? resolveBuiltinDir('rules') : '';
  const builtinSkillsDir = resolveBuiltinDir('skills');
  const userSkillsDir = getSkillsDir();

  // 确保助手目录存在 / Ensure assistants directory exists
  if (!existsSync(assistantsDir)) {
    mkdirSync(assistantsDir);
  }

  // PERF: Process all presets in parallel instead of sequentially
  // Each preset's file operations are independent, so they can run concurrently
  await Promise.all(
    ASSISTANT_PRESETS.map(async (preset) => {
      const assistantId = `builtin-${preset.id}`;

      // 如果设置了 resourceDir，使用该目录；否则使用默认的 rules/ 目录
      // If resourceDir is set, use that directory; otherwise use default rules/ directory
      const presetRulesDir = preset.resourceDir ? resolveBuiltinDir(preset.resourceDir) : rulesDir;
      const presetSkillsDir = preset.resourceDir ? resolveBuiltinDir(preset.resourceDir) : builtinSkillsDir;

      // 复制规则文件 / Copy rule files
      const hasRuleFiles = Object.keys(preset.ruleFiles).length > 0;
      if (hasRuleFiles) {
        await Promise.all(
          Object.entries(preset.ruleFiles).map(async ([locale, ruleFile]) => {
            try {
              const sourceRulesPath = path.join(presetRulesDir, ruleFile);
              // 目标文件名格式：{assistantId}.{locale}.md
              // Target file name format: {assistantId}.{locale}.md
              const targetFileName = `${assistantId}.${locale}.md`;
              const targetPath = path.join(assistantsDir, targetFileName);

              // 检查源文件是否存在 / Check if source file exists
              if (!existsSync(sourceRulesPath)) {
                mainWarn('Sudowork', `Source rule file not found: ${sourceRulesPath}`);
                return;
              }

              // 内置助手规则文件始终强制覆盖，确保用户获得最新版本
              // Always overwrite builtin assistant rule files to ensure users get the latest version
              let content = await fs.readFile(sourceRulesPath, 'utf-8');
              // 替换相对路径为绝对路径，确保 AI 能找到正确的脚本位置
              // Replace relative paths with absolute paths so AI can find scripts correctly
              content = content.replace(/skills\//g, userSkillsDir + '/');
              await fs.writeFile(targetPath, content, 'utf-8');
            } catch (error) {
              // 忽略缺失的语言文件 / Ignore missing locale files
              mainWarn('Sudowork', `Failed to copy rule file ${ruleFile}:`, error);
            }
          })
        );
      } else {
        // 如果助手没有 ruleFiles 配置，删除旧的 rules 缓存文件
        // If assistant has no ruleFiles config, delete old rules cache files
        const rulesFilePattern = new RegExp(`^${assistantId}\\..*\\.md$`);
        try {
          const files = readdirSync(assistantsDir);
          await Promise.all(
            files
              .filter((file) => rulesFilePattern.test(file))
              .map(async (file) => {
                const filePath = path.join(assistantsDir, file);
                await fs.unlink(filePath);
              })
          );
        } catch (error) {
          // 忽略删除失败 / Ignore deletion failure
        }
      }

      // 复制技能文件 / Copy skill files (if preset has skills)
      if (preset.skillFiles) {
        await Promise.all(
          Object.entries(preset.skillFiles).map(async ([locale, skillFile]) => {
            try {
              const sourceSkillsPath = path.join(presetSkillsDir, skillFile);
              // 目标文件名格式：{assistantId}-skills.{locale}.md
              // Target file name format: {assistantId}-skills.{locale}.md
              const targetFileName = `${assistantId}-skills.${locale}.md`;
              const targetPath = path.join(assistantsDir, targetFileName);

              // 检查源文件是否存在 / Check if source file exists
              if (!existsSync(sourceSkillsPath)) {
                mainWarn('Sudowork', `Source skill file not found: ${sourceSkillsPath}`);
                return;
              }

              // 内置助手技能文件始终强制覆盖，确保用户获得最新版本
              // Always overwrite builtin assistant skill files to ensure users get the latest version
              let content = await fs.readFile(sourceSkillsPath, 'utf-8');
              // 替换相对路径为绝对路径，确保 AI 能找到正确的脚本位置
              // Replace relative paths with absolute paths so AI can find scripts correctly
              content = content.replace(/skills\//g, userSkillsDir + '/');
              await fs.writeFile(targetPath, content, 'utf-8');
            } catch (error) {
              // 忽略缺失的技能文件 / Ignore missing skill files
              mainWarn('Sudowork', `Failed to copy skill file ${skillFile}:`, error);
            }
          })
        );
      } else {
        // 如果助手没有 skillFiles 配置，删除旧的 skills 缓存文件
        // If assistant has no skillFiles config, delete old skills cache files
        // 这样可以确保迁移到 SkillManager 后不会读取到旧的 presetSkills
        // This ensures old presetSkills won't be read after migrating to SkillManager
        const skillsFilePattern = new RegExp(`^${assistantId}-skills\\..*\\.md$`);
        try {
          const files = readdirSync(assistantsDir);
          await Promise.all(
            files
              .filter((file) => skillsFilePattern.test(file))
              .map(async (file) => {
                const filePath = path.join(assistantsDir, file);
                await fs.unlink(filePath);
              })
          );
        } catch (error) {
          // 忽略删除失败 / Ignore deletion failure
        }
      }
    })
  );

  // 保存当前版本号，下次启动时跳过复制
  // Save current version to skip copy on next startup
  await configFile.set('system.lastBuiltinResourcesVersion', currentVersion);
  mainLog('Sudowork', `Builtin resources copied successfully (v${currentVersion})`);
};

/**
 * 获取内置助手配置（不包含 context，context 从文件读取）
 * Get built-in assistant configurations (without context, context is read from files)
 */
const getBuiltinAssistants = (): AcpBackendConfig[] => {
  const assistants: AcpBackendConfig[] = [];

  for (const preset of ASSISTANT_PRESETS) {
    // 从预设配置中读取默认启用的技能列表（不包含 cron，因为它是内置 skill，自动注入）
    // Read default enabled skills from preset config (excluding cron, which is builtin and auto-injected)
    const defaultEnabledSkills = preset.defaultEnabledSkills;
    const enabledByDefault = preset.id === 'cowork' || preset.id === 'openclaw-setup' || preset.id === 'star-office-helper' || preset.id === 'story-roleplay' || preset.id === 'moltbook' || preset.id === 'beautiful-mermaid' || preset.id === 'doctor' || preset.id === 'jiansheku';

    assistants.push({
      id: `builtin-${preset.id}`,
      name: preset.nameI18n['en-US'],
      nameI18n: preset.nameI18n,
      description: preset.descriptionI18n['en-US'],
      descriptionI18n: preset.descriptionI18n,
      avatar: preset.avatar,
      // context 不再存储在配置中，而是从文件读取
      // context is no longer stored in config, read from files instead
      // Cowork 默认启用 / Cowork enabled by default
      enabled: enabledByDefault,
      isPreset: true,
      isBuiltin: true,
      presetAgentType: preset.presetAgentType || 'claude',
      // Cowork 默认启用所有内置技能 / Cowork enables all builtin skills by default
      enabledSkills: defaultEnabledSkills,
      // 复制快捷提示词 / Copy quick prompts
      promptsI18n: preset.promptsI18n,
      // API Key 配置字段 / API Key configuration fields
      apiKeyFields: preset.apiKeyFields,
    });
  }

  return assistants;
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
  // PERF: Assistant config + database init are independent; run them concurrently
  const assistantsPromise = (async () => {
    try {
      // 5.1 初始化内置助手的规则文件到用户目录
      // Initialize builtin assistant rule files to user directory
      await initBuiltinAssistantRules();

      // 5.2 初始化助手配置（只包含元数据，不包含 context）
      // Initialize assistant config (metadata only, no context)
      // PERF: Read config once and reuse — configFile now has in-memory cache,
      // so the first get() reads from disk and subsequent ones use cache
      const existingAgents = (await configFile.get('acp.customAgents').catch((): undefined => undefined)) || [];
      const builtinAssistants = getBuiltinAssistants();

      // 5.2.1 检查是否需要迁移：修复老版本中所有助手都默认启用的问题
      // Check if migration needed: fix old version where all assistants were enabled by default
      const ASSISTANT_ENABLED_MIGRATION_KEY = 'migration.assistantEnabledFixed';
      const migrationDone = await configFile.get(ASSISTANT_ENABLED_MIGRATION_KEY).catch(() => false);
      const needsMigration = !migrationDone && existingAgents.length > 0;

      // 5.2.2 检查是否需要迁移：为内置助手添加默认启用的技能
      // Check if migration needed: add default enabled skills for builtin assistants
      const BUILTIN_SKILLS_MIGRATION_KEY = 'migration.builtinDefaultSkillsAdded_v2';
      const builtinSkillsMigrationDone = await configFile.get(BUILTIN_SKILLS_MIGRATION_KEY).catch(() => false);
      const needsBuiltinSkillsMigration = !builtinSkillsMigrationDone;

      // 5.2.3 检查是否需要迁移：为内置助手添加 promptsI18n
      // Check if migration needed: add promptsI18n for builtin assistants
      const PROMPTS_I18N_MIGRATION_KEY = 'migration.promptsI18nAdded';
      const promptsI18nMigrationDone = await configFile.get(PROMPTS_I18N_MIGRATION_KEY).catch(() => false);
      const needsPromptsI18nMigration = !promptsI18nMigrationDone;

      // 更新或添加内置助手配置
      // Update or add built-in assistant configurations
      const updatedAgents = [...existingAgents];
      let hasChanges = false;

      for (const builtin of builtinAssistants) {
        const index = updatedAgents.findIndex((a: AcpBackendConfig) => a.id === builtin.id);
        if (index >= 0) {
          // 更新现有内置助手配置
          // Update existing built-in assistant config
          const existing = updatedAgents[index];
          // 只有当关键字段不同时才更新，避免不必要的写入
          // Update only if key fields are different to avoid unnecessary writes
          // 注意：enabled 和 presetAgentType 字段由用户控制，不参与 shouldUpdate 判断
          // Note: enabled and presetAgentType are user-controlled, not included in shouldUpdate check
          // 检查 promptsI18n 是否需要更新（如果不存在或已更改，或需要迁移）
          // Check if promptsI18n needs update (if missing, changed, or migration needed)
          const promptsI18nMissing = !existing.promptsI18n && builtin.promptsI18n;
          const promptsI18nChanged = existing.promptsI18n && builtin.promptsI18n && JSON.stringify(existing.promptsI18n) !== JSON.stringify(builtin.promptsI18n);
          const needsPromptsI18nUpdate = needsPromptsI18nMigration || promptsI18nMissing || promptsI18nChanged;
          const shouldUpdate = existing.name !== builtin.name || existing.description !== builtin.description || existing.avatar !== builtin.avatar || existing.isPreset !== builtin.isPreset || existing.isBuiltin !== builtin.isBuiltin || needsPromptsI18nUpdate;
          // 当 enabled 是 undefined 或需要迁移时，设置默认值（Cowork 启用，其他禁用）
          // When enabled is undefined or migration needed, set default value (Cowork enabled, others disabled)
          const needsEnabledFix = existing.enabled === undefined || needsMigration;
          // 迁移时强制使用默认值，否则保留用户设置
          // Force default value during migration, otherwise preserve user setting
          const resolvedEnabled = needsEnabledFix ? builtin.enabled : existing.enabled;
          // presetAgentType 由用户控制，未设置时使用内置默认值
          // presetAgentType is user-controlled, use builtin default if not set
          const resolvedPresetAgentType = existing.presetAgentType ?? builtin.presetAgentType;

          // 为有 defaultEnabledSkills 配置的内置助手添加默认技能（仅在迁移时且用户未设置 enabledSkills 时）
          // Add default enabled skills for builtin assistants with defaultEnabledSkills (only during migration and if user hasn't set enabledSkills)
          let resolvedEnabledSkills = existing.enabledSkills;
          const needsSkillsMigration = needsBuiltinSkillsMigration && builtin.enabledSkills && (!existing.enabledSkills || existing.enabledSkills.length === 0);
          if (needsSkillsMigration) {
            resolvedEnabledSkills = builtin.enabledSkills;
          }

          if (shouldUpdate || needsEnabledFix || (needsSkillsMigration && resolvedEnabledSkills !== existing.enabledSkills) || needsPromptsI18nUpdate) {
            // 保留用户已设置的 enabled 和 presetAgentType / Preserve user-set enabled and presetAgentType
            updatedAgents[index] = {
              ...existing,
              ...builtin,
              enabled: resolvedEnabled,
              presetAgentType: resolvedPresetAgentType,
              enabledSkills: resolvedEnabledSkills,
              // 确保 promptsI18n 被更新 / Ensure promptsI18n is updated
              promptsI18n: builtin.promptsI18n,
            };
            hasChanges = true;
          }
        } else {
          // 添加新的内置助手
          // Add new built-in assistant
          updatedAgents.unshift(builtin);
          hasChanges = true;
        }
      }

      if (hasChanges) {
        await configFile.set('acp.customAgents', updatedAgents);
      }

      // 标记迁移完成 / Mark migration as done
      if (needsMigration) {
        await configFile.set(ASSISTANT_ENABLED_MIGRATION_KEY, true);
      }
      if (needsBuiltinSkillsMigration) {
        await configFile.set(BUILTIN_SKILLS_MIGRATION_KEY, true);
      }
      if (needsPromptsI18nMigration) {
        await configFile.set(PROMPTS_I18N_MIGRATION_KEY, true);
      }
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
export { getAssistantsDir, getHubAssistantsDir, getSystemAssistantsDir, getCustomAssistantsDir, getSkillsDir, getSystemSkillsDir, getBuiltinSkillsDir, getHubSkillsDir, getCustomSkillsDir, SKILL_SUBDIRS };

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
 * 获取 skill ID → skill name 的映射
 * 用于 enabledSkills 存储 IDs 后，加载技能内容时转换为 name 定位目录
 * Get skill ID → skill name mapping
 * Used when enabledSkills stores IDs, converts to name for directory lookup
 */
export async function getSkillIdToNameMap(): Promise<Map<string, string>> {
  const { skillManager } = await import('@/process/SkillManager');
  const skills = await skillManager.getInstalledSkills();

  const idToNameMap = new Map<string, string>();
  for (const skill of skills) {
    if (skill.meta?.id) {
      idToNameMap.set(skill.meta.id, skill.name);
    }
  }
  return idToNameMap;
}

/**
 * 加载指定 skills 的内容（带缓存）
 * Load content of specified skills (with caching)
 * @param enabledSkills - skill ID列表（UUID格式）/ list of skill IDs
 * @returns 合并后的 skills 内容 / merged skills content
 */
export const loadSkillsContent = async (enabledSkills: string[]): Promise<string> => {
  if (!enabledSkills || enabledSkills.length === 0) {
    return '';
  }

  // 判断是 skill IDs (UUID) 还是 skill names
  // UUID 格式：xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  const isUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const looksLikeIds = enabledSkills.every((s) => isUuidPattern.test(s));

  let skillNames: string[];
  if (looksLikeIds) {
    // 转换 skill IDs → skill names
    const idToNameMap = await getSkillIdToNameMap();
    skillNames = enabledSkills.map((id) => idToNameMap.get(id)).filter((name): name is string => Boolean(name));
    mainLog('Sudowork', `Converted skill IDs to names: ${enabledSkills.join(',')} → ${skillNames.join(',')}`);
  } else {
    // 直接作为 skill names 使用
    skillNames = enabledSkills;
  }

  // 使用排序后的 skill 名称作为缓存 key，确保相同组合命中缓存
  // Use sorted skill names as cache key to ensure same combinations hit cache
  const cacheKey = [...skillNames].sort().join(',');
  const cached = skillsContentCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const skillsDir = getSkillsDir();
  const skillContents: string[] = [];

  for (const skillName of skillNames) {
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
