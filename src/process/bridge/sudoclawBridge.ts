/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { SudoclawConfig } from '@/common/ipcBridge';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import WorkerManage from '../WorkerManage';
import { SUDOCLAW_DIR, getSudoclawCliPath, SUDOCLAW_DEFAULT_PORT } from '../services/sudoclaw/SudoclawInstallService';
import { OpenClawGatewayManager } from '@/agent/openclaw';
import * as net from 'node:net';

const CONFIG_FILENAME = 'openclaw.json';
const CONFIG_PATH = path.join(SUDOCLAW_DIR, CONFIG_FILENAME);
const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');

function readConfig(): SudoclawConfig | null {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return null;
    const content = fs.readFileSync(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(content) as SudoclawConfig;
    return parsed;
  } catch {
    return null;
  }
}

function mergeConfig(existing: SudoclawConfig | null, patch: SudoclawConfig): SudoclawConfig {
  const base = existing ? JSON.parse(JSON.stringify(existing)) : {};
  if ('lastRunMode' in base) delete base.lastRunMode;
  if (patch.agents?.defaults) {
    base.agents = base.agents || {};
    base.agents.defaults = { ...base.agents.defaults, ...patch.agents.defaults };
    if (patch.agents.defaults.model) {
      base.agents.defaults.model = { ...base.agents?.defaults?.model, ...patch.agents.defaults.model };
    }
  }
  if (patch.models) {
    base.models = base.models || {};
    if (patch.models.mode !== undefined) base.models.mode = patch.models.mode;
    if (patch.models.providers) {
      // Ensure each provider has models as array (not undefined)
      const providersWithModels: typeof patch.models.providers = {};
      for (const [key, prov] of Object.entries(patch.models.providers)) {
        providersWithModels[key] = {
          ...prov,
          models: prov.models ?? [],
        };
      }
      base.models.providers = providersWithModels;
    }
  }
  return base;
}

/**
 * Sync sudorouter provider config to ~/.claude/settings.json for Claude CLI
 * Only writes if settings.json doesn't exist yet.
 * Only apiKey is configurable, baseUrl and model are fixed.
 */
function syncToClaudeSettings(config: SudoclawConfig): void {
  // Skip if settings.json already exists
  if (fs.existsSync(CLAUDE_SETTINGS_PATH)) {
    return;
  }

  const sudorouter = config.models?.providers?.sudorouter;
  if (!sudorouter) return;

  const apiKey = sudorouter.apiKey || '';
  const primaryModel = config.agents?.defaults?.model?.primary || '';
  const modelId = primaryModel.startsWith('sudorouter/') ? primaryModel.slice('sudorouter/'.length) : primaryModel;

  // Create new settings with fixed values
  const settings: Record<string, unknown> = {
    env: {
      ANTHROPIC_BASE_URL: 'https://hk.sudorouter.ai',
      ANTHROPIC_AUTH_TOKEN: apiKey,
      ANTHROPIC_MODEL: modelId || 'gemini-3-flash-preview',
    },
  };

  // Write
  const claudeDir = path.dirname(CLAUDE_SETTINGS_PATH);
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8');
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(CLAUDE_SETTINGS_PATH, 0o600);
    } catch {
      // ignore
    }
  }
}

export function initSudoclawBridge(): void {
  ipcBridge.sudoclaw.getConfig.provider(async () => {
    try {
      const config = readConfig();
      return { success: true, data: config };
    } catch (err) {
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcBridge.sudoclaw.saveConfig.provider(async ({ config }) => {
    try {
      fs.mkdirSync(SUDOCLAW_DIR, { recursive: true });
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
      if (process.platform !== 'win32') {
        try {
          fs.chmodSync(CONFIG_PATH, 0o600);
        } catch {
          // ignore
        }
      }

      // Sync to ~/.claude/settings.json for Claude CLI
      syncToClaudeSettings(config);

      return { success: true };
    } catch (err) {
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcBridge.sudoclaw.getStatus.provider(async () => {
    try {
      const installed = getSudoclawCliPath() !== null;
      const config = readConfig();

      // First, check if gateway port is listening
      const port = SUDOCLAW_DEFAULT_PORT;
      const host = '127.0.0.1';
      const isGatewayRunning = await new Promise<boolean>((resolve) => {
        const socket = net.createConnection({ host, port });
        socket.on('connect', () => {
          socket.destroy();
          resolve(true);
        });
        socket.on('error', () => {
          socket.destroy();
          resolve(false);
        });
        socket.setTimeout(500);
        socket.on('timeout', () => {
          socket.destroy();
          resolve(false);
        });
      });

      const data: any = {
        installed,
        configPath: CONFIG_PATH,
        gatewayRunning: isGatewayRunning,
        gatewayPort: port,
        gatewayHost: host,
        gatewayUrl: `ws://${host}:${port}`,
        isConnected: isGatewayRunning,
        hasActiveSession: false,
        sessionKey: null,
        workspace: config?.agents?.defaults?.workspace || SUDOCLAW_DIR + '/workspace',
        agentName: (config?.agents as any)?.defaults?.agentName || '小宇',
        model: config?.agents?.defaults?.model?.primary || null,
      };

      // Try to enhance with runtime status from active tasks
      try {
        const openclawTasks = WorkerManage.listTasks().filter((t) => t.type === 'openclaw-gateway');

        if (openclawTasks.length > 0) {
          const task = WorkerManage.getTaskById(openclawTasks[0].id) as any;
          if (task && typeof task.getDiagnostics === 'function') {
            const diagnostics = task.getDiagnostics();

            data.gatewayRunning = true;
            data.gatewayPort = diagnostics.gatewayPort || port;
            data.gatewayHost = diagnostics.gatewayHost || host;
            data.gatewayUrl = `ws://${data.gatewayHost}:${data.gatewayPort}`;
            data.isConnected = diagnostics.isConnected ?? isGatewayRunning;
            data.hasActiveSession = diagnostics.hasActiveSession ?? false;
            data.sessionKey = diagnostics.sessionKey || null;
            // Use runtime diagnostics if available (more accurate than config)
            data.workspace = diagnostics.workspace || data.workspace;
            data.agentName = diagnostics.agentName || data.agentName;
            data.model = diagnostics.model || data.model;
          }
        }
      } catch (innerErr) {
        console.warn('[SudoclawBridge] getStatus inner failed:', innerErr);
      }

      return { success: true, data };
    } catch (err) {
      console.error('[SudoclawBridge] getStatus failed:', err);
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcBridge.sudoclaw.testGateway.provider(async () => {
    const testPort = SUDOCLAW_DEFAULT_PORT;
    const manager = new OpenClawGatewayManager({
      port: testPort,
      stateDir: SUDOCLAW_DIR,
      customEnv: { OPENCLAW_STATE_DIR: SUDOCLAW_DIR },
      forceSubprocessGateway: true,
    });

    let stdout = '';
    let stderr = '';
    manager.on('stdout', (d) => {
      stdout += d;
    });
    manager.on('stderr', (d) => {
      stderr += d;
    });

    try {
      const port = await manager.start();
      // Test successful - shut down immediately as requested
      await manager.stop();
      return { success: true, data: { success: true, port, stdout, stderr } };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await manager.stop().catch(() => {});
      return {
        success: true,
        data: { success: false, error: msg, stdout, stderr },
      };
    }
  });

  ipcBridge.sudoclaw.restartGateway.provider(async () => {
    try {
      await WorkerManage.restartOpenClawGateways();
      return { success: true };
    } catch (err) {
      console.error('[SudoclawBridge] Restart gateway failed:', err);
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
    }
  });
}
