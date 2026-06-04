/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { McpOperationResult } from '../McpProtocol';
import { AbstractMcpAgent } from '../McpProtocol';
import type { IMcpServer } from '@/common/storage';
import { mainLog, mainWarn } from '@process/utils/mainLogger';
import fs from 'fs';
import path from 'path';
import os from 'os';

const TAG = 'ScodeMcpAgent';
const SCODE_DISABLED_MCP_SERVERS = new Set(['chrome-devtools']);

export function getScodeSettingsPath(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getDataPath } = require('@process/utils') as typeof import('@process/utils');
    return path.join(getDataPath(), 'sudocode', 'settings.json');
  } catch {
    return path.join(os.homedir(), '.nexus', 'sudocode', 'settings.json');
  }
}

function isDisabledForScode(serverName: string): boolean {
  return SCODE_DISABLED_MCP_SERVERS.has(serverName);
}

export function removeDisabledMcpServersFromSettings(settings: Record<string, unknown>): boolean {
  const mcpServers = settings.mcpServers as Record<string, unknown> | undefined;
  if (!mcpServers || typeof mcpServers !== 'object') return false;

  let changed = false;
  for (const serverName of SCODE_DISABLED_MCP_SERVERS) {
    if (serverName in mcpServers) {
      delete mcpServers[serverName];
      changed = true;
    }
  }
  if (changed) {
    settings.mcpServers = mcpServers;
  }
  return changed;
}

/**
 * Read existing settings.json, returns empty object on failure.
 */
export function readSettings(): Record<string, unknown> {
  const settingsPath = getScodeSettingsPath();
  try {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
  } catch {
    return {};
  }
}

/**
 * Write settings.json, preserving non-MCP fields.
 */
export function writeSettings(settings: Record<string, unknown>): void {
  const settingsPath = getScodeSettingsPath();
  const dir = path.dirname(settingsPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(settingsPath, 0o600);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Convert an IMcpServer to the scode settings.json mcpServers entry format.
 */
function toScodeServerConfig(server: IMcpServer): Record<string, unknown> | null {
  const transport = server.transport;
  switch (transport.type) {
    case 'stdio':
      return {
        type: 'stdio',
        command: transport.command,
        ...(transport.args?.length ? { args: transport.args } : {}),
        ...(transport.env && Object.keys(transport.env).length ? { env: transport.env } : {}),
      };
    case 'sse':
      return {
        type: 'sse',
        url: transport.url,
        ...(transport.headers && Object.keys(transport.headers).length ? { headers: transport.headers } : {}),
      };
    case 'http':
    case 'streamable_http':
      return {
        type: 'http',
        url: transport.url,
        ...(transport.headers && Object.keys(transport.headers).length ? { headers: transport.headers } : {}),
      };
    default:
      return null;
  }
}

/**
 * Sudo Code (scode) MCP agent implementation.
 * Syncs MCP servers to the active data root's sudocode/settings.json so scode reads them natively.
 */
export class ScodeMcpAgent extends AbstractMcpAgent {
  constructor() {
    super('scode');
  }

  getSupportedTransports(): string[] {
    return ['stdio', 'sse', 'http', 'streamable_http'];
  }

  /**
   * Detect MCP servers currently configured in scode's settings.json.
   */
  detectMcpServers(): Promise<IMcpServer[]> {
    const detectOperation = async () => {
      try {
        const settings = readSettings();
        const mcpServers = settings.mcpServers as Record<string, Record<string, unknown>> | undefined;
        if (!mcpServers || typeof mcpServers !== 'object') {
          return [];
        }

        const result: IMcpServer[] = [];
        for (const [name, config] of Object.entries(mcpServers)) {
          if (isDisabledForScode(name)) continue;
          const type = (config.type as string) || 'stdio';
          const transport: IMcpServer['transport'] =
            type === 'stdio'
              ? {
                  type: 'stdio',
                  command: (config.command as string) || '',
                  args: (config.args as string[]) || [],
                  env: (config.env as Record<string, string>) || {},
                }
              : {
                  type: type as 'sse' | 'http',
                  url: (config.url as string) || '',
                  headers: (config.headers as Record<string, string>) || {},
                };

          result.push({
            id: `scode_${name}`,
            name,
            transport,
            enabled: true,
            status: 'disconnected',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            originalJson: JSON.stringify(config),
          });
        }

        mainLog(TAG, `Detection complete: found ${result.length} server(s)`);
        return result;
      } catch (error) {
        mainWarn(TAG, 'Failed to detect MCP servers:', error);
        return [];
      }
    };

    Object.defineProperty(detectOperation, 'name', { value: 'detectMcpServers' });
    return this.withLock(detectOperation);
  }

  /**
   * Install (sync) MCP servers to scode's settings.json.
   * Only writes enabled servers; merges with existing non-MCP settings.
   */
  installMcpServers(mcpServers: IMcpServer[]): Promise<McpOperationResult> {
    const installOperation = async () => {
      try {
        const settings = readSettings();
        // Merge with existing mcpServers to avoid overwriting servers not in this batch
        const existing = (settings.mcpServers as Record<string, unknown>) || {};
        const mcpConfig: Record<string, unknown> = { ...existing };

        for (const serverName of SCODE_DISABLED_MCP_SERVERS) {
          delete mcpConfig[serverName];
        }

        for (const server of mcpServers) {
          if (isDisabledForScode(server.name)) {
            delete mcpConfig[server.name];
            continue;
          }
          if (!server.enabled) {
            delete mcpConfig[server.name];
            continue;
          }
          const config = toScodeServerConfig(server);
          if (config) {
            mcpConfig[server.name] = config;
          }
        }

        settings.mcpServers = mcpConfig;
        writeSettings(settings);
        mainLog(TAG, `Synced ${Object.keys(mcpConfig).length} MCP server(s) to settings.json`);
        return { success: true };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        mainWarn(TAG, `Failed to sync MCP servers: ${msg}`);
        return { success: false, error: msg };
      }
    };

    Object.defineProperty(installOperation, 'name', { value: 'installMcpServers' });
    return this.withLock(installOperation);
  }

  /**
   * Remove a single MCP server from scode's settings.json.
   */
  removeMcpServer(mcpServerName: string): Promise<McpOperationResult> {
    const removeOperation = async () => {
      try {
        const settings = readSettings();
        const mcpServers = (settings.mcpServers as Record<string, unknown>) || {};
        delete mcpServers[mcpServerName];
        settings.mcpServers = mcpServers;
        writeSettings(settings);
        mainLog(TAG, `Removed MCP server: ${mcpServerName}`);
        return { success: true };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        mainWarn(TAG, `Failed to remove MCP server: ${msg}`);
        return { success: false, error: msg };
      }
    };

    Object.defineProperty(removeOperation, 'name', { value: 'removeMcpServer' });
    return this.withLock(removeOperation);
  }
}
