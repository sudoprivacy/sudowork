/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { getNodeBinaryPath } from '@process/services/claudeCli/NodeRuntimeService';
import { mainError, mainLog, mainWarn } from '@process/utils/mainLogger';
import { ProcessConfig } from '@process/initStorage';
import type { IMcpServer } from '@/common/storage';

/**
 * Register the browser-panel MCP server into Sudowork's unified MCP config
 * (ProcessConfig 'mcp.config'). This makes it available to ALL agent backends
 * (scode, claude, gemini, etc.) via the existing syncMcpToAgents mechanism.
 *
 * Replaces the old approach of hardcoding into Claude Code's config via
 * `claude mcp add`, which only worked for CC and bypassed Sudowork's MCP
 * management layer.
 *
 * Lifecycle:
 *  - Called once per app boot (idempotent)
 *  - Adds/updates browser-panel entry in mcp.config if missing or stale
 *  - Errors are logged but never re-thrown — must not block startup
 */

const MCP_NAME = 'browser-panel';

/** Resolve the path to the bundled MCP server entry JS in both dev and packaged modes. */
function getMcpScriptPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'browser-panel-mcp', 'index.js');
  }
  // Dev mode: try compiled JS first, fall back to source
  const compiledPath = path.join(app.getAppPath(), 'resources', 'browser-panel-mcp', 'index.js');
  if (fs.existsSync(compiledPath)) return compiledPath;
  return path.join(app.getAppPath(), 'resources', 'browser-panel-mcp', 'src', 'index.ts');
}

/**
 * Ensure the browser-panel MCP server is registered in Sudowork's mcp.config.
 * Idempotent and non-throwing — safe to call from startup paths.
 */
export async function ensureBrowserPanelMcpRegistered(): Promise<void> {
  try {
    const scriptPath = getMcpScriptPath();
    if (!fs.existsSync(scriptPath)) {
      mainWarn('BrowserPanelMcp', `bundled MCP script not found at ${scriptPath} — skipping registration`);
      return;
    }
    const nodePath = getNodeBinaryPath();
    if (!fs.existsSync(nodePath)) {
      mainWarn('BrowserPanelMcp', `bundled node not found at ${nodePath} — skipping registration`);
      return;
    }

    const mcpConfig: IMcpServer[] = (await ProcessConfig.get('mcp.config').catch((): undefined => undefined)) || [];

    // Check if browser-panel already exists with correct config
    const existing = mcpConfig.find((s) => s.name === MCP_NAME);
    if (existing) {
      const transport = existing.transport;
      if (transport.type === 'stdio' && transport.command === nodePath && transport.args?.[0] === scriptPath) {
        mainLog('BrowserPanelMcp', 'already registered with correct config');
        return;
      }
      // Update stale entry
      mainLog('BrowserPanelMcp', 'updating stale entry');
      existing.transport = { type: 'stdio', command: nodePath, args: [scriptPath] };
      // Preserve user's enabled/disabled choice on update
      await ProcessConfig.set('mcp.config', mcpConfig);
      mainLog('BrowserPanelMcp', 'registration updated');
      return;
    }

    // Add new entry
    const now = Date.now();
    const newServer: IMcpServer = {
      id: `mcp_builtin_${MCP_NAME}_${now}`,
      name: MCP_NAME,
      description: 'Open URLs in the right-side panel visible to the user. Use for demos, previews, and login flows where the user needs to see or interact with the page.',
      enabled: false,
      transport: { type: 'stdio', command: nodePath, args: [scriptPath] },
      createdAt: now,
      updatedAt: now,
      originalJson: '',
    };

    mcpConfig.push(newServer);
    await ProcessConfig.set('mcp.config', mcpConfig);
    mainLog('BrowserPanelMcp', 'registered as builtin MCP server');
  } catch (err) {
    mainError('BrowserPanelMcp', `registration failed: ${String(err)}`);
  }
}
