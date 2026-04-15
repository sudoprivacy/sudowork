/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ChildProcess } from 'child_process';
import { spawn } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { app } from 'electron';
import path from 'path';
import os from 'os';
import type { IMcpServer } from '@/common/storage';
import { convertToMcporterConfig, type McporterConfig } from './mcporterConfig';
import { mainLog, mainWarn, mainError } from '@process/utils/mainLogger';
import { safeExec } from '@process/utils/safeExec';
import { getNodeBinaryPath, ensureNodeInstalled, isNodeInstalled } from '@process/services/claudeCli/NodeRuntimeService';

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
 * 执行mcporter命令的结果
 */
interface McporterExecResult {
  stdout: string;
  stderr: string;
}

/**
 * mcporter 服务 - 管理 MCP 配置和 daemon
 *
 * 支持两种运行模式：
 * 1. 内嵌模式（打包后）：使用内嵌的Node.js runtime和内嵌的mcporter npm包
 * 2. 开发模式：使用npx运行系统安装的mcporter
 */
class McporterService {
  private configPath: string;
  private configDir: string;
  private daemonProcess: ChildProcess | null = null;
  private readonly TIMEOUT = 30000;
  private isBundledMode: boolean;

  constructor() {
    // 配置路径: ~/.nexus/mcporter/mcporter.json
    this.configDir = path.join(os.homedir(), '.nexus', 'mcporter');
    this.configPath = path.join(this.configDir, 'mcporter.json');

    // 判断是否使用内嵌模式
    // 开发模式下可通过环境变量 MCPORTER_BUNDLED=1 强制使用内嵌包测试
    const forceBundled = process.env.MCPORTER_BUNDLED === '1';
    this.isBundledMode = (app.isPackaged || forceBundled) && this.getMcporterCliPath() !== null;

    if (forceBundled && !app.isPackaged) {
      mainLog('McporterService', 'DEV mode: MCPORTER_BUNDLED=1 - forcing bundled mode for testing');
    }
  }

  /**
   * 获取内嵌mcporter CLI路径
   * 打包模式下返回内嵌资源路径，开发模式返回null
   */
  private getMcporterCliPath(): string | null {
    // 打包模式：从resources目录获取
    if (app.isPackaged) {
      // 尝试多种可能的CLI入口路径（优先使用dist/cli.js，这是mcporter的实际入口）
      const possiblePaths = [path.join(process.resourcesPath, 'mcporter', 'dist', 'cli.js'), path.join(process.resourcesPath, 'mcporter', 'bin', 'cli.js'), path.join(process.resourcesPath, 'mcporter', 'cli.js'), path.join(process.resourcesPath, 'mcporter', 'src', 'cli.js'), path.join(process.resourcesPath, 'mcporter', 'index.js')];

      for (const cliPath of possiblePaths) {
        if (existsSync(cliPath)) {
          return cliPath;
        }
      }

      // 尗试检查package.json中的bin字段来确定入口
      const packageJsonPath = path.join(process.resourcesPath, 'mcporter', 'package.json');
      if (existsSync(packageJsonPath)) {
        try {
          const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
          if (packageJson.bin) {
            // bin可能是对象或字符串
            const binPath = typeof packageJson.bin === 'string' ? packageJson.bin : packageJson.bin.mcporter || packageJson.bin['mcporter-cli'] || Object.values(packageJson.bin)[0];

            if (binPath) {
              const fullPath = path.join(process.resourcesPath, 'mcporter', binPath);
              if (existsSync(fullPath)) {
                return fullPath;
              }
            }
          }
        } catch {
          // 解析失败，继续使用其他方法
        }
      }
    }

    // 开发模式：从项目resources目录获取（如果存在）
    const devPath = path.join(app.getAppPath(), 'resources', 'mcporter', 'dist', 'cli.js');
    if (existsSync(devPath)) {
      return devPath;
    }

    return null;
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
   * 打包模式：检查内嵌资源
   * 开发模式：使用npx检查
   */
  async isAvailable(): Promise<boolean> {
    // 打包模式或强制内嵌模式：检查内嵌资源
    const forceBundled = process.env.MCPORTER_BUNDLED === '1';
    if (app.isPackaged || forceBundled) {
      const cliPath = this.getMcporterCliPath();
      const nodeAvailable = isNodeInstalled();

      if (cliPath && nodeAvailable) {
        mainLog('McporterService', 'Bundled mcporter available:', cliPath);
        return true;
      }

      // 内嵌资源不存在，fallback到npx
      if (!cliPath) {
        mainWarn('McporterService', 'Bundled mcporter not found, falling back to npx');
      }
    }

    // 开发模式或fallback：检查npx
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
   * 安装 mcporter (全局安装) - 仅用于开发模式
   * 打包模式不需要安装，直接使用内嵌资源
   */
  async install(): Promise<void> {
    if (app.isPackaged) {
      mainLog('McporterService', 'Packaged mode - skipping npm install, using bundled resources');
      return;
    }

    mainLog('McporterService', 'Installing mcporter globally (dev mode)...');

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
   * 执行 mcporter 命令
   * 打包模式：使用内嵌Node和内嵌mcporter
   * 开发模式：使用npx
   */
  private async runMcporterCommand(args: string[], timeout?: number): Promise<McporterExecResult> {
    const mcporterCliPath = this.getMcporterCliPath();
    const forceBundled = process.env.MCPORTER_BUNDLED === '1';

    // 打包模式或强制内嵌模式：使用内嵌Node直接运行mcporter CLI
    if (mcporterCliPath && (app.isPackaged || forceBundled)) {
      // 确保Node runtime已安装
      await ensureNodeInstalled();
      const nodePath = getNodeBinaryPath();

      mainLog('McporterService', `Running bundled mcporter: node ${mcporterCliPath} ${args.join(' ')}`);

      return this.spawnCommand(nodePath, [mcporterCliPath, ...args], timeout || this.TIMEOUT);
    }

    // 开发模式：使用npx
    mainLog('McporterService', `Running mcporter via npx: npx mcporter ${args.join(' ')}`);
    return safeExec(`npx mcporter ${args.join(' ')}`, {
      timeout: timeout || this.TIMEOUT,
      env: { ...process.env, MCPORTER_CONFIG: this.configPath },
    });
  }

  /**
   * 使用spawn执行命令（静默模式，Windows下不弹窗）
   */
  private spawnCommand(executable: string, args: string[], timeout: number): Promise<McporterExecResult> {
    return new Promise((resolve, reject) => {
      const isWindows = process.platform === 'win32';

      const env = {
        ...process.env,
        MCPORTER_CONFIG: this.configPath,
      };

      // Windows静默执行配置
      const spawnOptions = {
        env,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'] as ('ignore' | 'pipe')[], // 使用可变数组类型
        windowsHide: isWindows, // Windows下不创建控制台窗口
        ...(isWindows && { windowsVerbatimArguments: true }),
      };

      const child = spawn(executable, args, spawnOptions);
      let stdout = '';
      let stderr = '';
      let settled = false;

      if (child.stdout) {
        child.stdout.on('data', (chunk: Buffer) => {
          stdout += chunk.toString();
        });
      }

      if (child.stderr) {
        child.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString();
        });
      }

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          try {
            process.kill(-child.pid!, 'SIGTERM');
          } catch {
            // already exited
          }
          reject(Object.assign(new Error(`Command timed out after ${timeout}ms`), { stdout, stderr }));
        }
      }, timeout);

      child.on('error', (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(err);
        }
      });

      child.on('close', (code) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          if (code === 0) {
            resolve({ stdout, stderr });
          } else {
            reject(Object.assign(new Error(`Command failed with exit code ${code}`), { stdout, stderr, code }));
          }
        }
      });

      // 不阻止Node进程退出
      child.unref();
    });
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
   * 打包模式：使用内嵌Node和内嵌mcporter
   * 开发模式：使用npx
   */
  async startDaemon(): Promise<void> {
    if (this.daemonProcess) {
      mainLog('McporterService', 'Daemon already running');
      return;
    }

    this.ensureConfigDir();

    const mcporterCliPath = this.getMcporterCliPath();
    const forceBundled = process.env.MCPORTER_BUNDLED === '1';

    // 打包模式或强制内嵌模式：使用内嵌Node运行mcporter daemon
    if (mcporterCliPath && (app.isPackaged || forceBundled)) {
      await this.startDaemonBundled(mcporterCliPath);
      return;
    }

    // 开发模式：使用npx
    await this.startDaemonNpx();
  }

  /**
   * 启动daemon - 使用内嵌资源（打包模式）
   */
  private async startDaemonBundled(mcporterCliPath: string): Promise<void> {
    mainLog('McporterService', 'Starting mcporter daemon using bundled resources...');

    try {
      // 确保Node runtime已安装
      await ensureNodeInstalled();
      const nodePath = getNodeBinaryPath();

      const env = {
        ...process.env,
        MCPORTER_CONFIG: this.configPath,
      };

      const isWindows = process.platform === 'win32';

      // 完全静默启动，Windows下不弹出窗口
      const spawnOptions = {
        env,
        detached: true,
        stdio: 'ignore' as const,
        windowsHide: isWindows, // Windows下不创建控制台窗口
        ...(isWindows && { windowsVerbatimArguments: true }),
      };

      mainLog('McporterService', `Executing: node ${mcporterCliPath} daemon start --detach`);

      this.daemonProcess = spawn(nodePath, [mcporterCliPath, 'daemon', 'start', '--detach'], spawnOptions);

      this.daemonProcess.on('error', (error) => {
        mainError('McporterService', 'Daemon process error:', error);
        this.daemonProcess = null;
      });

      this.daemonProcess.on('exit', (code, signal) => {
        mainLog('McporterService', `Daemon process exited with code ${code}, signal ${signal}`);
        this.daemonProcess = null;
      });

      // 不阻止Node进程退出
      this.daemonProcess.unref();

      // 等待daemon启动
      await new Promise((resolve) => setTimeout(resolve, 2000));

      mainLog('McporterService', 'mcporter daemon started (bundled mode)');
    } catch (error) {
      mainError('McporterService', 'Failed to start daemon (bundled):', error);
      throw error;
    }
  }

  /**
   * 启动daemon - 使用npx（开发模式）
   */
  private async startDaemonNpx(): Promise<void> {
    mainLog('McporterService', 'Starting mcporter daemon via npx (dev mode)...');

    try {
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

      mainLog('McporterService', 'mcporter daemon started (npx mode)');
    } catch (error) {
      mainError('McporterService', 'Failed to start daemon (npx):', error);
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
      // 使用runMcporterCommand停止daemon
      await this.runMcporterCommand(['daemon', 'stop'], 10000);

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
      await this.runMcporterCommand(['daemon', 'restart'], 10000);
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
      const result = await this.runMcporterCommand(['daemon', 'status', '--json'], 5000);
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
    mainLog('McporterService', `Mode: ${this.isBundledMode ? 'bundled' : 'npx'}`);

    // 检查 mcporter 是否可用
    const available = await this.isAvailable();
    if (!available) {
      // 打包模式应该总是可用（内嵌资源）
      if (app.isPackaged) {
        mainError('McporterService', 'Bundled mcporter not available - this should not happen');
        // 不抛出错误，让应用继续启动
      } else {
        // 开发模式：尝试安装
        mainLog('McporterService', 'mcporter not available, installing...');
        await this.install();
      }
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
