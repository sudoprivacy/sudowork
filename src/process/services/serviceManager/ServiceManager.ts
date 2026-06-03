/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { mainLog, mainError, mainWarn } from '@process/utils/mainLogger';
import { initStatusManager } from '../initStatus';
import { runtimeInstaller } from './RuntimeInstaller';

/**
 * Centralised service lifecycle manager.
 *
 * Owns the startup / shutdown of Nexus and the SafetyPollingService.  All
 * runtime-install logic that was previously scattered across
 * process/index.ts helpers is consolidated here.
 */
export class ServiceManager {
  private startupInProgress = false;
  private shuttingDown = false;
  private nexusStartPromise: Promise<void> | null = null;
  private readonly STARTUP_READINESS_TIMEOUT_MS = 600_000;
  private readonly STARTUP_READINESS_POLL_MS = 500;
  private readonly NEXUS_START_ATTEMPTS = 3;

  // Deferred promise resolved when secrets are initialized (or failed).
  private secretsReadyResolve: ((value: boolean) => void) | null = null;
  private secretsReadyPromise: Promise<boolean> | null = null;

  private isRetryableStartupExitError(error: unknown, component: 'nexus'): boolean {
    void error;
    void component;
    return true;
  }

  // ────────────────────────────────────────────────────────────────────────────
  //  startup — fire-and-forget from process/index.ts
  // ────────────────────────────────────────────────────────────────────────────

  async startup(): Promise<void> {
    if (this.startupInProgress) {
      return;
    }

    this.shuttingDown = false;
    this.startupInProgress = true;

    // 提前创建 secrets promise，让消费者可以立即 await
    // Promise 在 startNexusOnce() 中通过 initializeSecrets() resolve
    if (!this.secretsReadyPromise) {
      this.secretsReadyPromise = new Promise<boolean>((resolve) => {
        this.secretsReadyResolve = resolve;
      });
    }

    runtimeInstaller.primeStatusForStartup();
    initStatusManager.clearRetry();

    if (initStatusManager.getStatus().displayMode === 'startup') {
      initStatusManager.setStatus('installing', '正在启动核心服务...', 90);
      initStatusManager.setDetail('正在检查 Sudocode 与 Nexus 服务状态...');
    }

    try {
      const ok = await runtimeInstaller.ensureAll({
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
      // Safety hooks are temporarily disabled; keep the polling service entry
      // available so the feature can be restored without rebuilding it.
      // void this.startSafetyPolling();

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
      this.secretsReadyResolve?.(false);
    } finally {
      this.startupInProgress = false;
      // Start the nexus-vfs runtime independently of the core (Nexus/Sudocode)
      // startup outcome. Additive and best-effort: it runs even if core startup
      // failed, and a nexus-vfs failure never blocks or alters core startup.
      void this.startNexusVfs();
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  //  shutdown — called from before-quit
  // ────────────────────────────────────────────────────────────────────────────

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    // Stop Auth Proxy first — no new requests should be accepted after shutdown begins
    try {
      const { stopAuthProxy } = await import('@process/services/authProxy');
      await stopAuthProxy();
    } catch {
      /* ignore */
    }
    try {
      const { componentHealthMonitor } = await import('./ComponentHealthMonitor');
      await componentHealthMonitor.stop();
    } catch {
      /* ignore */
    }
    try {
      const { dynamicNexusService } = await import('../nexus/DynamicNexusService');
      await dynamicNexusService.stop();
    } catch {
      /* ignore */
    }
    try {
      const { dynamicNexusVfsService } = await import('../nexus-vfs/DynamicNexusVfsService');
      await dynamicNexusVfsService.stop();
    } catch {
      /* ignore */
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  //  Nexus
  // ────────────────────────────────────────────────────────────────────────────

  async startNexus(): Promise<void> {
    if (this.shuttingDown) {
      mainWarn('ServiceManager', 'Skipping Nexus start because shutdown is in progress');
      return;
    }
    if (this.nexusStartPromise) {
      await this.nexusStartPromise;
      return;
    }

    this.nexusStartPromise = this.startNexusWithRetries().finally(() => {
      this.nexusStartPromise = null;
    });
    await this.nexusStartPromise;
  }

  private async startNexusForStartup(): Promise<void> {
    await this.startNexusWithRetries();
  }

  private async startNexusWithRetries(): Promise<void> {
    const { dynamicNexusService } = await import('../nexus/DynamicNexusService');

    const startAttempts = async (attempts: number, phase: 'normal' | 'reinstall'): Promise<void> => {
      let lastError: unknown;

      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          await this.preparePortForStart(12012, 'Nexus');
          // Reset Nexus running state after killing port processes
          // because preparePortForStart may have killed the process externally
          dynamicNexusService.resetRunningState();
          const startupDetail = attempt > 1 ? (phase === 'reinstall' ? `重装后正在启动 Nexus 服务（第 ${attempt}/${attempts} 次）...` : `正在启动 Nexus 服务（第 ${attempt}/${attempts} 次）...`) : phase === 'reinstall' ? '重装后正在启动 Nexus 服务...' : '正在启动 Nexus 服务...';
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

          initStatusManager.addLog(`↻ Nexus 启动失败，准备重试（第 ${attempt + 1}/${attempts} 次）...`);
          await dynamicNexusService.stop().catch(() => {});
          await this.killProcessesOnPort(12012, 'Nexus');
          await new Promise((resolve) => setTimeout(resolve, 1000));
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

      // Initialize secrets system after Nexus is healthy
      // This runs migration (if needed) and preloads the secret cache
      // secretsReadyPromise 已在 startup() 入口处创建
      this.initializeSecrets()
        .then(async () => {
          // Start Auth Proxy after secrets are initialized
          try {
            const { startAuthProxy } = await import('@process/services/authProxy');
            const port = await startAuthProxy();
            if (port > 0) {
              mainLog('ServiceManager', `Auth Proxy started on port ${port}`);
            }
          } catch (err) {
            mainWarn('ServiceManager', 'Auth Proxy start failed (non-critical):', err);
          }
          this.secretsReadyResolve?.(true);
        })
        .catch((err) => {
          mainWarn('ServiceManager', 'Secrets initialization failed (non-critical):', err);
          this.secretsReadyResolve?.(false);
        });
    } catch (err) {
      mainError('ServiceManager', 'Failed to start Nexus', err);
      this.secretsReadyResolve?.(false);
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
  //  nexus-vfs — third managed runtime (gRPC daemon on 127.0.0.1:12022)
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Installs (if needed) and starts the nexus-vfs daemon. Best-effort: errors are
   * logged but not rethrown, so a nexus-vfs problem never blocks the rest of the
   * app. Runs independently of the Nexus runtime on port 12012.
   */
  async startNexusVfs(): Promise<void> {
    if (this.shuttingDown) {
      mainWarn('ServiceManager', 'Skipping nexus-vfs start because shutdown is in progress');
      return;
    }
    try {
      const { dynamicNexusVfsService } = await import('../nexus-vfs/DynamicNexusVfsService');
      if (!(await dynamicNexusVfsService.checkInstalled())) {
        mainLog('ServiceManager', 'Installing nexus-vfs runtime...');
        await dynamicNexusVfsService.install();
      }
      const launchCommand = dynamicNexusVfsService.getStartCommandPreview();
      mainLog('ServiceManager', `Starting nexus-vfs service... (${launchCommand.command} ${launchCommand.args.join(' ')})`);
      await dynamicNexusVfsService.start();
      mainLog('ServiceManager', `nexus-vfs service is listening on 127.0.0.1:${dynamicNexusVfsService.port}`);
    } catch (err) {
      mainError('ServiceManager', 'Failed to start nexus-vfs (non-critical)', err);
    }
  }

  async stopNexusVfs(): Promise<void> {
    try {
      const { dynamicNexusVfsService } = await import('../nexus-vfs/DynamicNexusVfsService');
      mainLog('ServiceManager', 'Stopping nexus-vfs service...');
      await dynamicNexusVfsService.stop();
      mainLog('ServiceManager', 'nexus-vfs service stopped');
    } catch (err) {
      mainError('ServiceManager', 'Failed to stop nexus-vfs', err);
    }
  }

  /**
   * Initialize the secrets system after Nexus is healthy.
   * This runs the migration coordinator and preloads the secret cache.
   */
  private async initializeSecrets(): Promise<void> {
    try {
      const { initializeSecrets } = await import('@common/nexus/secret-migration');
      mainLog('ServiceManager', 'Initializing secrets system...');
      await initializeSecrets();
      mainLog('ServiceManager', 'Secrets system initialized');
    } catch (err) {
      // Don't throw - secrets initialization failure should not block startup
      // The system can operate in fallback mode without the secrets cache
      mainWarn('ServiceManager', 'Secrets initialization failed:', err);
    }
  }

  private async preparePortForStart(port: number, label: 'Nexus'): Promise<void> {
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
    const serviceModules = await Promise.all([import('../scode/ScodeInstallService'), import('../nexus/DynamicNexusService')]);
    const [scodeModule, nexusModule] = serviceModules;
    const { isScodeInstalled } = scodeModule;
    const { dynamicNexusService } = nexusModule;
    const deadline = startupOnlyChecks ? Number.POSITIVE_INFINITY : Date.now() + this.STARTUP_READINESS_TIMEOUT_MS;
    let lastFailedNames: string[] = [];

    mainLog('ServiceManager', `Verifying startup readiness (startupOnlyChecks=${startupOnlyChecks})...`);

    while (Date.now() < deadline) {
      const scodeReadyPromise = Promise.resolve(isScodeInstalled());
      const nexusHealthyPromise = dynamicNexusService.checkActualRunning();
      const [scodeReady, nexusHealthy] = await Promise.all([scodeReadyPromise, nexusHealthyPromise]);

      mainLog('ServiceManager', `Readiness check: Sudocode=${scodeReady}, Nexus=${nexusHealthy}`);

      const readinessChecks = [
        { name: 'Sudocode', ok: scodeReady },
        { name: 'Nexus', ok: nexusHealthy },
      ];

      const failed = readinessChecks.filter((item) => !item.ok).map((item) => item.name);
      if (failed.length === 0) {
        mainLog('ServiceManager', 'All components ready, exiting verifyStartupReadiness');
        return;
      }

      // Update UI to show actual waiting state instead of misleading 100%
      if (failed.includes('Sudocode')) {
        initStatusManager.setStepState('scode', 'active', '等待 Sudocode 服务就绪...');
        initStatusManager.setStepProgress('scode', 95, '等待 Sudocode 服务就绪...');
      }
      if (failed.includes('Nexus')) {
        initStatusManager.setStepState('nexus', 'active', '等待 Nexus 服务就绪...');
        initStatusManager.setStepProgress('nexus', 95, '等待 Nexus 服务就绪...');
      }

      if (failed.join('、') !== lastFailedNames.join('、')) {
        initStatusManager.addLog(`⚠ 组件已启动，等待服务稳定中：${failed.join('、')}`);
        lastFailedNames = failed;
      }

      await new Promise((resolve) => setTimeout(resolve, this.STARTUP_READINESS_POLL_MS));
    }

    throw new Error(`以下组件尚未就绪: ${lastFailedNames.join('、') || '未知组件'}`);
  }

  /**
   * Wait for the secrets system to be initialized.
   * Channel plugins call this before loading to ensure credentials are available.
   * secretsReadyPromise 在 startup() 入口处创建，此处直接 await 其 resolve。
   */
  async waitForSecrets(): Promise<boolean> {
    if (!this.secretsReadyPromise) {
      // startup 未被调用（如 enterprise 模式或新用户模式）
      return false;
    }
    return this.secretsReadyPromise;
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
