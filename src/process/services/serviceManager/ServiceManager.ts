/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { app } from 'electron';
import { mainLog, mainError, mainWarn } from '@process/utils/mainLogger';
import { initStatusManager } from '../initStatus';
import { isSudoclawHealthPayload, type SudoclawHealthPayload } from '../sudoclaw/sudoclawHealth';

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
  private startupRetryTimer: NodeJS.Timeout | null = null;
  private startupRetryCount = 0;
  private startupSudoclawReinstallAttempted = false;
  private startupNexusReinstallAttempted = false;
  private readonly STARTUP_RETRY_LIMIT = 3;
  private readonly STARTUP_RETRY_DELAY_MS = 10_000;
  private readonly STARTUP_READINESS_TIMEOUT_MS = 15_000;
  private readonly STARTUP_ONLY_READINESS_TIMEOUT_MS = 90_000;
  private readonly STARTUP_READINESS_POLL_MS = 500;
  private readonly SUDOCLAW_START_TIMEOUT_MS = 90_000;
  private readonly SUDOCLAW_FIRST_INSTALL_START_TIMEOUT_MS = 90_000;
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

  // ────────────────────────────────────────────────────────────────────────────
  //  startup — fire-and-forget from process/index.ts
  // ────────────────────────────────────────────────────────────────────────────

  async startup(): Promise<void> {
    if (this.startupInProgress) {
      return;
    }

    this.startupInProgress = true;
    initStatusManager.clearRetry();
    initStatusManager.setStatus('installing', '正在启动核心服务...', 90);
    initStatusManager.setDetail('正在检查 Sudoclaw 与 Nexus 服务状态...');

    try {
      const { runtimeInstaller } = await import('./RuntimeInstaller');
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
      this.startupRetryCount = 0;
      this.startupSudoclawReinstallAttempted = false;
      this.startupNexusReinstallAttempted = false;
      if (this.startupRetryTimer) {
        clearTimeout(this.startupRetryTimer);
        this.startupRetryTimer = null;
      }
      void this.startSafetyPolling();

      // Start health monitor for auto-healing components
      const { componentHealthMonitor } = await import('./ComponentHealthMonitor');
      void componentHealthMonitor.start();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      initStatusManager.setStatus('error', '初始化失败', 0, message);
      if (initStatusManager.getStatus().displayMode === 'startup') {
        initStatusManager.clearRetry();
        initStatusManager.setDetail('核心服务启动失败，请检查日志或端口占用后重启应用。');
      } else {
        this.scheduleStartupRetry(message);
      }
      mainError('ServiceManager', 'Startup readiness verification failed', err);
    } finally {
      this.startupInProgress = false;
    }
  }

  private scheduleStartupRetry(reason: string): void {
    if (this.startupRetryTimer) {
      clearTimeout(this.startupRetryTimer);
      this.startupRetryTimer = null;
    }

    if (this.startupRetryCount >= this.STARTUP_RETRY_LIMIT) {
      initStatusManager.clearRetry();
      initStatusManager.setDetail('自动重试次数已达上限，请检查磁盘空间或环境后重启应用。');
      initStatusManager.addLog(`✗ 已达到最大自动重试次数（${this.STARTUP_RETRY_LIMIT} 次）`);
      return;
    }

    this.startupRetryCount += 1;
    const delay = this.STARTUP_RETRY_DELAY_MS;
    const retrySeconds = Math.ceil(delay / 1000);
    const retryLabel = `第 ${this.startupRetryCount}/${this.STARTUP_RETRY_LIMIT} 次`;
    const nextRetryAt = Date.now() + delay;

    initStatusManager.setDetail(`安装或启动失败，将在 ${retrySeconds} 秒后自动重试（${retryLabel}）...`);
    initStatusManager.setRetry({
      attempt: this.startupRetryCount,
      maxAttempts: this.STARTUP_RETRY_LIMIT,
      nextRetryAt,
    });
    initStatusManager.addLog(`⚠ 启动失败：${reason}`);
    initStatusManager.addLog(`↻ 将在 ${retrySeconds} 秒后自动重试（${retryLabel}）`);

    this.startupRetryTimer = setTimeout(() => {
      this.startupRetryTimer = null;
      initStatusManager.clearRetry();
      initStatusManager.addLog(`↻ 开始自动重试启动（${retryLabel}）...`);
      void this.startup();
    }, delay);
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

    try {
      await this.startNexusWithRecovery({
        allowReinstall: !this.startupNexusReinstallAttempted,
        postReinstallAttempts: 1,
      });
    } catch (err) {
      if (!this.startupNexusReinstallAttempted) {
        this.startupNexusReinstallAttempted = true;
      }
      throw err;
    }
  }

  private async startNexusWithRecovery(options: { allowReinstall: boolean; postReinstallAttempts: number }): Promise<void> {
    const { dynamicNexusService } = await import('../nexus/DynamicNexusService');

    if (!dynamicNexusService.hasBundledResource()) {
      mainLog('ServiceManager', 'Nexus bundle not included in this build, skipping startup.');
      initStatusManager.setStepProgress('nexus', 100, '当前构建未包含 Nexus，已跳过');
      return;
    }

    const startAttempts = async (attempts: number, phase: 'normal' | 'reinstall'): Promise<void> => {
      let lastError: unknown;

      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          await this.preparePortForStart(12012, 'Nexus');
          initStatusManager.setStepState('nexus', 'active', phase === 'reinstall' ? `重装后正在启动 Nexus 服务（第 ${attempt}/${attempts} 次）...` : `正在启动 Nexus 服务（第 ${attempt}/${attempts} 次）...`);
          initStatusManager.setStepProgress('nexus', 92, initStatusManager.getStatus().stepDetails?.nexus);
          await this.startNexusOnce();
          return;
        } catch (err) {
          lastError = err;
          mainError('ServiceManager', `Nexus startup attempt ${attempt}/${attempts} failed`, err);
          initStatusManager.addLog(`⚠ Nexus 启动失败（第 ${attempt}/${attempts} 次）: ${err instanceof Error ? err.message : String(err)}`);
          await dynamicNexusService.stop().catch(() => {});
          await this.killProcessesOnPort(12012, 'Nexus');
        }
      }

      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    };

    try {
      await startAttempts(this.NEXUS_START_ATTEMPTS, 'normal');
      return;
    } catch (err) {
      if (!options.allowReinstall) {
        throw err;
      }
      this.startupNexusReinstallAttempted = true;
      initStatusManager.setStepState('nexus', 'active', 'Nexus 启动多次失败，正在强制重装...');
      initStatusManager.setStepProgress('nexus', 55, 'Nexus 启动多次失败，正在强制重装...');
      initStatusManager.addLog('⚠ Nexus 启动多次失败，开始强制重装...');
      await dynamicNexusService.stop().catch(() => {});
      await this.killProcessesOnPort(12012, 'Nexus');
      const unsubscribe = dynamicNexusService.onSetupStatus((nexusStatus) => {
        initStatusManager.setStepState('nexus', nexusStatus.stage === 'error' ? 'error' : 'active', nexusStatus.message);
        if (typeof nexusStatus.percent === 'number') {
          initStatusManager.setStepProgress('nexus', Math.min(88, Math.max(0, nexusStatus.percent)), nexusStatus.message);
        }
        initStatusManager.addLog(`[Nexus] ${nexusStatus.message}`);
      });
      try {
        await dynamicNexusService.install();
      } finally {
        unsubscribe();
      }
      await startAttempts(options.postReinstallAttempts, 'reinstall');
    }
  }

  private async startNexusOnce(): Promise<void> {
    try {
      const { dynamicNexusService } = await import('../nexus/DynamicNexusService');
      if (!dynamicNexusService.hasBundledResource()) {
        mainLog('ServiceManager', 'Nexus bundle not included in this build, skipping startup.');
        initStatusManager.setStepProgress('nexus', 100, '当前构建未包含 Nexus，已跳过');
        return;
      }

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
    await this.startOpenClawOnce(this.SUDOCLAW_START_TIMEOUT_MS);
  }

  private async startOpenClawForStartup(timeoutMs = this.SUDOCLAW_START_TIMEOUT_MS): Promise<void> {
    if (initStatusManager.getStatus().displayMode === 'startup') {
      await this.preparePortForStart(17863, 'Sudoclaw');
      await this.startOpenClawOnce(timeoutMs);
      return;
    }

    try {
      await this.startOpenClawWithRecovery({
        allowReinstall: !this.startupSudoclawReinstallAttempted,
        postReinstallAttempts: this.SUDOCLAW_START_ATTEMPTS,
        timeoutMs,
      });
    } catch (err) {
      if (!this.startupSudoclawReinstallAttempted) {
        this.startupSudoclawReinstallAttempted = true;
      }
      throw err;
    }
  }

  private async startOpenClawWithRecovery(options: { allowReinstall: boolean; postReinstallAttempts: number; timeoutMs?: number }): Promise<void> {
    const { ensureSudoclawInstalled } = await import('../sudoclaw/SudoclawInstallService');
    const startupTimeoutMs = options.timeoutMs ?? this.SUDOCLAW_START_TIMEOUT_MS;

    const startAttempts = async (attempts: number, phase: 'normal' | 'reinstall'): Promise<void> => {
      let lastError: unknown;

      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          await this.preparePortForStart(17863, 'Sudoclaw');
          initStatusManager.setStepState('sudoclaw', 'active', phase === 'reinstall' ? `重装后正在启动 Sudoclaw 服务（第 ${attempt}/${attempts} 次）...` : `正在启动 Sudoclaw 服务（第 ${attempt}/${attempts} 次）...`);
          initStatusManager.setStepProgress('sudoclaw', 92, initStatusManager.getStatus().stepDetails?.sudoclaw);
          await this.startOpenClawOnce(startupTimeoutMs);
          return;
        } catch (err) {
          lastError = err;
          mainError('ServiceManager', `Sudoclaw startup attempt ${attempt}/${attempts} failed`, err);
          initStatusManager.addLog(`⚠ Sudoclaw 启动失败（第 ${attempt}/${attempts} 次）: ${err instanceof Error ? err.message : String(err)}`);
          await this.stopOpenClaw();
        }
      }

      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    };

    try {
      await startAttempts(this.SUDOCLAW_START_ATTEMPTS, 'normal');
      return;
    } catch (err) {
      if (!options.allowReinstall) {
        throw err;
      }
      this.startupSudoclawReinstallAttempted = true;
      initStatusManager.setStepState('sudoclaw', 'active', 'Sudoclaw 启动多次失败，正在强制重装...');
      initStatusManager.setStepProgress('sudoclaw', 55, 'Sudoclaw 启动多次失败，正在强制重装...');
      initStatusManager.addLog('⚠ Sudoclaw 启动多次失败，开始强制重装...');
      await this.stopOpenClaw();
      const reinstallResult = await ensureSudoclawInstalled({ forceReinstall: true });
      if (!reinstallResult.installed) {
        throw new Error(reinstallResult.error ?? 'Sudoclaw 强制重装失败');
      }
      if (startupTimeoutMs >= this.SUDOCLAW_FIRST_INSTALL_START_TIMEOUT_MS) {
        initStatusManager.addLog(`ℹ 首次安装/重装后的 Sudoclaw 启动等待时间已放宽至 ${startupTimeoutMs / 1000} 秒`);
      }
      await startAttempts(options.postReinstallAttempts, 'reinstall');
    }
  }

  private async startOpenClawOnce(timeoutMs: number): Promise<void> {
    // Create a deferred promise so agents can await gateway readiness.
    this.gatewayReadyPromise = new Promise<{ host: string; port: number } | null>((resolve) => {
      this.gatewayReadyResolve = resolve;
    });

    try {
      mainLog('ServiceManager', 'Starting Sudoclaw gateway...');
      const { OpenClawGatewayManager } = await import('@/agent/openclaw');
      const { SUDOCLAW_DIR, SUDOCLAW_DEFAULT_PORT, SUDOCLAW_CONFIG_PATH, repairOpenClawConfig, getSudoclawVersionState, ensureSudoclawInstalled } = await import('../sudoclaw/SudoclawInstallService');
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
      await this.waitForSudoclawHealthy(SUDOCLAW_DEFAULT_PORT, timeoutMs);
      initStatusManager.setStepProgress('sudoclaw', 100, 'Sudoclaw 服务已就绪');
      mainLog('ServiceManager', 'Sudoclaw gateway started successfully');
      this.gatewayReadyResolve?.({ host: 'localhost', port: SUDOCLAW_DEFAULT_PORT });
    } catch (err) {
      mainError('ServiceManager', 'Sudoclaw gateway start failed', err);
      // Resolve with null so waiters don't hang forever.
      this.gatewayReadyResolve?.(null);
      throw err;
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

  private async waitForSudoclawHealthy(port: number, timeoutMs = 30_000): Promise<void> {
    const start = Date.now();
    let lastHealth: SudoclawHealthCheckResult = { healthy: false, error: 'health check not attempted' };

    while (Date.now() - start < timeoutMs) {
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
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(1_500),
      });
      const body = await response.text();
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

      return {
        healthy: response.ok && payload !== undefined,
        statusCode: response.status,
        body: body.slice(0, 1000),
        payload,
      };
    } catch (err) {
      return {
        healthy: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
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
    const deadline = Date.now() + (startupOnlyChecks ? this.STARTUP_ONLY_READINESS_TIMEOUT_MS : this.STARTUP_READINESS_TIMEOUT_MS);
    let lastFailedNames: string[] = [];

    let getGitVersion: (() => Promise<string | null>) | null = null;
    let isNodeInstalled: (() => boolean) | null = null;
    let checkClaudeInstalled: (() => Promise<boolean>) | null = null;

    if (!startupOnlyChecks) {
      const readinessModules = await Promise.all([import('../git/GitInstallService'), import('../claudeCli/NodeRuntimeService'), import('../claudeCli/CliInstallService')]);
      const [gitModule, nodeModule, claudeModule] = readinessModules;
      getGitVersion = gitModule.getGitVersion;
      isNodeInstalled = nodeModule.isNodeInstalled;
      checkClaudeInstalled = async () => {
        if (!claudeModule.claudeCliService.hasTgzResource()) {
          return true;
        }
        const status = await claudeModule.claudeCliService.checkInstalled();
        return status.installed;
      };
    }

    while (Date.now() < deadline) {
      const sudoclawHealthyPromise = this.isSudoclawHealthy(SUDOCLAW_DEFAULT_PORT);
      const nexusHealthyPromise = dynamicNexusService.hasBundledResource() ? dynamicNexusService.checkActualRunning() : Promise.resolve(true);
      const gitVersionPromise = getGitVersion ? getGitVersion() : Promise.resolve(null);
      const nodeInstalledPromise = isNodeInstalled ? Promise.resolve(isNodeInstalled()) : Promise.resolve(true);
      const claudeInstalledPromise = checkClaudeInstalled ? checkClaudeInstalled() : Promise.resolve(true);
      const [gitVersion, nodeInstalled, claudeInstalled, sudoclawHealthy, nexusHealthy] = await Promise.all([gitVersionPromise, nodeInstalledPromise, claudeInstalledPromise, sudoclawHealthyPromise, nexusHealthyPromise]);

      const readinessChecks = [
        { name: 'Sudoclaw', ok: getSudoclawCliPath() !== null && sudoclawHealthy },
        { name: 'Nexus', ok: dynamicNexusService.hasBundledResource() ? nexusHealthy : true },
        ...(startupOnlyChecks
          ? []
          : [
              { name: 'Git', ok: Boolean(gitVersion) },
              { name: 'Node.js', ok: nodeInstalled },
              { name: 'Claude Code CLI', ok: claudeInstalled },
              // bdpan is optional (required: false in RuntimeInstaller), skip readiness check
              { name: 'bdpan', ok: true },
            ]),
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
      void service.start({ pollingIntervalMs: 3000 });
    } catch (err) {
      mainError('ServiceManager', 'Failed to start SafetyPollingService', err);
    }
  }
}

export const serviceManager = new ServiceManager();
