/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import type { IMcpServer } from '@sudowork/common/storage';
import { mainError, mainLog } from '@process/utils/mainLogger';
import { ProcessConfig } from '@process/initStorage';

/**
 * Migrate the owned webview MCP entry when the app boots. ACP conversations
 * receive the shared worker's authenticated MCP endpoint directly. User-authored
 * servers and customized transports retain their configuration.
 */

const MCP_NAME = 'browser-panel';

/** Resolve the path to the bundled MCP server entry JS in both dev and packaged modes. */
export function getMcpScriptPath(entryName: 'index' | 'shared' = 'index'): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'browser-panel-mcp', `${entryName}.js`);
  }
  // Dev mode: try compiled JS first, fall back to source
  const compiledPath = path.join(app.getAppPath(), 'resources', 'browser-panel-mcp', `${entryName}.js`);
  if (fs.existsSync(compiledPath)) return compiledPath;
  return path.join(app.getAppPath(), 'resources', 'browser-panel-mcp', 'src', `${entryName}.ts`);
}

/**
 * Retire only an identifiable app-owned webview registration.
 */
export async function ensureBrowserPanelMcpRegistered(): Promise<void> {
  try {
    const config: IMcpServer[] = (await ProcessConfig.get('mcp.config')) || [];
    const retained = config.filter((entry) => !(entry.name === MCP_NAME && entry.id.startsWith(`mcp_builtin_${MCP_NAME}_`) && entry.transport.type === 'stdio' && /[\\/]browser-panel-mcp[\\/]index\.(js|ts)$/.test(entry.transport.args?.[0] || '')));
    if (retained.length === config.length) return;
    await ProcessConfig.set('mcp.config', retained);
    mainLog('BrowserPanelMcp', 'retired owned webview registration; conversations use the shared browser worker');
  } catch (err) {
    mainError('BrowserPanelMcp', `legacy registration migration failed: ${String(err)}`);
  }
}
