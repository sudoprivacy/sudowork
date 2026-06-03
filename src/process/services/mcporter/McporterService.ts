/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ChildProcess } from 'child_process';
import { spawn } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
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

// mcporter 解压目录（用户目录下，可写入）
const MCPORTER_EXTRACT_DIR = path.join(os.homedir(), '.nexus', 'mcporter', 'package');

/**
 * mcporter 服务 - 管理 MCP 配置和 daemon
 *
 * 支持两种运行模式：
 * 1. 内嵌模式（打包后）：从 mcporter.tgz 解压到用户目录，使用内嵌Node.js runtime运行
 * 2. 开发模式：使用npx运行系统安装的mcporter
 */
class McporterService {
  private configPath: string;
  private configDir: string;
  private daemonProcess: ChildProcess | null = null;
  private readonly TIMEOUT = 30000;
  private isBundledMode: boolean;
  private extractPromise: Promise<void> | null = null;

  constructor() {
    // 配置路径: ~/.nexus/mcporter/mcporter.json
    this.configDir = path.join(os.homedir(), '.nexus', 'mcporter');
    this.configPath = path.join(this.configDir, 'mcporter.json');

    // 判断是否使用内嵌模式
    // 开发模式下可通过环境变量 MCPORTER_BUNDLED=1 强制使用内嵌包测试
    const forceBundled = process.env.MCPORTER_BUNDLED === '1';
    this.isBundledMode = app.isPackaged || forceBundled;

    if (forceBundled && !app.isPackaged) {
      mainLog('McporterService', 'DEV mode: MCPORTER_BUNDLED=1 - forcing bundled mode for testing');
    }
  }

  /**
   * 确保mcporter已从tgz解压到用户目录
   * 解压后目录结构：~/.nexus/mcporter/package/node_modules/mcporter/dist/cli.js
   */
  private async ensureMcporterExtracted(): Promise<void> {
    // 如果已经解压过，直接返回
    if (existsSync(MCPORTER_EXTRACT_DIR) && existsSync(path.join(MCPORTER_EXTRACT_DIR, 'node_modules', 'mcporter'))) {
      mainLog('McporterService', 'mcporter already extracted to:', MCPORTER_EXTRACT_DIR);
      return;
    }

    // 防止并发解压
    if (this.extractPromise) {
      return this.extractPromise;
    }

    this.extractPromise = this.doExtract();
    try {
      await this.extractPromise;
    } finally {
      this.extractPromise = null;
    }
  }

  /**
   * 执行解压操作
   */
  private async doExtract(): Promise<void> {
    mainLog('McporterService', 'Extracting mcporter.tgz...');

    // 确保目标目录存在（必须先创建，否则tar无法切换到该目录）
    mkdirSync(MCPORTER_EXTRACT_DIR, { recursive: true });
    mainLog('McporterService', 'Created extract directory:', MCPORTER_EXTRACT_DIR);

    // 获取tgz路径
    const tgzPath = this.getMcporterTgzPath();
    if (!tgzPath || !existsSync(tgzPath)) {
      throw new Error(`mcporter.tgz not found at ${tgzPath}`);
    }

    // 使用tar解压（通过Node spawn调用系统tar命令）
    const isWindows = process.platform === 'win32';

    // Windows可能没有tar命令，使用Node内置方式或其他方法
    // 现代Windows 10+ 已经有内置tar命令
    const tarCommand = isWindows ? 'tar' : 'tar';
    const tarArgs = ['-xzf', tgzPath, '-C', MCPORTER_EXTRACT_DIR];

    mainLog('McporterService', `Extracting: ${tarCommand} ${tarArgs.join(' ')}`);

    await new Promise<void>((resolve, reject) => {
      const child = spawn(tarCommand, tarArgs, {
        stdio: 'pipe',
        windowsHide: isWindows,
      });

      let stderr = '';

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('error', (err) => {
        mainError('McporterService', 'Extract failed:', err);
        reject(err);
      });

      child.on('close', (code) => {
        if (code === 0) {
          mainLog('McporterService', 'Extract completed successfully');
          resolve();
        } else {
          mainError('McporterService', `Extract failed with code ${code}:`, stderr);
          reject(new Error(`tar exited with code ${code}: ${stderr}`));
        }
      });
    });

    // 验证解压结果
    const expectedCliPath = path.join(MCPORTER_EXTRACT_DIR, 'node_modules', 'mcporter', 'dist', 'cli.js');
    if (!existsSync(expectedCliPath)) {
      // 列出解压后的目录结构帮助调试
      mainWarn('McporterService', 'Expected CLI not found, listing extracted structure...');
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const items = require('fs').readdirSync(MCPORTER_EXTRACT_DIR);
        mainLog('McporterService', 'Extracted items:', items.join(', '));
      } catch {
        // ignored
      }
      throw new Error('mcporter CLI not found after extraction');
    }

    mainLog('McporterService', 'mcporter CLI available at:', expectedCliPath);
  }

  /**
   * 获取mcporter.tgz路径
   */
  private getMcporterTgzPath(): string | null {
    if (app.isPackaged) {
      // 打包模式：从resources目录获取
      return path.join(process.resourcesPath, 'mcporter.tgz');
    }

    // 开发模式：从项目resources目录获取
    const devPath = path.join(app.getAppPath(), 'resources', 'mcporter.tgz');
    if (existsSync(devPath)) {
      return devPath;
    }

    return null;
  }

  /**
   * 获取mcporter CLI路径（解压后）
   */
  private getMcporterCliPath(): string | null {
    // 解压后的CLI路径
    const cliPath = path.join(MCPORTER_EXTRACT_DIR, 'node_modules', 'mcporter', 'dist', 'cli.js');
    if (existsSync(cliPath)) {
      return cliPath;
    }

    // 备选路径
    const altPaths = [path.join(MCPORTER_EXTRACT_DIR, 'node_modules', 'mcporter', 'bin', 'cli.js'), path.join(MCPORTER_EXTRACT_DIR, 'node_modules', 'mcporter', 'cli.js')];

    for (const altPath of altPaths) {
      if (existsSync(altPath)) {
        return altPath;
      }
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
   */
  async isAvailable(): Promise<boolean> {
    const forceBundled = process.env.MCPORTER_BUNDLED === '1';

    if (app.isPackaged || forceBundled) {
      // 先确保解压完成
      try {
        await this.ensureMcporterExtracted();
      } catch (err) {
        mainError('McporterService', 'Failed to extract mcporter:', err);
        return false;
      }

      const cliPath = this.getMcporterCliPath();
      const nodeAvailable = isNodeInstalled();

      if (cliPath && nodeAvailable) {
        mainLog('McporterService', 'Bundled mcporter available:', cliPath);
        return true;
      }

      if (!cliPath) {
        mainWarn('McporterService', 'Bundled mcporter CLI not found after extraction');
      }
      if (!nodeAvailable) {
        mainWarn('McporterService', 'Node runtime not installed');
      }

      return false;
    }

    // 开发模式：检查npx
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
   */
  private async runMcporterCommand(args: string[], timeout?: number): Promise<McporterExecResult> {
    const forceBundled = process.env.MCPORTER_BUNDLED === '1';

    if (app.isPackaged || forceBundled) {
      // 确保已解压
      await this.ensureMcporterExtracted();

      const mcporterCliPath = this.getMcporterCliPath();
      if (!mcporterCliPath) {
        throw new Error('mcporter CLI not found after extraction');
      }

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

      const spawnOptions = {
        env,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'] as ('ignore' | 'pipe')[],
        windowsHide: isWindows,
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
      writeFileSync(this.configPath, configJson, 'utf-8');
      mainLog('McporterService', `Synced ${Object.keys(config.mcpServers).length} MCP servers to ${this.configPath}`);

      await this.syncToClaudeCode(config.mcpServers);

      const daemonStatus = await this.getDaemonStatus();
      if (daemonStatus.running) {
        mainLog('McporterService', `Daemon running (pid: ${daemonStatus.pid}), reloading config...`);
        await this.reloadDaemon();
      } else {
        mainLog('McporterService', 'Daemon not running, config will be loaded on next daemon start');
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
      let claudeConfig: Record<string, unknown> = {};
      if (existsSync(claudeConfigPath)) {
        const content = readFileSync(claudeConfigPath, 'utf-8');
        claudeConfig = JSON.parse(content);
      }

      const claudeMcpServers: Record<string, { type?: string; url?: string; command?: string; args?: string[]; env?: Record<string, string> }> = {};

      for (const [name, server] of Object.entries(mcpServers)) {
        if (server.baseUrl) {
          claudeMcpServers[name] = {
            type: 'sse',
            url: server.baseUrl,
          };
          if (server.headers) {
            claudeMcpServers[name].url = server.baseUrl;
          }
        } else if (server.command) {
          claudeMcpServers[name] = {
            command: server.command,
            args: server.args,
            env: server.env,
          };
        }
      }

      claudeConfig['mcpServers'] = claudeMcpServers;

      writeFileSync(claudeConfigPath, JSON.stringify(claudeConfig, null, 2), 'utf-8');
      mainLog('McporterService', `Synced ${Object.keys(claudeMcpServers).length} MCP servers to Claude Code`);
    } catch (error) {
      mainWarn('McporterService', 'Failed to sync to Claude Code:', error);
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
    const existingStatus = await this.getDaemonStatus();
    if (existingStatus.running) {
      mainLog('McporterService', `Daemon already running in system (pid: ${existingStatus.pid}), skipping start`);
      return;
    }

    this.ensureConfigDir();

    const forceBundled = process.env.MCPORTER_BUNDLED === '1';

    if (app.isPackaged || forceBundled) {
      await this.ensureMcporterExtracted();
      const mcporterCliPath = this.getMcporterCliPath();
      if (!mcporterCliPath) {
        throw new Error('mcporter CLI not found after extraction');
      }
      await this.startDaemonBundled(mcporterCliPath);
      return;
    }

    await this.startDaemonNpx();
  }

  /**
   * 启动daemon - 使用内嵌资源（打包模式）
   */
  private async startDaemonBundled(mcporterCliPath: string): Promise<void> {
    mainLog('McporterService', 'Starting mcporter daemon using bundled resources...');

    try {
      await ensureNodeInstalled();
      const nodePath = getNodeBinaryPath();

      const env = {
        ...process.env,
        MCPORTER_CONFIG: this.configPath,
      };

      const isWindows = process.platform === 'win32';

      const spawnOptions = {
        env,
        detached: true,
        stdio: 'ignore' as const,
        windowsHide: isWindows,
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

      this.daemonProcess.unref();

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
      await this.runMcporterCommand(['daemon', 'stop'], 10000);

      this.daemonProcess = null;
      mainLog('McporterService', 'mcporter daemon stopped');
    } catch (error) {
      mainWarn('McporterService', 'Failed to stop daemon:', error);
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

    const available = await this.isAvailable();
    if (!available) {
      if (app.isPackaged) {
        mainError('McporterService', 'Bundled mcporter not available - this should not happen');
      } else {
        mainLog('McporterService', 'mcporter not available, installing...');
        await this.install();
      }
    }

    // 创建 wrapper script（让用户可以直接用 mcporter 命令）
    this.ensureWrapperCreated();

    await this.syncConfig(servers);
    await this.startDaemon();

    mainLog('McporterService', 'mcporter initialized');
  }

  /**
   * Wrapper script 目录（~/.nexus/bin）
   */
  private getBinDir(): string {
    return path.join(os.homedir(), '.nexus', 'bin');
  }

  /**
   * 确保 wrapper script 已创建（让用户可以直接用 mcporter 命令）
   */
  private ensureWrapperCreated(): void {
    if (!app.isPackaged) {
      // 开发模式不需要创建 wrapper（用户用 npx mcporter）
      return;
    }

    const cliPath = this.getMcporterCliPath();
    if (!cliPath) {
      mainWarn('McporterService', 'CLI not available, skipping wrapper creation');
      return;
    }

    const binDir = this.getBinDir();
    if (!existsSync(binDir)) {
      mkdirSync(binDir, { recursive: true });
    }

    const isWindows = process.platform === 'win32';
    const wrapperPath = isWindows ? path.join(binDir, 'mcporter.cmd') : path.join(binDir, 'mcporter');

    if (existsSync(wrapperPath)) {
      // 已存在，检查是否需要更新（CLI 路径是否正确）
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const existingContent = require('fs').readFileSync(wrapperPath, 'utf-8');
      if (existingContent.includes(cliPath)) {
        mainLog('McporterService', 'Wrapper already exists and is up-to-date');
        return;
      }
    }

    mainLog('McporterService', 'Creating wrapper at:', wrapperPath);

    if (isWindows) {
      this.createWindowsWrapper(cliPath, wrapperPath);
    } else {
      this.createUnixWrapper(cliPath, wrapperPath);
    }

    mainLog('McporterService', 'Wrapper created successfully');
  }

  /**
   * 创建 Windows wrapper script (.cmd)
   */
  private createWindowsWrapper(cliPath: string, wrapperPath: string): void {
    const nodePath = getNodeBinaryPath();
    const lines = [
      '@echo off',
      'setlocal',
      `set "MCPORTER_CONFIG=${this.configPath}"`,
      `set "CLI=${cliPath}"`,
      '',
      ':: 1. Bundled Node.js (from Sudowork)',
      `set "BUNDLED_NODE=${nodePath}"`,
      'if exist "%BUNDLED_NODE%" (',
      '  "%BUNDLED_NODE%" "%CLI%" %*',
      '  exit /b %ERRORLEVEL%',
      ')',
      '',
      ':: 2. Electron as Node',
      'set "ELECTRON_PATH_FILE=%USERPROFILE%\\.nexus\\electron-path"',
      'set "ELECTRON="',
      'if exist "%ELECTRON_PATH_FILE%" (',
      '  set /p ELECTRON=<"%ELECTRON_PATH_FILE%"',
      ')',
      'if defined ELECTRON (',
      '  if exist "!ELECTRON!" (',
      '    set ELECTRON_RUN_AS_NODE=1',
      '    "!ELECTRON!" "%CLI%" %*',
      '    exit /b %ERRORLEVEL%',
      '  )',
      ')',
      '',
      ':: 3. Fallback: system Node.js',
      'where node >nul 2>nul',
      'if %ERRORLEVEL% equ 0 (',
      '  node "%CLI%" %*',
      '  exit /b %ERRORLEVEL%',
      ')',
      '',
      'echo Error: Node.js not found. Please install Node.js or open Sudowork to refresh paths.',
      'exit /b 1',
    ];

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('fs').writeFileSync(wrapperPath, lines.join('\r\n') + '\r\n');
  }

  /**
   * 创建 Unix wrapper script (macOS/Linux)
   */
  private createUnixWrapper(cliPath: string, wrapperPath: string): void {
    const nodePath = getNodeBinaryPath();
    const lines = [
      '#!/bin/sh',
      '# mcporter wrapper — managed by Sudowork',
      `MCPORTER_CONFIG="${this.configPath}"`,
      `CLI="${cliPath}"`,
      '',
      '# 1. Bundled Node.js (from Sudowork)',
      `BUNDLED_NODE="${nodePath}"`,
      'if [ -x "$BUNDLED_NODE" ]; then',
      '  export MCPORTER_CONFIG',
      '  exec "$BUNDLED_NODE" "$CLI" "$@"',
      'fi',
      '',
      '# 2. Electron as Node',
      'ELECTRON_PATH_FILE="$HOME/.nexus/electron-path"',
      'if [ -f "$ELECTRON_PATH_FILE" ]; then',
      '  ELECTRON=$(cat "$ELECTRON_PATH_FILE")',
      '  if [ -x "$ELECTRON" ]; then',
      '    export MCPORTER_CONFIG',
      '    ELECTRON_RUN_AS_NODE=1 exec "$ELECTRON" "$CLI" "$@"',
      '  fi',
      'fi',
      '',
      '# 3. Fallback: system Node.js',
      'if command -v node >/dev/null 2>&1; then',
      '  export MCPORTER_CONFIG',
      '  exec node "$CLI" "$@"',
      'fi',
      '',
      'echo "Error: Node.js not found. Please install Node.js or open Sudowork to refresh paths."',
      'exit 1',
    ];

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('fs').writeFileSync(wrapperPath, lines.join('\n') + '\n', { mode: 0o755 });
  }

  /**
   * 清理资源
   */
  async cleanup(): Promise<void> {
    await this.stopDaemon();
  }
}

export const mcporterService = new McporterService();
