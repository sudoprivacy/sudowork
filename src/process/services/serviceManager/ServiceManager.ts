/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mainLog, mainError } from '@process/utils/mainLogger';

type OpenClawGateway = import('@/agent/openclaw/OpenClawGatewayManager').OpenClawGatewayManager;

/**
 * Centralised service lifecycle manager.
 *
 * Owns the startup / shutdown of Nexus, the OpenClaw gateway, and the
 * SafetyPollingService.  All runtime-install logic that was previously
 * scattered across process/index.ts helpers is consolidated here.
 */
class ServiceManager {
  private gateway: OpenClawGateway | null = null;

  // Deferred promise resolved when the gateway is ready (or failed).
  private gatewayReadyResolve: ((value: { host: string; port: number } | null) => void) | null = null;
  private gatewayReadyPromise: Promise<{ host: string; port: number } | null> | null = null;

  // ────────────────────────────────────────────────────────────────────────────
  //  startup — fire-and-forget from process/index.ts
  // ────────────────────────────────────────────────────────────────────────────

  async startup(): Promise<void> {
    const { runtimeInstaller } = await import('./RuntimeInstaller');
    const ok = await runtimeInstaller.ensureAll();
    if (!ok) return;
    // Start services (non-blocking)
    void this.startOpenClaw();
    void this.startNexus().catch(() => {});
    void this.startSafetyPolling();
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
    try {
      const { dynamicNexusService } = await import('../nexus/DynamicNexusService');
      if (await dynamicNexusService.checkInstalled()) {
        const versionState = await dynamicNexusService.getVersionState();
        if (versionState.needsUpgrade) {
          mainLog('ServiceManager', `Upgrading Nexus before start: installed=${versionState.installedVersion} bundled=${versionState.bundledVersion}`);
          await dynamicNexusService.install();
        }
        mainLog('ServiceManager', 'Starting Nexus service...');
        await dynamicNexusService.start();
      } else {
        mainLog('ServiceManager', 'Nexus not installed yet. It can be installed from the settings.');
      }
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
    // Create a deferred promise so agents can await gateway readiness.
    this.gatewayReadyPromise = new Promise<{ host: string; port: number } | null>((resolve) => {
      this.gatewayReadyResolve = resolve;
    });

    try {
      mainLog('ServiceManager', 'Starting Sudoclaw gateway...');
      const { OpenClawGatewayManager } = await import('@/agent/openclaw');
      const { SUDOCLAW_DIR, SUDOCLAW_DEFAULT_PORT, SUDOCLAW_CONFIG_PATH, repairOpenClawConfig, getSudoclawVersionState, ensureSudoclawInstalled } = await import('../sudoclaw/SudoclawInstallService');

      const versionState = getSudoclawVersionState();
      if (versionState.needsUpgrade) {
        mainLog('ServiceManager', `Upgrading Sudoclaw before start: installed=${versionState.installedVersion} bundled=${versionState.bundledVersion}`);
        const installResult = await ensureSudoclawInstalled({ forceReinstall: true });
        if (!installResult.installed) {
          throw new Error('Sudoclaw upgrade failed before gateway start');
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
      mainLog('ServiceManager', 'Sudoclaw gateway started successfully');
      this.gatewayReadyResolve?.({ host: 'localhost', port: SUDOCLAW_DEFAULT_PORT });
    } catch (err) {
      mainError('ServiceManager', 'Sudoclaw gateway start failed', err);
      // Resolve with null so waiters don't hang forever.
      this.gatewayReadyResolve?.(null);
    }
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
