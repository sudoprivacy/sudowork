/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IMcpServer } from '@/common/storage';

/**
 * mcporter 配置格式
 * @see https://github.com/steipete/mcporter
 */
export interface McporterConfig {
  mcpServers: {
    [name: string]: McporterServerConfig;
  };
  imports?: string[];
}

export interface McporterServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  baseUrl?: string; // for HTTP/SSE
  headers?: Record<string, string>;
  lifecycle?: 'ephemeral' | { mode: 'keep-alive'; idleTimeoutMs?: number };
  description?: string;
}

/**
 * 将 Sudowork MCP 服务器配置转换为 mcporter 格式
 * Convert Sudowork MCP server config to mcporter format
 */
export function convertToMcporterConfig(servers: IMcpServer[]): McporterConfig {
  const mcpServers: McporterConfig['mcpServers'] = {};

  for (const server of servers) {
    // 只同步启用的服务器
    if (!server.enabled) continue;

    const config: McporterServerConfig = {};

    switch (server.transport.type) {
      case 'stdio':
        config.command = server.transport.command;
        if (server.transport.args && server.transport.args.length > 0) {
          config.args = server.transport.args;
        }
        if (server.transport.env && Object.keys(server.transport.env).length > 0) {
          config.env = server.transport.env;
        }
        break;

      case 'sse':
      case 'http':
      case 'streamable_http':
        config.baseUrl = server.transport.url;
        if (server.transport.headers && Object.keys(server.transport.headers).length > 0) {
          config.headers = server.transport.headers;
        }
        break;
    }

    if (server.description) {
      config.description = server.description;
    }

    // 对于需要持久连接的 MCP server（如 playwright/puppeteer），启用 keep-alive
    if (isKeepAliveServer(server)) {
      config.lifecycle = { mode: 'keep-alive' };
    }

    mcpServers[server.name] = config;
  }

  return { mcpServers };
}

/**
 * 判断是否是需要 keep-alive 的服务器
 * Check if server needs keep-alive lifecycle
 */
function isKeepAliveServer(server: IMcpServer): boolean {
  const keepAlivePatterns = ['playwright', 'mobile-mcp', 'puppeteer', 'browser'];

  const name = server.name.toLowerCase();
  const command = server.transport.type === 'stdio' ? server.transport.command.toLowerCase() : '';

  return keepAlivePatterns.some((pattern) => name.includes(pattern) || command.includes(pattern));
}

/**
 * 从 mcporter 配置转换为 Sudowork 格式
 * Convert mcporter config to Sudowork format
 */
export function convertFromMcporterConfig(config: McporterConfig): Partial<IMcpServer>[] {
  const servers: Partial<IMcpServer>[] = [];

  for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
    const server: Partial<IMcpServer> = {
      id: `mcporter_${name}`,
      name,
      description: serverConfig.description,
      enabled: true,
    };

    if (serverConfig.command) {
      server.transport = {
        type: 'stdio',
        command: serverConfig.command,
        args: serverConfig.args,
        env: serverConfig.env,
      };
    } else if (serverConfig.baseUrl) {
      // 根据 URL 判断是 SSE 还是 HTTP
      const url = serverConfig.baseUrl.toLowerCase();
      const isSse = url.includes('/sse') || url.endsWith('/mcp');

      server.transport = {
        type: isSse ? 'sse' : 'http',
        url: serverConfig.baseUrl,
        headers: serverConfig.headers,
      };
    }

    servers.push(server);
  }

  return servers;
}
