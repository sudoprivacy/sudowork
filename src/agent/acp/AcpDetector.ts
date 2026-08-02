/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { AcpBackendAll, PresetAgentType } from '@/types/acpTypes';
import { POTENTIAL_ACP_CLIS, SCODE_REASONING_ACP_ARGS } from '@/types/acpTypes';
import { ProcessConfig } from '@/process/initStorage';
import { assistantManager } from '@/process/AssistantManager';
import { ExtensionRegistry } from '@/extensions';
import { getEnhancedEnv } from '@process/utils/shellEnv';
import { SUDOCLAW_BIN_DIR } from '@/process/services/sudoclaw/SudoclawInstallService';
import { getScodePath } from '@/process/services/scode/ScodeInstallService';
import { SCODE_HOME } from '@/process/services/scode/scodePaths';

const execAsync = promisify(exec);

/** Nexus bin directory for Claude/Gemini CLI symlinks */
const NEXUS_BIN_DIR = path.join(os.homedir(), '.nexus', 'bin');

/** sudowork's isolated engine-scode dir (binary lives here). SSOT: scodePaths.ts */
const SCODE_BIN_DIR = SCODE_HOME;

/** Priority bin directories for CLI detection (scode first to prefer the isolated engine-scode dir over ~/.nexus/bin) */
const PRIORITY_BIN_DIRS = [SCODE_BIN_DIR, NEXUS_BIN_DIR, SUDOCLAW_BIN_DIR];

interface DetectedAgent {
  backend: AcpBackendAll;
  name: string;
  cliPath?: string;
  acpArgs?: string[];
  customAgentId?: string; // UUID for custom agents
  isPreset?: boolean;
  context?: string;
  avatar?: string;
  // Allow extension-contributed adapter IDs (e.g. 'ext-buddy') in addition to built-in PresetAgentType values
  presetAgentType?: PresetAgentType | string;
  isExtension?: boolean;
  extensionName?: string;
}

/**
 * 全局ACP检测器 - 启动时检测一次，全局共享结果
 */
class AcpDetector {
  private detectedAgents: DetectedAgent[] = [];
  private isDetected = false;

  /**
   * 将扩展贡献的 ACP adapter 添加到检测列表（即开即用，不落盘）
   * Add extension-contributed ACP adapters to detected list (hot-load, no persistence).
   */
  private addExtensionAgentsToList(detected: DetectedAgent[]): void {
    try {
      const registry = ExtensionRegistry.getInstance();
      const adapters = registry.getAcpAdapters();
      if (!adapters || adapters.length === 0) return;

      const extensionAgents: DetectedAgent[] = [];
      for (const item of adapters) {
        const adapter = item as Record<string, unknown>;
        const id = typeof adapter.id === 'string' ? adapter.id : '';
        const name = typeof adapter.name === 'string' ? adapter.name : id;
        const defaultCliPath = typeof adapter.defaultCliPath === 'string' ? adapter.defaultCliPath : undefined;
        const acpArgs = Array.isArray(adapter.acpArgs) ? adapter.acpArgs.filter((v): v is string => typeof v === 'string') : undefined;
        const avatar = typeof adapter.avatar === 'string' ? adapter.avatar : undefined;
        const extensionName = typeof adapter._extensionName === 'string' ? adapter._extensionName : 'unknown-extension';

        // 当前 ACP 运行时仅支持 CLI adapter；HTTP/WebSocket adapter 先跳过
        if (!defaultCliPath) {
          continue;
        }

        extensionAgents.push({
          backend: 'custom',
          name,
          cliPath: defaultCliPath,
          acpArgs,
          avatar,
          customAgentId: `ext:${extensionName}:${id}`,
          isExtension: true,
          extensionName,
        });
      }

      if (extensionAgents.length > 0) {
        detected.push(...extensionAgents);
      }
    } catch (error) {
      console.warn('[AcpDetector] Failed to load extension ACP adapters:', error);
    }
  }

  /**
   * 将自定义代理添加到检测列表（追加到末尾）
   * Add custom agents to detected list if configured and enabled (appends to end).
   */
  private async addCustomAgentsToList(detected: DetectedAgent[]): Promise<void> {
    try {
      // 1. Add preset assistants from AssistantManager (filesystem SSOT)
      const assistants = await assistantManager.getInstalledAssistants();
      const enabledAssistants = assistants.filter((a) => a.enabled && a.meta);
      for (const a of enabledAssistants) {
        const customAgentId = a.isBuiltin ? `builtin-${a.meta.id || a.name}` : a.meta.id || a.name;
        detected.push({
          backend: 'custom',
          name: a.meta.nameI18n?.['zh-CN'] || a.meta.nameI18n?.['en-US'] || a.meta.id || a.name,
          customAgentId,
          isPreset: true,
          avatar: a.meta.avatar,
          presetAgentType: a.meta.presetAgentType as PresetAgentType | undefined,
        });
      }

      // 2. Add assistants from legacy ConfigStorage unless the filesystem SSOT
      // already supplied the same ID. Builtin presets still use this flat-file
      // storage path, while newer assistants live under AssistantManager dirs.
      const detectedCustomAgentIds = new Set(detected.map((agent) => agent.customAgentId).filter((id): id is string => typeof id === 'string'));
      const cliAgents = (await ProcessConfig.get('acp.customAgents')) || [];
      for (const agent of cliAgents) {
        if (!agent.enabled || detectedCustomAgentIds.has(agent.id)) continue;
        detected.push({
          backend: 'custom',
          name: agent.name,
          customAgentId: agent.id,
          isPreset: agent.isPreset,
          avatar: agent.avatar,
          presetAgentType: agent.presetAgentType,
          cliPath: agent.defaultCliPath,
          acpArgs: agent.acpArgs,
        });
      }
    } catch (error) {
      console.warn('[AcpDetector] Unexpected error loading agents:', error);
    }
  }

  /**
   * 启动时执行检测 - 使用 POTENTIAL_ACP_CLIS 列表检测已安装的 CLI
   */
  async initialize(): Promise<void> {
    if (this.isDetected) return;

    console.log('[ACP] Starting agent detection...');
    const startTime = Date.now();

    const isWindows = process.platform === 'win32';
    const whichCommand = isWindows ? 'where' : 'which';

    // Get enhanced environment with user's shell PATH (includes ~/.local/bin, etc.)
    // 获取增强的环境变量，包含用户 shell 的 PATH（如 ~/.local/bin 等）
    let enhancedEnv = getEnhancedEnv();

    // Add Nexus bin directories to PATH for detection
    // 将 Nexus bin 目录添加到 PATH 以便检测 Claude/Gemini CLI 等
    const currentPath = enhancedEnv.PATH || process.env.PATH || '';
    const pathSeparator = isWindows ? ';' : ':';
    const dirsToAdd = PRIORITY_BIN_DIRS.filter((dir) => dir && !currentPath.includes(dir));
    if (dirsToAdd.length > 0) {
      enhancedEnv = {
        ...enhancedEnv,
        PATH: `${dirsToAdd.join(pathSeparator)}${pathSeparator}${currentPath}`,
      };
      console.log(`[ACP] Added bin directories to PATH: ${dirsToAdd.join(', ')}`);
    }

    /**
     * Check if CLI exists in priority runtime directories first
     * 优先检查 ~/.nexus/bin、~/.nexus/sudocode 等目录下是否存在 CLI（解决 macOS 环境变量问题）
     */
    const findCliInPriorityDirs = (cliCommand: string): string | null => {
      for (const binDir of PRIORITY_BIN_DIRS) {
        if (!binDir) continue;
        // Check both with and without .cmd/.exe extension on Windows
        const candidates = isWindows ? [path.join(binDir, `${cliCommand}.cmd`), path.join(binDir, `${cliCommand}.exe`), path.join(binDir, cliCommand)] : [path.join(binDir, cliCommand)];

        for (const cliPath of candidates) {
          try {
            if (fs.existsSync(cliPath)) {
              // Check if executable (not a directory)
              const stat = fs.statSync(cliPath);
              if (stat.isFile()) {
                return cliPath;
              }
            }
          } catch {
            // ignore
          }
        }
      }
      return null;
    };

    // PERF: Use async exec instead of execSync to avoid blocking the Node.js event loop.
    // Previously each CLI detection blocked for up to 1s, and with 10+ CLIs this added
    // up to 10+ seconds of frozen UI. Now all detections truly run in parallel.
    const isCliAvailable = async (cliCommand: string): Promise<boolean> => {
      // Keep original behavior: prefer where/which, then fallback on Windows to Get-Command.
      // 保持原逻辑：优先使用 where/which，Windows 下失败再回退到 Get-Command。
      try {
        await execAsync(`${whichCommand} ${cliCommand}`, {
          encoding: 'utf-8',
          timeout: 1000,
          env: enhancedEnv,
        });
        return true;
      } catch {
        if (!isWindows) return false;
      }

      if (isWindows) {
        try {
          // PowerShell fallback for shim scripts like claude.ps1 (vfox)
          // PowerShell 回退，支持 claude.ps1 这类 shim（例如 vfox）
          await execAsync(`powershell -NoProfile -NonInteractive -Command "Get-Command -All ${cliCommand} | Select-Object -First 1 | Out-Null"`, {
            encoding: 'utf-8',
            timeout: 1000,
            env: enhancedEnv,
          });
          return true;
        } catch {
          return false;
        }
      }

      return false;
    };

    const detected: DetectedAgent[] = [];

    // 并行检测所有潜在的 ACP CLI（真正的并行 — isCliAvailable 现在是 async）
    // Truly parallel detection — isCliAvailable is now async, so all CLI checks run concurrently
    const detectionPromises = POTENTIAL_ACP_CLIS.map(async (cli) => {
      // 优先检查 ~/.nexus/bin、~/.nexus/sudocode 等目录
      // Check priority runtime directories first
      const priorityCliPath = findCliInPriorityDirs(cli.cmd);
      if (priorityCliPath) {
        console.log(`[ACP] Found ${cli.cmd} in priority dir: ${priorityCliPath}`);
        return {
          backend: cli.backendId,
          name: cli.name,
          cliPath: priorityCliPath,
          acpArgs: cli.args,
        };
      }

      // 回退到 which/where 检测（异步，不阻塞事件循环）
      // Fallback to which/where detection (async, non-blocking)
      if (!(await isCliAvailable(cli.cmd))) {
        return null;
      }

      return {
        backend: cli.backendId,
        name: cli.name,
        cliPath: cli.cmd,
        acpArgs: cli.args,
      };
    });

    const results = await Promise.allSettled(detectionPromises);

    // 收集检测结果
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        detected.push(result.value);
      }
    }

    // 始终展示 Sudo Code（不依赖探测，避免安装完成后需重启才显示的问题）
    // Always show Sudo Code (no detection; avoids icon missing until restart after install)
    const scodeDetected = detected.some((agent) => agent.backend === 'scode');
    if (!scodeDetected) {
      detected.unshift({
        backend: 'scode',
        name: 'Sudo Code',
        cliPath: getScodePath() ?? undefined,
        acpArgs: SCODE_REASONING_ACP_ARGS,
        presetAgentType: 'scode',
      });
    }

    // 始终添加内置 Gemini 作为默认选项（无需检测其他 CLI）
    // Always add built-in Gemini as default option (no CLI detection needed)
    // detected.unshift({
    //   backend: 'gemini',
    //   name: 'Gemini CLI',
    //   cliPath: undefined,
    //   acpArgs: undefined,
    // });

    // Add extension-contributed agents (hot-load, no persistence)
    this.addExtensionAgentsToList(detected);

    // Check for custom agents configuration
    await this.addCustomAgentsToList(detected);

    this.detectedAgents = detected;
    this.isDetected = true;

    const elapsed = Date.now() - startTime;
    console.log(`[ACP] Detection completed in ${elapsed}ms, found ${detected.length} agents`);
  }

  /**
   * 获取检测结果
   */
  getDetectedAgents(): DetectedAgent[] {
    return this.detectedAgents;
  }

  /**
   * 是否有可用的ACP工具
   */
  hasAgents(): boolean {
    return this.detectedAgents.length > 0;
  }

  /**
   * Refresh custom agents detection only (called when config changes)
   */
  async refreshCustomAgents(): Promise<void> {
    // Remove existing non-extension custom agents if present
    this.detectedAgents = this.detectedAgents.filter((agent) => !(agent.backend === 'custom' && !agent.isExtension));

    // Re-add custom agents with current config
    await this.addCustomAgentsToList(this.detectedAgents);
  }

  /**
   * Re-run full agent detection (e.g. after CLI install/uninstall).
   * Resets the detection flag and re-initializes so that newly installed
   * or removed CLI agents are picked up immediately.
   */
  async rescanCliAgents(): Promise<void> {
    this.isDetected = false;
    await this.initialize();
  }
}

// 单例实例
export const acpDetector = new AcpDetector();
