/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { AcpBackendAll, PresetAgentType } from '@/types/acpTypes';
import { POTENTIAL_ACP_CLIS } from '@/types/acpTypes';
import { ProcessConfig } from '@/process/initStorage';
import { ExtensionRegistry } from '@/extensions';
import { getEnhancedEnv } from '@process/utils/shellEnv';
import { getSudoclawCliPath, SUDOCLAW_BIN_DIR } from '@/process/services/sudoclaw/SudoclawInstallService';

/** Nexus bin directory for Claude/Gemini CLI symlinks */
const NEXUS_BIN_DIR = path.join(os.homedir(), '.nexus', 'bin');

/** Priority bin directories for CLI detection */
const PRIORITY_BIN_DIRS = [NEXUS_BIN_DIR, SUDOCLAW_BIN_DIR];

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
      const customAgents = await ProcessConfig.get('acp.customAgents');
      if (!customAgents || !Array.isArray(customAgents) || customAgents.length === 0) return;

      // 过滤出已启用且有有效 CLI 路径或标记为预设的代理 / Filter enabled agents with valid CLI path or marked as preset
      const enabledAgents = customAgents.filter((agent) => agent.enabled && (agent.defaultCliPath || agent.isPreset));
      if (enabledAgents.length === 0) return;

      // 将所有自定义代理追加到列表末尾 / Append all custom agents to the end
      const customDetectedAgents: DetectedAgent[] = enabledAgents.map((agent) => ({
        backend: 'custom',
        name: agent.name || 'Custom Agent',
        cliPath: agent.defaultCliPath,
        acpArgs: agent.acpArgs,
        customAgentId: agent.id, // 存储 UUID 用于标识 / Store the UUID for identification
        isPreset: agent.isPreset,
        context: agent.context,
        avatar: agent.avatar,
        presetAgentType: agent.presetAgentType, // 主 Agent 类型 / Primary agent type
      }));

      detected.push(...customDetectedAgents);
    } catch (error) {
      // 配置读取失败时区分预期错误和非预期错误
      // Distinguish expected vs unexpected errors when reading config
      if (error instanceof Error && (error.message.includes('ENOENT') || error.message.includes('not found'))) {
        // 未配置自定义代理 - 这是正常情况 / No custom agents configured - this is normal
        return;
      }
      console.warn('[AcpDetector] Unexpected error loading custom agents:', error);
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
     * Check if CLI exists in priority bin directories first
     * 优先检查 ~/.nexus/bin 等目录下是否存在 CLI（解决 macOS 环境变量问题）
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

    const isCliAvailable = (cliCommand: string): boolean => {
      // Keep original behavior: prefer where/which, then fallback on Windows to Get-Command.
      // 保持原逻辑：优先使用 where/which，Windows 下失败再回退到 Get-Command。
      try {
        execSync(`${whichCommand} ${cliCommand}`, {
          encoding: 'utf-8',
          stdio: 'pipe',
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
          execSync(`powershell -NoProfile -NonInteractive -Command "Get-Command -All ${cliCommand} | Select-Object -First 1 | Out-Null"`, {
            encoding: 'utf-8',
            stdio: 'pipe',
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

    // 并行检测所有潜在的 ACP CLI
    const detectionPromises = POTENTIAL_ACP_CLIS.map((cli) => {
      return Promise.resolve().then(() => {
        // 优先检查 ~/.nexus/bin 等目录
        // Check priority bin directories first
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

        // 回退到 which/where 检测
        // Fallback to which/where detection
        if (!isCliAvailable(cli.cmd)) {
          return null;
        }

        return {
          backend: cli.backendId,
          name: cli.name,
          cliPath: cli.cmd,
          acpArgs: cli.args,
        };
      });
    });

    const results = await Promise.allSettled(detectionPromises);

    // 收集检测结果
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        detected.push(result.value);
      }
    }

    // 始终展示 Sudoclaw（不依赖探测，避免安装完成后需重启才显示的问题）
    // Always show Sudoclaw (no detection; avoids icon missing until restart after install)
    const sudoclawDetected = detected.some((agent) => agent.backend === 'openclaw-gateway');
    if (!sudoclawDetected) {
      detected.unshift({
        backend: 'openclaw-gateway',
        name: 'Sudoclaw',
        cliPath: getSudoclawCliPath() ?? undefined,
        acpArgs: ['gateway'],
      });
    }

    // 始终添加内置 Gemini 作为默认选项（无需检测其他 CLI）
    // Always add built-in Gemini as default option (no CLI detection needed)
    detected.unshift({
      backend: 'gemini',
      name: 'Gemini CLI',
      cliPath: undefined,
      acpArgs: undefined,
    });

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
}

// 单例实例
export const acpDetector = new AcpDetector();
