/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import { mainLog, mainError, mainWarn } from '@process/utils/mainLogger';
import { initStatusManager } from '../initStatus';
import { isSudoclawHealthPayload, SUDOCLAW_HEALTH_TIMEOUT_MS, type SudoclawHealthPayload } from '../sudoclaw/sudoclawHealth';
import { AdbResultSidechannel } from '../sudoclaw/AdbResultSidechannel';
import { runtimeInstaller } from './RuntimeInstaller';

type SudoclawGateway = import('@/agent/sudoclaw/SudoclawGatewayManager').OpenClawGatewayManager;

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
 * Owns the startup / shutdown of Nexus, the Sudoclaw gateway, and the
 * SafetyPollingService.  All runtime-install logic that was previously
 * scattered across process/index.ts helpers is consolidated here.
 */
export class ServiceManager {
  private gateway: SudoclawGateway | null = null;
  private adbSidechannel: AdbResultSidechannel | null = null;
  private startupInProgress = false;
  private shuttingDown = false;
  private sudoclawStartPromise: Promise<void> | null = null;
  private nexusStartPromise: Promise<void> | null = null;
  private readonly STARTUP_READINESS_TIMEOUT_MS = 600_000;
  private readonly STARTUP_READINESS_POLL_MS = 500;
  private readonly SUDOCLAW_START_ATTEMPTS = 3;
  private readonly NEXUS_START_ATTEMPTS = 3;

  // Deferred promise resolved when the gateway is ready (or failed).
  private gatewayReadyResolve: ((value: { host: string; port: number } | null) => void) | null = null;
  private gatewayReadyPromise: Promise<{ host: string; port: number } | null> | null = null;

  // Deferred promise resolved when secrets are initialized (or failed).
  private secretsReadyResolve: ((value: boolean) => void) | null = null;
  private secretsReadyPromise: Promise<boolean> | null = null;

  private buildSudoclawStartDiagnostics(lastHealth: SudoclawHealthCheckResult): {
    launchCommand: ReturnType<SudoclawGateway['getLastLaunchCommand']>;
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
    await this.stopSudoclaw();
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
      initStatusManager.addLog(`[Nexus] Nexus service is healthy on 127.0.0.1:${dynamicNexusService.port} (gRPC)`);
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

  // ────────────────────────────────────────────────────────────────────────────
  //  Sudoclaw gateway
  // ────────────────────────────────────────────────────────────────────────────

  async startSudoclaw(): Promise<void> {
    if (this.shuttingDown) {
      mainWarn('ServiceManager', 'Skipping Sudoclaw start because shutdown is in progress');
      return;
    }
    if (this.sudoclawStartPromise) {
      await this.sudoclawStartPromise;
      return;
    }

    this.sudoclawStartPromise = this.startSudoclawWithRetries().finally(() => {
      this.sudoclawStartPromise = null;
    });
    await this.sudoclawStartPromise;
  }

  private async startSudoclawWithRetries(): Promise<void> {
    const startAttempts = async (attempts: number, phase: 'normal' | 'reinstall'): Promise<void> => {
      let lastError: unknown;

      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          await this.preparePortForStart(17863, 'Sudoclaw');
          const startupDetail = attempt > 1 ? (phase === 'reinstall' ? `重装后正在启动 Sudoclaw 服务（第 ${attempt}/${attempts} 次）...` : `正在启动 Sudoclaw 服务（第 ${attempt}/${attempts} 次）...`) : phase === 'reinstall' ? '重装后正在启动 Sudoclaw 服务...' : '正在启动 Sudoclaw 服务...';
          initStatusManager.setStepState('sudoclaw', 'active', startupDetail);
          initStatusManager.setStepProgress('sudoclaw', 92, initStatusManager.getStatus().stepDetails?.sudoclaw);
          await this.startSudoclawOnce();
          return;
        } catch (err) {
          lastError = err;
          mainError('ServiceManager', `Sudoclaw startup attempt ${attempt}/${attempts} failed`, err);
          initStatusManager.addLog(`⚠ Sudoclaw 启动失败（第 ${attempt}/${attempts} 次）: ${err instanceof Error ? err.message : String(err)}`);

          const shouldRetry = this.isRetryableStartupExitError(err, 'sudoclaw') && attempt < attempts;
          if (!shouldRetry) {
            throw err;
          }

          initStatusManager.addLog(`↻ Sudoclaw 启动失败，准备重试（第 ${attempt + 1}/${attempts} 次）...`);
          await this.stopSudoclaw();
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    };

    await startAttempts(this.SUDOCLAW_START_ATTEMPTS, 'normal');
  }

  private async startSudoclawOnce(): Promise<void> {
    // Create a deferred promise so agents can await gateway readiness.
    this.gatewayReadyPromise = new Promise<{ host: string; port: number } | null>((resolve) => {
      this.gatewayReadyResolve = resolve;
    });

    try {
      mainLog('ServiceManager', 'Starting Sudoclaw gateway...');
      const { OpenClawGatewayManager } = await import('@/agent/sudoclaw');
      const { SUDOCLAW_DIR, SUDOCLAW_DEFAULT_PORT, SUDOCLAW_CONFIG_PATH, ensureDefaultConfig, repairSudoclawConfig, getSudoclawVersionState, ensureSudoclawInstalled, ensureUserMdSafetyRules, ensureUserMdIdentityStatement, ensureUserMdNoGeneratedByStatement, ensureUserMdNoExposeUserMdStatement, ensureUserMdFileSendInstruction, ensureUserMdVersionInfoStatement } = await import('../sudoclaw/SudoclawInstallService');
      await this.ensureNodeReadyForSudoclawStart();

      const versionState = getSudoclawVersionState();
      if (versionState.needsUpgrade) {
        const installResult = await ensureSudoclawInstalled({ forceReinstall: versionState.needsUpgrade });
        mainLog('ServiceManager', `Upgrading Sudoclaw before start: installed=${versionState.installedVersion} bundled=${versionState.bundledVersion}`);
        if (!installResult.installed) {
          throw new Error(installResult.error ?? 'Sudoclaw upgrade failed before gateway start');
        }
      }

      // Ensure the config file exists even when the runtime is already installed
      // and startup skips the install/upgrade path.
      ensureDefaultConfig();

      // CRITICAL: Ensure skills.load.extraDirs is always set before gateway starts.
      // This guarantees ~/.nexus/skills is always loaded regardless of platform,
      // whether config was manually modified, or whether repair was skipped.
      repairSudoclawConfig();

      // Start the ai-dev-browser sidechannel before the gateway so the gateway
      // (and any `python -m ai_dev_browser.tools.*` children it spawns) inherit
      // the URL + secret through customEnv.
      let adbSidechannelEnv: Record<string, string> = {};
      try {
        if (!this.adbSidechannel) {
          this.adbSidechannel = new AdbResultSidechannel();
        }
        const { port: sidePort, secret: sideSecret } = await this.adbSidechannel.start();
        adbSidechannelEnv = {
          AI_DEV_BROWSER_SIDECHANNEL_URL: `http://127.0.0.1:${sidePort}/capture`,
          AI_DEV_BROWSER_SIDECHANNEL_SECRET: sideSecret,
        };
      } catch (err) {
        mainWarn('ServiceManager', 'Failed to start AdbResultSidechannel (ai-dev-browser UI bypass disabled for this run)', err);
      }

      // PYTHONPATH injection: point at the system skills' browser dir so
      // `python -m ai_dev_browser.tools.<name>` works from any cwd that
      // openclaw's exec happens to run in. Without this the LLM has to
      // prefix every invocation with `cd skills/browser &&` (brittle and
      // ugly) or hit the ModuleNotFoundError + retry loop we keep seeing.
      // Stable location: ~/.nexus/skills/_system/browser (junction inside
      // it points at vendor/ai-dev-browser/ai_dev_browser).
      const pythonPathEnv: Record<string, string> = {};
      try {
        const { getSystemSkillsDir } = await import('@/process/initStorage');
        const browserSkillDir = path.join(getSystemSkillsDir(), 'browser');
        // Append, don't stomp, if the caller/shell already set PYTHONPATH.
        const prev = process.env.PYTHONPATH;
        pythonPathEnv.PYTHONPATH = prev && prev.length > 0 ? `${browserSkillDir}${path.delimiter}${prev}` : browserSkillDir;
      } catch (err) {
        mainWarn('ServiceManager', 'Failed to resolve system skills dir for PYTHONPATH injection', err);
      }

      // Install sudowork-owned aidb dispatcher (skips upstream uv overhead)
      // into ~/.nexus/sudoclaw/bin/ and surface it on PATH for every exec
      // child. LLM writes `aidb page_info --url X` instead of
      // `$env:PYTHONPATH=...; python -m ai_dev_browser.tools.page_info --url X`.
      const sudoworkBinEnv: Record<string, string> = {};
      try {
        const { ensureSudoworkBinDispatchers, patchOpenclawToolResultCap, patchOpenclawKeepImageData, patchOpenclawKeepToolResult, patchOpenclawReadDescription, patchOpenclawPdfDescription, SUDOCLAW_SUDOWORK_BIN_DIR } = await import('../sudoclaw/SudoclawInstallService');
        ensureSudoworkBinDispatchers();
        // Re-assert openclaw bundle patches on every gateway start so an
        // upstream openclaw update doesn't silently re-cap tool results
        // to 8 KB, re-strip image bytes before the LLM, re-strip
        // `result.content` from the WS broadcast that drives the UI's
        // Output panel, or re-introduce the misleading read/pdf tool
        // descriptions that steer multimodal LLMs away from the
        // functioning image pipeline. All are idempotent + fail-open.
        patchOpenclawToolResultCap();
        patchOpenclawKeepImageData();
        patchOpenclawKeepToolResult();
        patchOpenclawReadDescription();
        patchOpenclawPdfDescription();
        const prevPath = process.env.PATH ?? '';
        sudoworkBinEnv.PATH = prevPath.length > 0 ? `${SUDOCLAW_SUDOWORK_BIN_DIR}${path.delimiter}${prevPath}` : SUDOCLAW_SUDOWORK_BIN_DIR;
        // ai-dev-browser v0.5.1 reads AI_DEV_BROWSER_OUTPUT_DIR as the
        // `--path`-omitted default for screenshot / dump tools (falls back
        // to `./screenshots/` under CWD if unset). openclaw's exec tool
        // runs with CWD = the conversation workspace root, so `.` here
        // resolves at tool-invocation time to that per-conversation
        // workspace — keeping each conversation's screenshots isolated
        // and landing them at a persistent, discoverable location the
        // LLM doesn't need to `mv` out of scratch after the fact.
        sudoworkBinEnv.AI_DEV_BROWSER_OUTPUT_DIR = '.';
        // openclaw's exec tool backgrounds any command running longer than
        // `defaultBackgroundMs` (default 10s, env `PI_BASH_YIELD_MS`,
        // clamped [10ms, 120s]). When backgrounded, the LLM gets a
        // "Command still running (session foo, pid bar)" stub and has to
        // poll via the `process` tool — costing 2-3 extra steps per
        // affected call. Browser tool calls take 1-3s each; a compound of
        // 3-4 (`browser type_by_ref ...\nbrowser type_by_ref ...`) crosses
        // the 10s threshold and gets shunted to async. lis8 e2e audit
        // observed 4 compound steps trigger this, accounting for ~12 steps
        // of pure overhead. Push to the 120s ceiling so realistic browser
        // compounds finish synchronously. Genuinely long-running commands
        // (npm install, builds) still get backgrounded — they just have a
        // longer fuse before being moved off the main path.
        sudoworkBinEnv.PI_BASH_YIELD_MS = '120000';
      } catch (err) {
        mainWarn('ServiceManager', 'Failed to install sudowork bin dispatchers', err);
      }

      // SUDOROUTER creds injection so the sudowork image-analysis skill and
      // any other tool expecting these env vars works out of the box.
      // Source of truth: sudoclaw.json models.providers.sudorouter.
      // (Normally harmless — the image tool and image-analysis skill are
      // disabled in ensureDefaultConfig/repairSudoclawConfig, but we still
      // inject to support ad-hoc scripts referencing SUDOROUTER.)
      const sudorouterEnv: Record<string, string> = {};
      try {
        const raw = await fs.promises.readFile(SUDOCLAW_CONFIG_PATH, 'utf-8');
        const cfg = JSON.parse(raw) as {
          models?: { providers?: Record<string, { baseUrl?: string; apiKey?: string }> };
        };
        const sr = cfg.models?.providers?.sudorouter;
        if (sr?.baseUrl) sudorouterEnv.SUDOROUTER_BASE_URL = sr.baseUrl;
        if (sr?.apiKey) sudorouterEnv.SUDOROUTER_API_KEY = sr.apiKey;
      } catch (err) {
        mainWarn('ServiceManager', 'Could not read sudorouter provider creds from sudoclaw.json', err);
      }

      this.gateway = new OpenClawGatewayManager({
        port: SUDOCLAW_DEFAULT_PORT,
        stateDir: SUDOCLAW_DIR,
        customEnv: {
          OPENCLAW_STATE_DIR: SUDOCLAW_DIR,
          OPENCLAW_CONFIG_PATH: SUDOCLAW_CONFIG_PATH,
          ...adbSidechannelEnv,
          ...pythonPathEnv,
          ...sudoworkBinEnv,
          ...sudorouterEnv,
        },
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
        ensureUserMdIdentityStatement();
        ensureUserMdNoGeneratedByStatement();
        ensureUserMdNoExposeUserMdStatement();
        ensureUserMdFileSendInstruction();
        ensureUserMdVersionInfoStatement();
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
      const { DEFAULT_IMAGE_PARSING_MODEL, DEFAULT_IMAGE_GENERATION_MODEL } = await import('@/common/storage');
      const imageConfig = await ProcessConfig.get('tools.imageGenerationModel');
      // Generation model: from user config or default
      const switchOn = imageConfig ? imageConfig.switch : true;
      const generationModel = switchOn && imageConfig?.useModel ? imageConfig.useModel : DEFAULT_IMAGE_GENERATION_MODEL;

      const fs = await import('fs');
      if (!fs.existsSync(sudoclawConfigPath)) return;
      const raw = fs.readFileSync(sudoclawConfigPath, 'utf-8');
      const config = JSON.parse(raw);
      if (!config.agents) config.agents = { defaults: {} };
      if (!config.agents.defaults) config.agents.defaults = {};

      // Gateway expects provider-prefixed model ref (e.g. "sudorouter/gemini-3-flash-preview").
      // Find the provider that owns this model from models.providers config.
      const findProvider = (modelId: string) => {
        let provider = 'sudorouter';
        const providers = config.models?.providers as Record<string, { models?: Array<{ id: string }> }> | undefined;
        if (providers) {
          for (const [key, val] of Object.entries(providers)) {
            if (val?.models?.some((m: { id: string }) => m.id === modelId)) {
              provider = key;
              break;
            }
          }
        }
        return modelId.includes('/') ? modelId : `${provider}/${modelId}`;
      };

      // Sync parsing model (看图) → agents.defaults.imageModel (read by gateway)
      config.agents.defaults.imageModel = findProvider(DEFAULT_IMAGE_PARSING_MODEL);

      // Sync generation model (生图) → agents.defaults.imageGenerationModel (read by Electron)
      config.agents.defaults.imageGenerationModel = switchOn ? generationModel : '';

      fs.writeFileSync(sudoclawConfigPath, JSON.stringify(config, null, 2), 'utf-8');
      mainLog('ServiceManager', `Synced image models to sudoclaw.json — parsing: ${DEFAULT_IMAGE_PARSING_MODEL}, generation: ${generationModel}`);

      // Also sync generation model to sudocode.json so the image-generation skill
      // bash script can read it without depending on sudoclaw.json.
      if (generationModel) {
        const { writeScodeImageModel } = await import('@process/bridge/scodeBridge');
        writeScodeImageModel(generationModel);
      }
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
          timeout: SUDOCLAW_HEALTH_TIMEOUT_MS,
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

  async stopSudoclaw(): Promise<void> {
    if (!this.gateway) {
      // Sidechannel can linger if start failed partway; make sure it's cleaned up.
      if (this.adbSidechannel) {
        try {
          await this.adbSidechannel.stop();
        } catch {
          /* ignore */
        }
        this.adbSidechannel = null;
      }
      return;
    }
    try {
      await this.gateway.stop();
    } catch {
      /* ignore */
    }
    this.gateway = null;
    if (this.adbSidechannel) {
      try {
        await this.adbSidechannel.stop();
      } catch {
        /* ignore */
      }
      this.adbSidechannel = null;
    }
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

  async restartSudoclaw(): Promise<void> {
    await this.stopSudoclaw();
    await this.startSudoclaw();
  }

  /**
   * Accessor used by agents to look up captured ai-dev-browser
   * stdout keyed by command hash. Returns null when the sidechannel failed
   * to start (non-critical -- the UI just falls back to the short meta).
   */
  getAdbSidechannel(): AdbResultSidechannel | null {
    return this.adbSidechannel;
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

  /** Send SIGUSR1 to the gateway for hot-reload (skills/config). */
  sendReloadSignal(): void {
    this.gateway?.sendReloadSignal();
  }

  getGateway(): SudoclawGateway | null {
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
