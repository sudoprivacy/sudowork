/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { McpOperationResult } from '../McpProtocol';
import { AbstractMcpAgent } from '../McpProtocol';
import type { IMcpServer } from '../../../../common/storage';
import type { SudoclawConfig, SudoclawMcpServerConfig } from '../../../../common/ipcBridge';
import { mainLog, mainWarn, mainError } from '@process/utils/mainLogger';

const SUDOCLAW_DIR = path.join(os.homedir(), '.nexus', 'sudoclaw');
const CONFIG_PATH = path.join(SUDOCLAW_DIR, 'sudoclaw.json');

/**
 * Sudoclaw Gateway MCP 代理实现
 *
 * 将 MCP 配置同步到 sudoclaw.json 的 mcpServers 字段。
 * OpenClaw Gateway 启动时读取该配置并加载 MCP 服务器。
 *
 * 核心设计：
 * - SudoClaw 只支持 stdio 类型的 MCP 服务器
 * - HTTP/SSE/StreamableHTTP 类型通过 mcp-remote 自动桥接为 stdio 进程
 * - 配置变更后自动触发 Gateway 重启
 *
 * 与其他 Agent 的区别：
 * - ClaudeMcpAgent: 通过 `claude mcp add` CLI 命令安装
 * - AionuiMcpAgent: 写入 ProcessConfig 内存配置
 * - SudoclawMcpAgent: 写入 sudoclaw.json 文件 + 触发 Gateway 重启
 */
export class SudoclawMcpAgent extends AbstractMcpAgent {
  constructor() {
    // 使用 'openclaw-gateway' 作为 backend type，与 AcpBackendAll 中定义一致
    super('openclaw-gateway');
  }

  getSupportedTransports(): string[] {
    // 通过 mcp-remote 桥接，所有类型都可以支持
    return ['stdio', 'sse', 'http', 'streamable_http'];
  }

  /**
   * 检测 sudoclaw.json 中已配置的 MCP 服务器
   */
  async detectMcpServers(_cliPath?: string): Promise<IMcpServer[]> {
    try {
      const config = this.readConfig();
      if (!config?.mcpServers) return [];

      return Object.entries(config.mcpServers).map(([name, serverConfig]) => this.convertToIMcpServer(name, serverConfig));
    } catch (error) {
      mainWarn('SudoclawMcpAgent', 'Failed to detect MCP servers:', error);
      return [];
    }
  }

  /**
   * 安装 MCP 服务器到 sudoclaw.json
   * - stdio 类型：直接写入
   * - HTTP/SSE/StreamableHTTP 类型：通过 mcp-remote 桥接为 stdio
   */
  installMcpServers(mcpServers: IMcpServer[]): Promise<McpOperationResult> {
    const installOperation = async () => {
      try {
        const config = this.readConfig() || ({} as SudoclawConfig);
        const mcpServersMap = config.mcpServers || {};

        for (const server of mcpServers) {
          mcpServersMap[server.name] = this.convertToSudoclawFormat(server);
        }

        config.mcpServers = mcpServersMap;
        this.writeConfig(config);

        mainLog('SudoclawMcpAgent', `Installed MCP servers: ${mcpServers.map((s) => s.name).join(', ')}`);

        // 触发 Gateway 重启以加载新 MCP 配置
        await this.notifyConfigChanged();

        return { success: true };
      } catch (error) {
        mainError('SudoclawMcpAgent', 'Failed to install MCP servers:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    };

    Object.defineProperty(installOperation, 'name', { value: 'installMcpServers' });
    return this.withLock(installOperation);
  }

  /**
   * 从 sudoclaw.json 中移除 MCP 服务器
   */
  removeMcpServer(mcpServerName: string): Promise<McpOperationResult> {
    const removeOperation = async () => {
      try {
        const config = this.readConfig();
        if (config?.mcpServers?.[mcpServerName]) {
          delete config.mcpServers[mcpServerName];
          this.writeConfig(config);

          mainLog('SudoclawMcpAgent', `Removed MCP server: ${mcpServerName}`);

          // 触发 Gateway 重启以移除 MCP 配置
          await this.notifyConfigChanged();
        } else {
          mainLog('SudoclawMcpAgent', `MCP server '${mcpServerName}' not found in config (may already be removed)`);
        }
        return { success: true };
      } catch (error) {
        mainError('SudoclawMcpAgent', 'Failed to remove MCP server:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    };

    Object.defineProperty(removeOperation, 'name', { value: 'removeMcpServer' });
    return this.withLock(removeOperation);
  }

  // ==================== Private helpers ====================

  /**
   * 读取 sudoclaw.json 配置
   */
  private readConfig(): SudoclawConfig | null {
    try {
      if (!fs.existsSync(CONFIG_PATH)) return null;
      const content = fs.readFileSync(CONFIG_PATH, 'utf8');
      return JSON.parse(content) as SudoclawConfig;
    } catch {
      return null;
    }
  }

  /**
   * 写入 sudoclaw.json 配置（保留 0o600 权限）
   */
  private writeConfig(config: SudoclawConfig): void {
    fs.mkdirSync(SUDOCLAW_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
    if (process.platform !== 'win32') {
      try {
        fs.chmodSync(CONFIG_PATH, 0o600);
      } catch {
        // ignore
      }
    }
  }

  /**
   * 将 IMcpServer 转换为 SudoClaw 的 stdio 格式
   * HTTP/SSE/StreamableHTTP 类型通过 mcp-remote 自动桥接为 stdio 进程
   */
  private convertToSudoclawFormat(server: IMcpServer): SudoclawMcpServerConfig {
    if (server.transport.type === 'stdio') {
      return {
        command: server.transport.command,
        args: server.transport.args,
        env: server.transport.env,
      };
    }

    // HTTP/SSE/StreamableHTTP → stdio via mcp-remote
    const url = server.transport.url;
    const args = ['-y', 'mcp-remote', url];

    // 传递 headers（如有）
    if (server.transport.headers) {
      for (const [key, value] of Object.entries(server.transport.headers)) {
        args.push('--header', `${key}: ${value}`);
      }
    }

    return {
      command: 'npx',
      args,
      env: {},
    };
  }

  /**
   * 将 sudoclaw.json 中的 MCP 配置转换为 IMcpServer 格式
   */
  private convertToIMcpServer(name: string, config: SudoclawMcpServerConfig): IMcpServer {
    return {
      id: `sudoclaw_${name}`,
      name,
      transport: {
        type: 'stdio',
        command: config.command,
        args: config.args || [],
        env: config.env || {},
      },
      enabled: true,
      status: 'disconnected',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      originalJson: JSON.stringify(
        {
          mcpServers: {
            [name]: config,
          },
        },
        null,
        2
      ),
    };
  }

  /**
   * MCP 配置变更后通知 Gateway 重启
   * Phase 3: 自动重启机制
   */
  private async notifyConfigChanged(): Promise<void> {
    try {
      // 动态导入避免循环依赖
      const { checkSudoclawHealth } = await import('../../services/sudoclaw/sudoclawHealth');
      const { SUDOCLAW_DEFAULT_PORT } = await import('../../services/sudoclaw/SudoclawInstallService');

      const isRunning = await checkSudoclawHealth('127.0.0.1', SUDOCLAW_DEFAULT_PORT, 1000);
      if (isRunning) {
        mainLog('SudoclawMcpAgent', 'MCP config changed, restarting gateway to apply changes...');
        const { serviceManager } = await import('../../services/serviceManager');
        await serviceManager.restartOpenClaw();
        mainLog('SudoclawMcpAgent', 'Gateway restarted successfully after MCP config change');
      } else {
        mainLog('SudoclawMcpAgent', 'Gateway not running, MCP config will be loaded on next start');
      }
    } catch (error) {
      mainWarn('SudoclawMcpAgent', 'Gateway restart after MCP config change failed (config saved, will apply on next start):', error);
    }
  }
}
