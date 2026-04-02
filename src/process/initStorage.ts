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
 * 获取内置技能目录路径（_builtin 子目录）
 * Get builtin skills directory path (_builtin subdirectory)
 * Skills in this directory are automatically injected for ALL agents and scenarios
 */
const getBuiltinSkillsDir = () => {
  return path.join(getSkillsDir(), '_builtin');
};

/**
 * 初始化内置助手的规则和技能文件到用户目录
 * Initialize builtin assistant rule and skill files to user directory
 *
 * 优化：只在版本更新或目录不存在时才复制文件，避免每次启动都做大量文件 I/O
 * Optimization: Only copy files on version update or missing dirs to avoid heavy I/O
 */
const initBuiltinAssistantRules = async (): Promise<void> => {
  const assistantsDir = getAssistantsDir();
  const skillsDir = getSkillsDir();

  // 检查是否需要重新复制资源文件
  // Check if we need to re-copy resource files
  const currentVersion = app.getVersion();
  const lastCopiedVersion = await configFile.get('system.lastBuiltinResourcesVersion').catch(() => '');

  // 需要复制的情况：
  // 1. 版本更新了
  // 2. 目标目录不存在（用户手动删除了）
  // 3. 有助手规则文件缺失（新增了预设助手）
  // Conditions that require copy:
  // 1. Version updated
  // 2. Target directories don't exist (user manually deleted)
  // 3. Some assistant rule files are missing (new preset added)
  const skillsDirExists = existsSync(skillsDir);
  const assistantsDirExists = existsSync(assistantsDir);
  const hasAllAssistantRules =
    assistantsDirExists &&
    ASSISTANT_PRESETS.every((preset) => {
      if (Object.keys(preset.ruleFiles).length === 0) return true;
      const firstLocale = Object.keys(preset.ruleFiles)[0];
      const targetFileName = `builtin-${preset.id}.${firstLocale}.md`;
      return existsSync(path.join(assistantsDir, targetFileName));
    });
  const needsCopy = lastCopiedVersion !== currentVersion || !skillsDirExists || !assistantsDirExists || !hasAllAssistantRules;

  if (!needsCopy) {
    mainLog('Sudowork', `Builtin resources already up-to-date (v${currentVersion}), skipping copy`);
    return;
  }

  mainLog('Sudowork', `Copying builtin resources (v${lastCopiedVersion || 'none'} -> v${currentVersion})...`);

  // 开发模式下使用项目根目录，生产模式使用 app.getAppPath()
  // In development, use project root. In production, use app.getAppPath()
  // When packaged, resources are in asarUnpack, so they're at app.asar.unpacked/
  // 打包后，资源在 asarUnpack 中，所以在 app.asar.unpacked/ 目录下
  const resolveBuiltinDir = (dirPath: string): string => {
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

  const presetsNeedDefaultRulesDir = ASSISTANT_PRESETS.some((preset) => !preset.resourceDir && Object.keys(preset.ruleFiles).length > 0);
  const rulesDir = presetsNeedDefaultRulesDir ? resolveBuiltinDir('rules') : '';
  const builtinSkillsDir = resolveBuiltinDir('skills');
  const userSkillsDir = getSkillsDir();

  // 复制技能脚本目录到用户配置目录
  // Copy skills scripts directory to user config directory
  if (existsSync(builtinSkillsDir)) {
    try {
      // 确保用户技能目录存在
      if (!existsSync(userSkillsDir)) {
        mkdirSync(userSkillsDir);
      }
      // 复制内置技能到用户目录（覆盖同名文件）
      // Copy builtin skills to user directory (overwrite existing files)
      await copyDirectoryRecursively(builtinSkillsDir, userSkillsDir, { overwrite: true });
    } catch (error) {
      mainWarn('Sudowork', `Failed to copy skills directory:`, error);
    }
  }

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
export { getAssistantsDir, getSkillsDir, getBuiltinSkillsDir };

/**
 * Skills 内容缓存，避免重复从文件系统读取
 * Skills content cache to avoid repeated file system reads
 */
const skillsContentCache = new Map<string, string>();
const SKILL_HUB_META_FILE = '_sudowork_meta.json';

export async function isUserSkillEnabled(skillName: string): Promise<boolean> {
  const skillMetaPath = path.join(getSkillsDir(), skillName, SKILL_HUB_META_FILE);

  try {
    const raw = await fs.readFile(skillMetaPath, 'utf-8');
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
  const builtinSkillsDir = getBuiltinSkillsDir();
  const skillContents: string[] = [];

  for (const skillName of enabledSkills) {
    // 优先尝试内置 skills 目录：_builtin/{skillName}/SKILL.md
    // First try builtin skills directory: _builtin/{skillName}/SKILL.md
    const builtinSkillFile = path.join(builtinSkillsDir, skillName, 'SKILL.md');
    // 然后尝试目录结构：{skillName}/SKILL.md（与 aioncli-core 的 loadSkillsFromDir 一致）
    // Then try directory structure: {skillName}/SKILL.md (consistent with aioncli-core's loadSkillsFromDir)
    const skillDirFile = path.join(skillsDir, skillName, 'SKILL.md');
    // 向后兼容：扁平结构 {skillName}.md
    // Backward compatible: flat structure {skillName}.md
    const skillFlatFile = path.join(skillsDir, `${skillName}.md`);

    try {
      let content: string | null = null;

      if (existsSync(builtinSkillFile)) {
        content = await fs.readFile(builtinSkillFile, 'utf-8');
      } else if (existsSync(skillDirFile)) {
        if (!(await isUserSkillEnabled(skillName))) {
          continue;
        }
        content = await fs.readFile(skillDirFile, 'utf-8');
      } else if (existsSync(skillFlatFile)) {
        content = await fs.readFile(skillFlatFile, 'utf-8');
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
