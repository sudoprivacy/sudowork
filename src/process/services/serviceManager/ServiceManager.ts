/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { app } from 'electron';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import { mainLog, mainError, mainWarn } from '@process/utils/mainLogger';
import { initStatusManager } from '../initStatus';
import { isSudoclawHealthPayload, type SudoclawHealthPayload } from '../sudoclaw/sudoclawHealth';
import { runtimeInstaller } from './RuntimeInstaller';

type OpenClawGateway = import('@/agent/openclaw/OpenClawGatewayManager').OpenClawGatewayManager;

type SudoclawHealthCheckResult = {
  healthy: boolean;
  statusCode?: number;
  body?: string;
  payload?: SudoclawHealthPayload;
  error?: string;
};

/**
 * Centralised service lifecycle manager.
 *
 * Owns the startup / shutdown of Nexus, the OpenClaw gateway, and the
 * SafetyPollingService.  All runtime-install logic that was previously
 * scattered across process/index.ts helpers is consolidated here.
 */
class ServiceManager {
  private gateway: OpenClawGateway | null = null;
  private startupInProgress = false;
  private readonly STARTUP_READINESS_TIMEOUT_MS = 600_000;
  private readonly STARTUP_READINESS_POLL_MS = 500;
  private readonly SUDOCLAW_START_TIMEOUT_MS = 90_000;
  private readonly SUDOCLAW_START_ATTEMPTS = 3;
  private readonly NEXUS_START_ATTEMPTS = 3;

  // Deferred promise resolved when the gateway is ready (or failed).
  private gatewayReadyResolve: ((value: { host: string; port: number } | null) => void) | null = null;
  private gatewayReadyPromise: Promise<{ host: string; port: number } | null> | null = null;

  private buildSudoclawStartDiagnostics(lastHealth: SudoclawHealthCheckResult): {
    launchCommand: ReturnType<OpenClawGateway['getLastLaunchCommand']>;
    lastHealth: SudoclawHealthCheckResult;
    recentStdout: string;
    recentStderr: string;
  } {
    const launchCommand = this.gateway?.getLastLaunchCommand();
    const recentOutput = this.gateway?.getRecentOutput();
    return {
      launchCommand,
      lastHealth,
      recentStdout: recentOutput?.stdout || '',
      recentStderr: recentOutput?.stderr || '',
    };
  }

  private isRetryableStartupExitError(error: unknown, component: 'sudoclaw' | 'nexus'): boolean {
    const message = error instanceof Error ? error.message : String(error);

    if (component === 'nexus') {
      return message.includes('nexusd exited before becoming ready');
    }

    return message.includes('Sudoclaw gateway exited before becoming healthy') || message.includes('Gateway exited with code');
  }

  // ────────────────────────────────────────────────────────────────────────────
  //  startup — fire-and-forget from process/index.ts
  // ────────────────────────────────────────────────────────────────────────────

  async startup(): Promise<void> {
    if (this.startupInProgress) {
      return;
    }

    this.startupInProgress = true;
    runtimeInstaller.primeStatusForStartup();
    initStatusManager.clearRetry();

    if (initStatusManager.getStatus().displayMode === 'startup') {
      initStatusManager.setStatus('installing', '正在启动核心服务...', 90);
      initStatusManager.setDetail('正在检查 Sudoclaw 与 Nexus 服务状态...');
    }

    try {
      const ok = await runtimeInstaller.ensureAll({
        startSudoclaw: this.startOpenClawForStartup.bind(this),
        startNexus: this.startNexusForStartup.bind(this),
      });
      if (!ok) {
        const failureReason = initStatusManager.getStatus().error || '运行时组件安装未完成';
        throw new Error(failureReason);
      }
      initStatusManager.setStatus('installing', '正在校验组件状态...', 98);
      await this.verifyStartupReadiness();
      initStatusManager.setStatus('ready', '初始化完成', 100);
      initStatusManager.clearRetry();
      void this.startSafetyPolling();

      // Start health monitor for auto-healing components
      const { componentHealthMonitor } = await import('./ComponentHealthMonitor');
      void componentHealthMonitor.start();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      initStatusManager.setStatus('error', '初始化失败', 0, message);
      initStatusManager.clearRetry();
      initStatusManager.setDetail('核心服务启动失败，请手动点击重试或重装。');
      initStatusManager.addLog(`⚠ 启动失败：${message}`);
      mainError('ServiceManager', 'Startup readiness verification failed', err);
    } finally {
      this.startupInProgress = false;
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  //  shutdown — called from before-quit
  // ────────────────────────────────────────────────────────────────────────────

  async shutdown(): Promise<void> {
    await this.stopOpenClaw();
    try {
      const { dynamicNexusService } = await import('../nexus/DynamicNexusService');
      await dynamicNexusService.stop();
    } catch {
      /* ignore */
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  //  Nexus
  // ────────────────────────────────────────────────────────────────────────────

  async startNexus(): Promise<void> {
    await this.startNexusOnce();
  }

  private async startNexusForStartup(): Promise<void> {
    if (initStatusManager.getStatus().displayMode === 'startup') {
      await this.preparePortForStart(12012, 'Nexus');
      await this.startNexusOnce();
      return;
    }

    await this.startNexusWithRetries();
  }

  private async startNexusWithRetries(): Promise<void> {
    const { dynamicNexusService } = await import('../nexus/DynamicNexusService');

    const startAttempts = async (attempts: number, phase: 'normal' | 'reinstall'): Promise<void> => {
      let lastError: unknown;

      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          await this.preparePortForStart(12012, 'Nexus');
          const startupDetail =
            attempt > 1
              ? phase === 'reinstall'
                ? `重装后正在启动 Nexus 服务（第 ${attempt}/${attempts} 次）...`
                : `正在启动 Nexus 服务（第 ${attempt}/${attempts} 次）...`
              : phase === 'reinstall'
                ? '重装后正在启动 Nexus 服务...'
                : '正在启动 Nexus 服务...';
          initStatusManager.setStepState('nexus', 'active', startupDetail);
          initStatusManager.setStepProgress('nexus', 92, initStatusManager.getStatus().stepDetails?.nexus);
          await this.startNexusOnce();
          return;
        } catch (err) {
          lastError = err;
          mainError('ServiceManager', `Nexus startup attempt ${attempt}/${attempts} failed`, err);
          initStatusManager.addLog(`⚠ Nexus 启动失败（第 ${attempt}/${attempts} 次）: ${err instanceof Error ? err.message : String(err)}`);

          const shouldRetry = this.isRetryableStartupExitError(err, 'nexus') && attempt < attempts;
          if (!shouldRetry) {
            throw err;
          }

          initStatusManager.addLog(`↻ Nexus 进程已退出，准备重试启动（第 ${attempt + 1}/${attempts} 次）...`);
          await dynamicNexusService.stop().catch(() => {});
          await this.killProcessesOnPort(12012, 'Nexus');
        }
      }

      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    };

    await startAttempts(this.NEXUS_START_ATTEMPTS, 'normal');
  }

  private async startNexusOnce(): Promise<void> {
    try {
      const { dynamicNexusService } = await import('../nexus/DynamicNexusService');

      if (!(await dynamicNexusService.checkInstalled())) {
        throw new Error('Nexus runtime is missing after startup installation');
      }

      const versionState = await dynamicNexusService.getVersionState();
      if (versionState.needsUpgrade) {
        mainLog('ServiceManager', `Upgrading Nexus before start: installed=${versionState.installedVersion} bundled=${versionState.bundledVersion}`);
        await dynamicNexusService.install();
      }
      mainLog('ServiceManager', 'Starting Nexus service...');
      const launchCommand = dynamicNexusService.getStartCommandPreview();
      initStatusManager.addLog(`[Nexus] Start command: ${launchCommand.command} ${launchCommand.args.join(' ')}`);
      initStatusManager.addLog('[Nexus] Starting Nexus service...');
      await dynamicNexusService.start();
      // start() already waits until /health reports healthy before resolving.
      // Do not immediately probe again here; a duplicate one-shot check can race
      // with post-start stabilization and incorrectly flip the UI back to failed.
      initStatusManager.addLog(`[Nexus] Nexus service is healthy on http://127.0.0.1:${dynamicNexusService.port}`);
      initStatusManager.setStepProgress('nexus', 100, 'Nexus 服务已就绪');
    } catch (err) {
      mainError('ServiceManager', 'Failed to start Nexus', err);
      throw err;
    }
  }

  async stopNexus(): Promise<void> {
    try {
      const { dynamicNexusService } = await import('../nexus/DynamicNexusService');
      mainLog('ServiceManager', 'Stopping Nexus service...');
      await dynamicNexusService.stop();
      mainLog('ServiceManager', 'Nexus service stopped');
    } catch (err) {
      mainError('ServiceManager', 'Failed to stop Nexus', err);
      throw err;
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  //  OpenClaw gateway
  // ────────────────────────────────────────────────────────────────────────────

  async startOpenClaw(): Promise<void> {
    await this.startOpenClawOnce();
  }

  private async startOpenClawForStartup(_timeoutMs = this.SUDOCLAW_START_TIMEOUT_MS): Promise<void> {
    if (initStatusManager.getStatus().displayMode === 'startup') {
      await this.preparePortForStart(17863, 'Sudoclaw');
      await this.startOpenClawOnce();
      return;
    }

    await this.startOpenClawWithRetries();
  }

  private async startOpenClawWithRetries(): Promise<void> {
    const startAttempts = async (attempts: number, phase: 'normal' | 'reinstall'): Promise<void> => {
      let lastError: unknown;

      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          await this.preparePortForStart(17863, 'Sudoclaw');
          const startupDetail =
            attempt > 1
              ? phase === 'reinstall'
                ? `重装后正在启动 Sudoclaw 服务（第 ${attempt}/${attempts} 次）...`
                : `正在启动 Sudoclaw 服务（第 ${attempt}/${attempts} 次）...`
              : phase === 'reinstall'
                ? '重装后正在启动 Sudoclaw 服务...'
                : '正在启动 Sudoclaw 服务...';
          initStatusManager.setStepState('sudoclaw', 'active', startupDetail);
          initStatusManager.setStepProgress('sudoclaw', 92, initStatusManager.getStatus().stepDetails?.sudoclaw);
          await this.startOpenClawOnce();
          return;
        } catch (err) {
          lastError = err;
          mainError('ServiceManager', `Sudoclaw startup attempt ${attempt}/${attempts} failed`, err);
          initStatusManager.addLog(`⚠ Sudoclaw 启动失败（第 ${attempt}/${attempts} 次）: ${err instanceof Error ? err.message : String(err)}`);

          const shouldRetry = this.isRetryableStartupExitError(err, 'sudoclaw') && attempt < attempts;
          if (!shouldRetry) {
            throw err;
          }

          initStatusManager.addLog(`↻ Sudoclaw 进程已退出，准备重试启动（第 ${attempt + 1}/${attempts} 次）...`);
          await this.stopOpenClaw();
        }
      }

      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    };

    await startAttempts(this.SUDOCLAW_START_ATTEMPTS, 'normal');
  }

  private async startOpenClawOnce(): Promise<void> {
    // Create a deferred promise so agents can await gateway readiness.
    this.gatewayReadyPromise = new Promise<{ host: string; port: number } | null>((resolve) => {
      this.gatewayReadyResolve = resolve;
    });

    try {
      mainLog('ServiceManager', 'Starting Sudoclaw gateway...');
      const { OpenClawGatewayManager } = await import('@/agent/openclaw');
      const { SUDOCLAW_DIR, SUDOCLAW_DEFAULT_PORT, SUDOCLAW_CONFIG_PATH, repairOpenClawConfig, getSudoclawVersionState, ensureSudoclawInstalled, ensureUserMdSafetyRules } = await import('../sudoclaw/SudoclawInstallService');
      await this.ensureNodeReadyForSudoclawStart();

      const versionState = getSudoclawVersionState();
      if (app.isPackaged && versionState.needsUpgrade) {
        mainLog('ServiceManager', `Upgrading Sudoclaw before start: installed=${versionState.installedVersion} bundled=${versionState.bundledVersion}`);
        const installResult = await ensureSudoclawInstalled({ forceReinstall: true });
        if (!installResult.installed) {
          throw new Error(installResult.error ?? 'Sudoclaw upgrade failed before gateway start');
        }
      }

      // CRITICAL: Ensure skills.load.extraDirs is always set before gateway starts.
      // This guarantees ~/.nexus/skills is always loaded regardless of platform,
      // whether config was manually modified, or whether repair was skipped.
      repairOpenClawConfig();

      this.gateway = new OpenClawGatewayManager({
        port: SUDOCLAW_DEFAULT_PORT,
        stateDir: SUDOCLAW_DIR,
        customEnv: { OPENCLAW_STATE_DIR: SUDOCLAW_DIR, OPENCLAW_CONFIG_PATH: SUDOCLAW_CONFIG_PATH },
        forceSubprocessGateway: true,
      });
      await this.gateway.start();
      const launchCommand = this.gateway.getLastLaunchCommand();
      if (launchCommand) {
        initStatusManager.addLog(`[Sudoclaw] Start command: ${launchCommand.command} ${launchCommand.args.join(' ')}`);
      }
      await this.waitForSudoclawHealthy(SUDOCLAW_DEFAULT_PORT);
      initStatusManager.setStepProgress('sudoclaw', 100, 'Sudoclaw 服务已就绪');
      mainLog('ServiceManager', 'Sudoclaw gateway started successfully');
      this.gatewayReadyResolve?.({ host: 'localhost', port: SUDOCLAW_DEFAULT_PORT });

      // Ensure USER.md safety rules after Sudoclaw starts.
      // Sudoclaw may create a default USER.md template on first run, which could
      // overwrite rules written before startup. Run again after gateway is healthy.
      try {
        fs.mkdirSync(path.join(SUDOCLAW_DIR, 'workspace'), { recursive: true });
        ensureUserMdSafetyRules();
      } catch (err) {
        mainWarn('ServiceManager', 'Failed to ensure USER.md safety rules after Sudoclaw start', err);
      }

      // Sync image model from sudowork config to sudoclaw.json on every startup.
      // Covers first-time (no prior user interaction) and ensures sudoclaw.json stays in sync.
      void this.syncImageModelToSudoclaw(SUDOCLAW_CONFIG_PATH);
    } catch (err) {
      mainError('ServiceManager', 'Sudoclaw gateway start failed', err);
      // Resolve with null so waiters don't hang forever.
      this.gatewayReadyResolve?.(null);
      throw err;
    }
  }

  private async syncImageModelToSudoclaw(sudoclawConfigPath: string): Promise<void> {
    try {
      const { ProcessConfig } = await import('@/process/initStorage');
      const { DEFAULT_IMAGE_MODEL } = await import('@/common/storage');
      const imageConfig = await ProcessConfig.get('tools.imageGenerationModel');
      // If no config saved yet (first run), treat as default: switch on with DEFAULT_IMAGE_MODEL.
      const switchOn = imageConfig ? imageConfig.switch : true;
      const useModel = imageConfig?.useModel || DEFAULT_IMAGE_MODEL;
      const modelId = switchOn && useModel ? useModel : null;

      const fs = await import('fs');
      if (!fs.existsSync(sudoclawConfigPath)) return;
      const raw = fs.readFileSync(sudoclawConfigPath, 'utf-8');
      const config = JSON.parse(raw);
      if (!config.agents) config.agents = { defaults: {} };
      if (!config.agents.defaults) config.agents.defaults = {};
      config.agents.defaults.imageModel = modelId ?? '';
      fs.writeFileSync(sudoclawConfigPath, JSON.stringify(config, null, 2), 'utf-8');
      mainLog('ServiceManager', 'Synced image model to sudoclaw.json on startup:', modelId);
    } catch (err) {
      mainError('ServiceManager', 'Failed to sync image model to sudoclaw.json', err);
    }
  }

  private async ensureNodeReadyForSudoclawStart(): Promise<void> {
    const { ensureNodeInstalled, isNodeInstalled } = await import('../claudeCli/NodeRuntimeService');

    if (isNodeInstalled()) {
      initStatusManager.addLog('✓ Sudoclaw 启动前 Node.js 环境检查通过');
      return;
    }

    initStatusManager.addLog('⚠ Sudoclaw 启动前检测到 Node.js 环境缺失，正在修复...');
    initStatusManager.setStepState('node', 'active', '正在修复 Node.js 运行时...');
    initStatusManager.setStepProgress('node', 0, '正在修复 Node.js 运行时...');

    const ok = await ensureNodeInstalled((percent) => {
      initStatusManager.setStepProgress('node', percent, `正在修复 Node.js 运行时... ${percent}%`);
    });

    if (!ok || !isNodeInstalled()) {
      initStatusManager.setStepState('node', 'error', 'Node.js 运行时修复失败');
      throw new Error('Sudoclaw 启动前 Node.js 环境校验失败');
    }

    initStatusManager.setStepState('node', 'done', 'Node.js 运行时已就绪');
    initStatusManager.setStepProgress('node', 100, 'Node.js 运行时已就绪');
    initStatusManager.addLog('✓ Sudoclaw 启动前已确认 Node.js 环境正常');
  }

  private async waitForSudoclawHealthy(port: number, timeoutMs?: number): Promise<void> {
    const deadline = timeoutMs === undefined ? Number.POSITIVE_INFINITY : Date.now() + timeoutMs;
    let lastHealth: SudoclawHealthCheckResult = { healthy: false, error: 'health check not attempted' };

    while (Date.now() < deadline) {
      if (this.gateway && !this.gateway.isRunning) {
        throw new Error('Sudoclaw gateway exited before becoming healthy');
      }

      lastHealth = await this.checkSudoclawHealth(port);
      if (lastHealth.healthy) {
        return;
      }

      if (lastHealth.statusCode !== undefined || lastHealth.error) {
        mainLog('ServiceManager', 'Sudoclaw /health probe pending', {
          statusCode: lastHealth.statusCode,
          body: lastHealth.body,
          error: lastHealth.error,
        });
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    const diagnostics = this.buildSudoclawStartDiagnostics(lastHealth);
    mainWarn('ServiceManager', 'Sudoclaw health check timed out', diagnostics);
    throw new Error(`Sudoclaw gateway did not become healthy within ${timeoutMs}ms. diagnostics=${JSON.stringify(diagnostics)}`);
  }

  private async isSudoclawHealthy(port: number): Promise<boolean> {
    const health = await this.checkSudoclawHealth(port);
    return health.healthy;
  }

  private async checkSudoclawHealth(port: number): Promise<SudoclawHealthCheckResult> {
    return await new Promise<SudoclawHealthCheckResult>((resolve) => {
      const req = http.get(
        {
          host: '127.0.0.1',
          port,
          path: '/health',
          timeout: 1_500,
        },
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => {
            let payload: SudoclawHealthPayload | undefined;

            if (body) {
              try {
                const parsed = JSON.parse(body) as unknown;
                if (isSudoclawHealthPayload(parsed)) {
                  payload = parsed;
                }
              } catch {
                // Keep raw body for diagnostics; some builds may not return JSON.
              }
            }

            resolve({
              healthy: res.statusCode === 200 && payload !== undefined,
              statusCode: res.statusCode,
              body: body.slice(0, 1000),
              payload,
            });
          });
        }
      );

      req.on('error', (err) => {
        resolve({
          healthy: false,
          error: err instanceof Error ? err.message : String(err),
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({
          healthy: false,
          error: 'timeout',
        });
      });
    });
  }

  private async preparePortForStart(port: number, label: 'Sudoclaw' | 'Nexus'): Promise<void> {
    const occupied = await this.isPortOccupied(port);
    if (!occupied) {
      return;
    }
    initStatusManager.addLog(`⚠ ${label} 端口 ${port} 已被占用，正在强制清理...`);
    await this.killProcessesOnPort(port, label);
  }

  private async isPortOccupied(port: number): Promise<boolean> {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    try {
      if (process.platform === 'win32') {
        const { stdout } = await execAsync(`netstat -ano | findstr :${port} | findstr LISTENING`);
        return stdout.trim().length > 0;
      }
      const { stdout } = await execAsync(`lsof -ti tcp:${port}`);
      return stdout.trim().length > 0;
    } catch {
      return false;
    }
  }

  private async killProcessesOnPort(port: number, label: string): Promise<void> {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    try {
      if (process.platform === 'win32') {
        const { stdout } = await execAsync(`netstat -ano | findstr :${port} | findstr LISTENING`);
        for (const line of stdout.trim().split('\n')) {
          const pid = line.trim().split(/\s+/).at(-1) ?? '';
          if (pid && /^\d+$/.test(pid) && pid !== '0') {
            await execAsync(`taskkill /F /PID ${pid}`).catch(() => {});
          }
        }
      } else {
        const { stdout } = await execAsync(`lsof -ti tcp:${port}`).catch(() => ({ stdout: '' }));
        for (const pid of stdout
          .trim()
          .split('\n')
          .map((item) => item.trim())
          .filter(Boolean)) {
          await execAsync(`kill -9 ${pid}`).catch(() => {});
        }
      }
      mainLog('ServiceManager', `Force-killed processes on ${label} port ${port}`);
    } catch {
      /* ignore */
    }
  }

  private async verifyStartupReadiness(): Promise<void> {
    const startupOnlyChecks = initStatusManager.getStatus().displayMode === 'startup';
    const serviceModules = await Promise.all([import('../sudoclaw/SudoclawInstallService'), import('../nexus/DynamicNexusService')]);
    const [sudoclawModule, nexusModule] = serviceModules;
    const { getSudoclawCliPath, SUDOCLAW_DEFAULT_PORT } = sudoclawModule;
    const { dynamicNexusService } = nexusModule;
    const deadline = startupOnlyChecks ? Number.POSITIVE_INFINITY : Date.now() + this.STARTUP_READINESS_TIMEOUT_MS;
    let lastFailedNames: string[] = [];

    while (Date.now() < deadline) {
      const sudoclawHealthyPromise = this.isSudoclawHealthy(SUDOCLAW_DEFAULT_PORT);
      const nexusHealthyPromise = dynamicNexusService.checkActualRunning();
      const [sudoclawHealthy, nexusHealthy] = await Promise.all([sudoclawHealthyPromise, nexusHealthyPromise]);

      const readinessChecks = [
        { name: 'Sudoclaw', ok: getSudoclawCliPath() !== null && sudoclawHealthy },
        { name: 'Nexus', ok: nexusHealthy },
      ];

      const failed = readinessChecks.filter((item) => !item.ok).map((item) => item.name);
      if (failed.length === 0) {
        return;
      }

      if (failed.join('、') !== lastFailedNames.join('、')) {
        initStatusManager.addLog(`⚠ 组件已启动，等待服务稳定中：${failed.join('、')}`);
        lastFailedNames = failed;
      }

      await new Promise((resolve) => setTimeout(resolve, this.STARTUP_READINESS_POLL_MS));
    }

    throw new Error(`以下组件尚未就绪: ${lastFailedNames.join('、') || '未知组件'}`);
  }

  async stopOpenClaw(): Promise<void> {
    if (!this.gateway) return;
    try {
      await this.gateway.stop();
    } catch {
      /* ignore */
    }
    this.gateway = null;
    // Force-kill any orphaned process still holding the gateway port
    try {
      const { SUDOCLAW_DEFAULT_PORT } = await import('../sudoclaw/SudoclawInstallService');
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      if (process.platform === 'win32') {
        const { stdout } = await execAsync(`netstat -ano | findstr :${SUDOCLAW_DEFAULT_PORT} | findstr LISTENING`);
        for (const line of stdout.trim().split('\n')) {
          const parts = line.trim().split(/\s+/);
          const pid = parts[parts.length - 1];
          if (pid && /^\d+$/.test(pid) && pid !== '0') {
            await execAsync(`taskkill /F /PID ${pid}`).catch(() => {});
          }
        }
      } else {
        await execAsync(`lsof -ti tcp:${SUDOCLAW_DEFAULT_PORT} | xargs kill -9 2>/dev/null || true`);
      }
      mainLog('ServiceManager', 'Force-killed orphaned processes on gateway port');
    } catch {
      /* port already free */
    }
  }

  async restartOpenClaw(): Promise<void> {
    await this.stopOpenClaw();
    await this.startOpenClaw();
    // Reconnect all active agents' WebSocket connections to the new gateway.
    const WorkerManage = (await import('@process/WorkerManage')).default;
    WorkerManage.reconnectOpenClawAgents();
  }

  /**
   * Wait for the gateway to become ready. Agents call this instead of
   * self-provisioning the gateway process.
   */
  async waitForGateway(): Promise<{ host: string; port: number } | null> {
    if (!this.gatewayReadyPromise) {
      // Gateway was never started (e.g. installation failed).
      return null;
    }
    return this.gatewayReadyPromise;
  }

  /** Send SIGUSR1 to the gateway for hot-reload (skills/config). */
  sendReloadSignal(): void {
    this.gateway?.sendReloadSignal();
  }

  getGateway(): OpenClawGateway | null {
    return this.gateway;
  }

  // ────────────────────────────────────────────────────────────────────────────
  //  Safety Polling Service
  // ────────────────────────────────────────────────────────────────────────────

  private async startSafetyPolling(): Promise<void> {
    try {
      const { SafetyPollingService } = await import('../safety/SafetyPollingService');
      const service = SafetyPollingService.getInstance();
      void service.start({ pollingIntervalMs: 3000 }, false);
    } catch (err) {
      mainError('ServiceManager', 'Failed to start SafetyPollingService', err);
    }
  }
}

export const serviceManager = new ServiceManager();
