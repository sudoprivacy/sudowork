/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { exec, spawn, ChildProcess } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import path from 'path';
import os from 'os';
import type { IMcpServer } from '@/common/storage';
import { convertToMcporterConfig, type McporterConfig } from './mcporterConfig';
import { mainLog, mainWarn, mainError } from '@process/utils/mainLogger';
import { safeExec } from '@process/utils/safeExec';

/**
 * mcporter daemon 状态
 */
export interface DaemonStatus {
  running: boolean;
  pid?: number;
  socketPath?: string;
  uptime?: number;
}

/**
 * mcporter 服务 - 管理 MCP 配置和 daemon
 */
class McporterService {
  private configPath: string;
  private configDir: string;
  private daemonProcess: ChildProcess | null = null;
  private readonly TIMEOUT = 30000;

  constructor() {
    // 配置路径: ~/.nexus/mcporter/mcporter.json
    this.configDir = path.join(os.homedir(), '.nexus', 'mcporter');
    this.configPath = path.join(this.configDir, 'mcporter.json');
  }

  /**
   * 获取 mcporter 配置文件路径
   */
  getConfigPath(): string {
    return this.configPath;
  }

  /**
   * 获取 mcporter 配置目录路径
   */
  getConfigDir(): string {
    return this.configDir;
  }

  /**
   * 检查 mcporter 是否可用
   */
  async isAvailable(): Promise<boolean> {
    try {
      const result = await safeExec('npx mcporter --version', {
        timeout: 10000,
      });
      return result.stdout.trim().length > 0;
    } catch {
      return false;
    }
  }

  /**
   * 安装 mcporter (全局安装)
   */
  async install(): Promise<void> {
    mainLog('McporterService', 'Installing mcporter globally...');

    try {
      await safeExec('npm install -g mcporter', {
        timeout: 60000,
      });
      mainLog('McporterService', 'mcporter installed successfully');
    } catch (error) {
      mainError('McporterService', 'Failed to install mcporter:', error);
      throw error;
    }
  }

  /**
   * 确保配置目录存在
   */
  private ensureConfigDir(): void {
    if (!existsSync(this.configDir)) {
      mkdirSync(this.configDir, { recursive: true });
      mainLog('McporterService', `Created config directory: ${this.configDir}`);
    }
  }

  /**
   * 同步 MCP 配置到 mcporter
   */
  async syncConfig(servers: IMcpServer[]): Promise<void> {
    this.ensureConfigDir();

    const config = convertToMcporterConfig(servers);
    const configJson = JSON.stringify(config, null, 2);

    try {
      // 1. 同步到 mcporter 配置
      writeFileSync(this.configPath, configJson, 'utf-8');
      mainLog('McporterService', `Synced ${Object.keys(config.mcpServers).length} MCP servers to ${this.configPath}`);

      // 2. 同步到 Claude Code 配置 (~/.claude.json)
      await this.syncToClaudeCode(config.mcpServers);

      // 如果 daemon 正在运行，发送重新加载信号
      if (this.daemonProcess) {
        await this.reloadDaemon();
      }
    } catch (error) {
      mainError('McporterService', 'Failed to sync config:', error);
      throw error;
    }
  }

  /**
   * 同步 MCP 配置到 Claude Code (~/.claude.json)
   */
  private async syncToClaudeCode(mcpServers: McporterConfig['mcpServers']): Promise<void> {
    const claudeConfigPath = path.join(os.homedir(), '.claude.json');

    try {
      // 读取现有配置
      let claudeConfig: Record<string, unknown> = {};
      if (existsSync(claudeConfigPath)) {
        const content = readFileSync(claudeConfigPath, 'utf-8');
        claudeConfig = JSON.parse(content);
      }

      // 转换为 Claude Code 格式
      const claudeMcpServers: Record<string, { type?: string; url?: string; command?: string; args?: string[]; env?: Record<string, string> }> = {};

      for (const [name, server] of Object.entries(mcpServers)) {
        if (server.baseUrl) {
          // HTTP/SSE 类型
          claudeMcpServers[name] = {
            type: 'sse',
            url: server.baseUrl,
          };
          if (server.headers) {
            // Claude Code 不直接支持 headers，但 mcporter 可以处理
            claudeMcpServers[name].url = server.baseUrl;
          }
        } else if (server.command) {
          // Stdio 类型
          claudeMcpServers[name] = {
            command: server.command,
            args: server.args,
            env: server.env,
          };
        }
      }

      // 更新配置
      claudeConfig['mcpServers'] = claudeMcpServers;

      // 写回文件
      writeFileSync(claudeConfigPath, JSON.stringify(claudeConfig, null, 2), 'utf-8');
      mainLog('McporterService', `Synced ${Object.keys(claudeMcpServers).length} MCP servers to Claude Code`);
    } catch (error) {
      mainWarn('McporterService', 'Failed to sync to Claude Code:', error);
      // 不抛出错误，因为这不是关键操作
    }
  }

  /**
   * 读取当前 mcporter 配置
   */
  readConfig(): McporterConfig | null {
    try {
      if (!existsSync(this.configPath)) {
        return null;
      }
      const content = readFileSync(this.configPath, 'utf-8');
      return JSON.parse(content) as McporterConfig;
    } catch (error) {
      mainWarn('McporterService', 'Failed to read config:', error);
      return null;
    }
  }

  /**
   * 启动 mcporter daemon
   */
  async startDaemon(): Promise<void> {
    if (this.daemonProcess) {
      mainLog('McporterService', 'Daemon already running');
      return;
    }

    this.ensureConfigDir();

    mainLog('McporterService', 'Starting mcporter daemon...');

    try {
      // 使用环境变量指定配置路径
      const env = {
        ...process.env,
        MCPORTER_CONFIG: this.configPath,
      };

      // 启动 daemon 进程
      this.daemonProcess = spawn('npx', ['mcporter', 'daemon', 'start', '--detach'], {
        env,
        stdio: 'ignore',
        detached: true,
      });

      this.daemonProcess.on('error', (error) => {
        mainError('McporterService', 'Daemon process error:', error);
        this.daemonProcess = null;
      });

      this.daemonProcess.on('exit', (code, signal) => {
        mainLog('McporterService', `Daemon process exited with code ${code}, signal ${signal}`);
        this.daemonProcess = null;
      });

      // 等待 daemon 启动
      await new Promise((resolve) => setTimeout(resolve, 2000));

      mainLog('McporterService', 'mcporter daemon started');
    } catch (error) {
      mainError('McporterService', 'Failed to start daemon:', error);
      throw error;
    }
  }

  /**
   * 停止 mcporter daemon
   */
  async stopDaemon(): Promise<void> {
    if (!this.daemonProcess) {
      mainLog('McporterService', 'Daemon not running');
      return;
    }

    mainLog('McporterService', 'Stopping mcporter daemon...');

    try {
      // 使用 mcporter CLI 停止 daemon
      const env = {
        ...process.env,
        MCPORTER_CONFIG: this.configPath,
      };

      await safeExec('npx mcporter daemon stop', {
        timeout: 10000,
        env,
      });

      this.daemonProcess = null;
      mainLog('McporterService', 'mcporter daemon stopped');
    } catch (error) {
      mainWarn('McporterService', 'Failed to stop daemon:', error);
      // 强制清理
      if (this.daemonProcess) {
        this.daemonProcess.kill();
        this.daemonProcess = null;
      }
    }
  }

  /**
   * 重新加载 daemon 配置
   */
  private async reloadDaemon(): Promise<void> {
    try {
      const env = {
        ...process.env,
        MCPORTER_CONFIG: this.configPath,
      };

      await safeExec('npx mcporter daemon restart', {
        timeout: 10000,
        env,
      });

      mainLog('McporterService', 'Daemon reloaded');
    } catch (error) {
      mainWarn('McporterService', 'Failed to reload daemon:', error);
    }
  }

  /**
   * 获取 daemon 状态
   */
  async getDaemonStatus(): Promise<DaemonStatus> {
    try {
      const env = {
        ...process.env,
        MCPORTER_CONFIG: this.configPath,
      };

      const result = await safeExec('npx mcporter daemon status --json', {
        timeout: 5000,
        env,
      });

      const status = JSON.parse(result.stdout) as DaemonStatus;
      return status;
    } catch {
      return { running: false };
    }
  }

  /**
   * 初始化 mcporter（检查安装、同步配置、启动 daemon）
   */
  async initialize(servers: IMcpServer[]): Promise<void> {
    mainLog('McporterService', 'Initializing mcporter...');

    // 检查 mcporter 是否可用
    const available = await this.isAvailable();
    if (!available) {
      mainLog('McporterService', 'mcporter not available, installing...');
      await this.install();
    }

    // 同步配置
    await this.syncConfig(servers);

    // 启动 daemon
    await this.startDaemon();

    mainLog('McporterService', 'mcporter initialized');
  }

  /**
   * 清理资源
   */
  async cleanup(): Promise<void> {
    await this.stopDaemon();
  }
}

// 单例导出
export const mcporterService = new McporterService();
