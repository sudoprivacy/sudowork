/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { SudoclawConfig } from '@/common/ipcBridge';
import { cachePut } from '@common/nexus/secret-cache';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import WorkerManage from '../WorkerManage';
import { getSudoclawDir, getSudoclawConfigPath, getSudoclawInstalledVersion, isSudoclawInstalled, SUDOCLAW_DEFAULT_PORT, installSudoclawManually, removeSudoclawCli } from '../services/sudoclaw/SudoclawInstallService';
import { syncSudoclawRuntimeState } from '../services/sudoclaw/sudoclawRuntimeSync';
import { checkSudoclawHealth, SUDOCLAW_HEALTH_TIMEOUT_MS } from '../services/sudoclaw/sudoclawHealth';
import { getNodeBinaryPath } from '../services/claudeCli/NodeRuntimeService';
import { mainError, mainLog, mainWarn } from '../utils/mainLogger';

interface InstallState {
  installing: boolean;
  phase?: 'extracting' | 'installing' | 'configuring';
  percent?: number;
}

const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');
let installState: InstallState = { installing: false };

function readConfig(): SudoclawConfig | null {
  try {
    const configPath = getSudoclawConfigPath();
    if (!fs.existsSync(configPath)) return null;
    const content = fs.readFileSync(configPath, 'utf8');
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

  const primaryModel = config.agents?.defaults?.model?.primary || '';
  const [providerId, modelIdPart] = primaryModel.split('/');
  const provider = providerId ? config.models?.providers?.[providerId] : undefined;
  const apiKey = provider?.apiKey || '';
  const modelId = modelIdPart || primaryModel;

  if (!apiKey) return;

  // Create new settings with fixed values
  const settings: Record<string, unknown> = {
    env: {
      ANTHROPIC_BASE_URL: 'https://hk.sudorouter.ai',
      ANTHROPIC_AUTH_TOKEN: apiKey,
      ANTHROPIC_MODEL: modelId || 'gemini-3.5-flash',
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
      const sudoclawDir = getSudoclawDir();
      const configPath = getSudoclawConfigPath();
      fs.mkdirSync(sudoclawDir, { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
      if (process.platform !== 'win32') {
        try {
          fs.chmodSync(configPath, 0o600);
        } catch {
          // ignore
        }
      }

      syncSudoclawRuntimeState(config, {
        stateDir: sudoclawDir,
        claudeSettingsPath: CLAUDE_SETTINGS_PATH,
        secretWriter: cachePut,
      });

      // Sync to ~/.claude/settings.json for Claude CLI
      syncToClaudeSettings(config);

      return { success: true };
    } catch (err) {
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcBridge.sudoclaw.getStatus.provider(async () => {
    try {
      const installed = isSudoclawInstalled();
      const version = installed ? getSudoclawInstalledVersion() : undefined;
      const config = readConfig();

      const port = SUDOCLAW_DEFAULT_PORT;
      const host = '127.0.0.1';
      const isGatewayRunning = await checkSudoclawHealth(host, port, SUDOCLAW_HEALTH_TIMEOUT_MS);

      const data: any = {
        installed,
        configPath: getSudoclawConfigPath(),
        gatewayRunning: isGatewayRunning,
        gatewayPort: port,
        gatewayHost: host,
        gatewayUrl: `ws://${host}:${port}`,
        isConnected: isGatewayRunning,
        hasActiveSession: false,
        sessionKey: null,
        workspace: (config?.agents as any)?.defaults?.workspace || `${getSudoclawDir()}/workspace`,
        agentName: (config?.agents as any)?.defaults?.agentName || '小宇',
        model: (config?.agents as any)?.defaults?.model?.primary || null,
        version,
      };

      return { success: true, data };
    } catch (err) {
      mainError('SudoclawBridge', 'getStatus failed', err);
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcBridge.sudoclaw.getInstallState.provider(async () => {
    return { success: true, data: installState };
  });

  ipcBridge.sudoclaw.testGateway.provider(async () => {
    const testPort = SUDOCLAW_DEFAULT_PORT;
    const host = '127.0.0.1';

    const isRunning = await checkSudoclawHealth(host, testPort, SUDOCLAW_HEALTH_TIMEOUT_MS);

    if (isRunning) {
      mainLog('SudoclawBridge', 'Gateway running, connection test passed');
      return { success: true, data: { success: true, port: testPort, stdout: 'Connection OK', stderr: '' } };
    } else {
      mainLog('SudoclawBridge', 'Gateway not running');
      return { success: true, data: { success: false, error: 'Gateway is not running. Please start Sudoclaw first.', stdout: '', stderr: '' } };
    }
  });

  ipcBridge.sudoclaw.restartGateway.provider(async () => {
    try {
      const { serviceManager } = await import('../services/serviceManager');
      await serviceManager.restartSudoclaw();
      return { success: true };
    } catch (err) {
      mainError('SudoclawBridge', 'Restart gateway failed', err);
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcBridge.sudoclaw.startGateway.provider(async () => {
    try {
      const { serviceManager } = await import('../services/serviceManager');
      await serviceManager.startSudoclaw();
      return { success: true };
    } catch (err) {
      mainError('SudoclawBridge', 'Start gateway failed', err);
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcBridge.sudoclaw.stopGateway.provider(async () => {
    try {
      const { serviceManager } = await import('../services/serviceManager');
      await serviceManager.stopSudoclaw();
      return { success: true };
    } catch (err) {
      mainError('SudoclawBridge', 'Stop gateway failed', err);
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcBridge.sudoclaw.uninstall.provider(async () => {
    try {
      // Stop gateway first
      const { serviceManager } = await import('../services/serviceManager');
      await serviceManager.stopSudoclaw();
    } catch {
      // Ignore stop errors
    }
    try {
      if (fs.existsSync(getSudoclawDir())) {
        removeSudoclawCli();
      }
      return { success: true };
    } catch (err) {
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcBridge.sudoclaw.install.provider(async () => {
    return new Promise((resolve) => {
      void (async () => {
        installState = { installing: true };
        try {
          mainLog('SudoclawBridge', 'Starting Sudoclaw installation...');

          // Run installation with progress callback
          await installSudoclawManually((phase, percent) => {
            installState = { installing: true, phase, percent };
            ipcBridge.sudoclaw.installProgress.emit({ phase, percent });
          });

          mainLog('SudoclawBridge', 'Sudoclaw installation completed, starting gateway...');
          const { serviceManager } = await import('../services/serviceManager');
          await serviceManager.startSudoclaw();
          mainLog('SudoclawBridge', 'Sudoclaw gateway started successfully after install');
          resolve({ success: true });

          setTimeout(() => {
            ipcBridge.sudoclaw.installResult.emit({ success: true });
          }, 100);
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          mainError('SudoclawBridge', 'Sudoclaw installation failed', err);
          resolve({ success: false, msg: errorMsg });

          setTimeout(() => {
            ipcBridge.sudoclaw.installResult.emit({ success: false, msg: errorMsg });
          }, 100);
        } finally {
          installState = { installing: false };
        }
      })();
    });
  });

  // ==================== WeChat Plugin ====================

  const getSudoclawWechatPluginDir = (): string => path.join(getSudoclawDir(), 'extensions', 'openclaw-weixin');

  ipcBridge.sudoclaw.getWechatStatus.provider(async () => {
    try {
      const installed = fs.existsSync(path.join(getSudoclawWechatPluginDir(), 'openclaw.plugin.json'));
      return { success: true, data: { installed } };
    } catch (err) {
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcBridge.sudoclaw.installWechatPlugin.provider(async () => {
    return new Promise((resolve) => {
      // Check if already installed
      if (fs.existsSync(path.join(getSudoclawWechatPluginDir(), 'openclaw.plugin.json'))) {
        ipcBridge.sudoclaw.wechatInstallProgress.emit({ phase: 'success', message: '微信插件已安装' });
        resolve({ success: true, data: { output: 'Already installed' } });
        return;
      }

      const nodePath = getNodeBinaryPath();
      if (!fs.existsSync(nodePath)) {
        const msg = 'Bundled Node.js not found. Please restart Sudowork to install it.';
        ipcBridge.sudoclaw.wechatInstallProgress.emit({ phase: 'error', message: msg });
        resolve({ success: false, msg });
        return;
      }

      mainLog('SudoclawBridge', 'Starting WeChat plugin installation...');
      ipcBridge.sudoclaw.wechatInstallProgress.emit({ phase: 'installing', message: '正在安装微信插件...' });

      // Prepend sudoclaw bin to PATH so CLI finds sudoclaw's openclaw and installs to ~/.nexus/sudoclaw/
      const sudoclawBinDir = path.join(getSudoclawDir(), 'bin');
      const env: Record<string, string> = {
        ...Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined) as [string, string][]),
        PATH: `${sudoclawBinDir}:${path.dirname(nodePath)}:${process.env.PATH || ''}`,
      };

      const npxPath = path.join(path.dirname(nodePath), 'npx');
      const child = spawn(nodePath, [npxPath, '-y', '@tencent-weixin/openclaw-weixin-cli@latest', 'install'], {
        env,
        cwd: getSudoclawDir(),
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let allOutput = '';
      let qrDetected = false;
      let qrDataLastEmitted = 0;
      let qrUrl = '';

      const processOutput = (data: Buffer) => {
        const text = data.toString();
        allOutput += text;
        mainLog('SudoclawBridge', `CLI output chunk: ${text.substring(0, 100).replace(/\n/g, '\\n')}`);

        // Detect QR code URL from CLI output — look for multiple markers
        if (!qrUrl) {
          // Try to extract URL directly
          const urlMatch = allOutput.match(/(https:\/\/liteapp\.weixin\.qq\.com\/q\/[^\s\n]+)/);
          if (urlMatch) {
            qrUrl = urlMatch[1];
            qrDetected = true;
            mainLog('SudoclawBridge', `QR URL extracted: ${qrUrl}`);
            // Immediately emit once we have the URL
            ipcBridge.sudoclaw.wechatInstallProgress.emit({
              phase: 'qrcode',
              message: '请使用微信扫描二维码',
              qrUrl,
            });
          }
        }

        // Re-emit periodically while waiting for scan (keep UI updated)
        if (qrDetected && qrUrl && Date.now() - qrDataLastEmitted > 1000) {
          qrDataLastEmitted = Date.now();
          ipcBridge.sudoclaw.wechatInstallProgress.emit({
            phase: 'qrcode',
            message: '请使用微信扫描二维码',
            qrUrl,
          });
        }

        // Detect success
        if (text.includes('✅') || text.includes('连接成功') || text.includes('与微信连接成功')) {
          ipcBridge.sudoclaw.wechatInstallProgress.emit({ phase: 'scanning', message: '扫码成功' });
        }
      };

      child.stdout.on('data', processOutput);
      child.stderr.on('data', processOutput);

      child.on('close', async (code) => {
        if (code === 0) {
          ipcBridge.sudoclaw.wechatInstallProgress.emit({ phase: 'success', message: '微信插件安装成功' });
          resolve({ success: true, data: { output: allOutput } });

          try {
            const { serviceManager } = await import('../services/serviceManager');
            await serviceManager.restartSudoclaw();
            mainLog('SudoclawBridge', 'Gateway restarted after WeChat plugin install');
          } catch (restartErr) {
            mainWarn('SudoclawBridge', 'Gateway restart after WeChat install failed', restartErr);
          }
        } else {
          const errMsg = `WeChat plugin install failed (exit code ${code})`;
          ipcBridge.sudoclaw.wechatInstallProgress.emit({ phase: 'error', message: errMsg });
          resolve({ success: false, msg: errMsg });
        }
      });

      child.on('error', (err) => {
        const errMsg = err instanceof Error ? err.message : String(err);
        mainError('SudoclawBridge', 'WeChat plugin install error', err);
        ipcBridge.sudoclaw.wechatInstallProgress.emit({ phase: 'error', message: errMsg });
        resolve({ success: false, msg: errMsg });
      });

      // Timeout after 5 minutes
      const timeout = setTimeout(
        () => {
          if (!child.killed) {
            child.kill('SIGTERM');
            const msg = 'WeChat plugin installation timed out (5 min)';
            ipcBridge.sudoclaw.wechatInstallProgress.emit({ phase: 'error', message: msg });
            resolve({ success: false, msg });
          }
        },
        5 * 60 * 1000
      );

      child.on('close', () => clearTimeout(timeout));
    });
  });
}
