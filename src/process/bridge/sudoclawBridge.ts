/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { SudoclawConfig } from '@/common/ipcBridge';
import * as fs from 'fs';
import * as path from 'path';
import WorkerManage from '../WorkerManage';
import { SUDOCLAW_DIR, getSudoclawCliPath, getSudoclawCliPathAlways } from '../services/sudoclaw/SudoclawInstallService';
import { OpenClawGatewayManager } from '@/agent/openclaw';

const CONFIG_FILENAME = 'openclaw.json';
const CONFIG_PATH = path.join(SUDOCLAW_DIR, CONFIG_FILENAME);

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
      base.models.providers = patch.models.providers;
    }
  }
  return base;
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

  ipcBridge.sudoclaw.saveConfig.provider(async ({ config: patch }) => {
    try {
      fs.mkdirSync(SUDOCLAW_DIR, { recursive: true });
      const existing = readConfig();
      const merged = mergeConfig(existing, patch);
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), 'utf8');
      if (process.platform !== 'win32') {
        try {
          fs.chmodSync(CONFIG_PATH, 0o600);
        } catch {
          // ignore
        }
      }
      await WorkerManage.restartOpenClawGateways();
      return { success: true };
    } catch (err) {
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcBridge.sudoclaw.getStatus.provider(async () => {
    try {
      const installed = getSudoclawCliPath() !== null;
      return { success: true, data: { installed, configPath: CONFIG_PATH } };
    } catch (err) {
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcBridge.sudoclaw.testGateway.provider(async () => {
    const cliPath = getSudoclawCliPathAlways();
    const testPort = 18799;
    const manager = new OpenClawGatewayManager({
      cliPath,
      port: testPort,
      stateDir: SUDOCLAW_DIR,
      customEnv: { OPENCLAW_STATE_DIR: SUDOCLAW_DIR },
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
}
