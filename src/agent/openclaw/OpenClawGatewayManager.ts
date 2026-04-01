/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFile, spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { getEnhancedEnv } from '@process/utils/shellEnv';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getNodeBinaryPath } from '@process/services/claudeCli/NodeRuntimeService';
import { app } from 'electron';
import { mainError, mainLog, mainWarn } from '@process/utils/mainLogger';

interface GatewayManagerConfig {
  /** Gateway port (default: 17863 for Sudoclaw) */
  port?: number;
  /** Custom environment variables */
  customEnv?: Record<string, string>;
  /** OpenClaw state dir (e.g. ~/.nexus/sudoclaw) — set cwd to package/ for reliable module resolution */
  stateDir?: string;
  /** Force subprocess (disables in-process); needed to restart gateway on device token mismatch */
  forceSubprocessGateway?: boolean;
}

interface GatewayManagerEvents {
  ready: (port: number) => void;
  error: (error: Error) => void;
  exit: (info: { code: number | null; signal: NodeJS.Signals | null }) => void;
  stdout: (data: string) => void;
  stderr: (data: string) => void;
}

/** Registry of running Sudoclaw gateway managers (port -> manager) — internal bookkeeping */
const gatewayRegistry = new Map<number, OpenClawGatewayManager>();

/**
 * Get path to hook.js for gateway safety interception.
 * The hook will self-regulate by polling /safe/config/enabled from Nexus.
 */
function getHookJsPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'hook.js');
  }
  // Development mode: use app.getAppPath() to get project root
  return path.join(app.getAppPath(), 'hook/node/dist/hook.js');
}

/**
 * OpenClaw Gateway Process Manager
 *
 * Manages the lifecycle of the `openclaw gateway` process.
 *
 * Responsibilities:
 * - Start/stop gateway process
 * - Port management
 * - Health detection
 * - Graceful shutdown
 */
/** Poll until TCP port is open (for in-process gateway readiness) */
async function waitForPort(host: string, port: number, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ host, port });
      socket.setTimeout(500);
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('timeout', () => {
        socket.destroy();
        resolve(false);
      });
      socket.once('error', () => resolve(false));
    });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildGatewayArgs(port: number): string[] {
  const args = ['gateway', '--port', String(port), '--allow-unconfigured', '--auth', 'none'];

  // Windows startup is handled by ServiceManager.preparePortForStart().
  // Passing OpenClaw's own --force triggers "fuser permission denied" there
  // and prevents the gateway from binding at all.
  if (process.platform !== 'win32') {
    args.push('--force');
  }

  return args;
}

export class OpenClawGatewayManager extends EventEmitter {
  private process: ChildProcess | null = null;
  private inProcess = false;
  private readonly port: number;
  private readonly customEnv?: Record<string, string>;
  private readonly stateDir?: string;
  private readonly forceSubprocessGateway: boolean;
  private isStarting = false;
  private startPromise: Promise<number> | null = null;
  private recentStdout = '';
  private recentStderr = '';
  private lastLaunchCommand: { command: string; args: string[]; cwd?: string; pid?: number } | null = null;

  constructor(config: GatewayManagerConfig = {}) {
    super();
    this.port = config.port || 17863;
    this.customEnv = config.customEnv;
    this.stateDir = config.stateDir;
    this.forceSubprocessGateway = config.forceSubprocessGateway ?? false;
  }

  /**
   * Type-safe event emitter
   */
  override emit<K extends keyof GatewayManagerEvents>(event: K, ...args: Parameters<GatewayManagerEvents[K]>): boolean {
    return super.emit(event, ...args);
  }

  override on<K extends keyof GatewayManagerEvents>(event: K, listener: GatewayManagerEvents[K]): this {
    return super.on(event, listener);
  }

  override once<K extends keyof GatewayManagerEvents>(event: K, listener: GatewayManagerEvents[K]): this {
    return super.once(event, listener);
  }

  /**
   * Start the gateway process
   * Returns the port number when ready
   */
  async start(): Promise<number> {
    // Prevent duplicate starts
    if (this.startPromise) {
      return this.startPromise;
    }

    if (this.process && !this.process.killed) {
      return this.port;
    }

    this.isStarting = true;
    this.startPromise = this.doStart();

    try {
      const port = await this.startPromise;
      return port;
    } finally {
      this.isStarting = false;
      this.startPromise = null;
    }
  }

  private canUseInProcess(): boolean {
    // Always use subprocess mode for safety hook to work properly.
    // In-process mode runs gateway in Electron main process, where
    // @mswjs/interceptors cannot intercept network requests.
    // Force subprocess so gateway runs in isolated Node.js process.
    if (this.forceSubprocessGateway) return false;
    if (!this.stateDir) return false;

    // Safety hook requires subprocess mode - in-process mode doesn't support
    // network interception due to Electron's net module vs Node.js http module
    return false;
  }

  private async doStartInProcess(): Promise<number> {
    const pkgRoot = path.join(this.stateDir!, 'cli', 'package');
    const entryPath = path.join(pkgRoot, 'openclaw.mjs');
    const origArgv = [...process.argv];
    const origCwd = process.cwd();
    const origStateDir = process.env.OPENCLAW_STATE_DIR;
    const origConfigPath = process.env.OPENCLAW_CONFIG_PATH;

    process.argv = ['node', entryPath, ...buildGatewayArgs(this.port)];
    process.env.OPENCLAW_STATE_DIR = this.stateDir!;
    process.env.OPENCLAW_CONFIG_PATH = path.join(this.stateDir!, 'sudoclaw.json');
    process.chdir(pkgRoot);

    // Load safety hook before gateway entry (for in-process mode)
    // Hook will self-regulate by polling /safe/config/enabled from Nexus
    const hookJsPath = getHookJsPath();
    if (fs.existsSync(hookJsPath)) {
      try {
        console.log('[OpenClawGatewayManager] Loading safety hook for in-process gateway:', hookJsPath);
        await import(pathToFileURL(hookJsPath).href);
      } catch (err) {
        console.warn('[OpenClawGatewayManager] Failed to load safety hook:', err);
      }
    }

    try {
      console.log('[OpenClawGatewayManager] Starting gateway in-process (no extra Dock icon)');
      await import(pathToFileURL(entryPath).href);
      const ready = await waitForPort('127.0.0.1', this.port, 10000);
      if (ready) {
        this.inProcess = true;
        console.log(`[OpenClawGatewayManager] Gateway ready on port ${this.port}`);
        this.emit('ready', this.port);
        return this.port;
      }
      throw new Error('Gateway did not become ready within timeout');
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
      throw err;
    } finally {
      process.argv = origArgv;
      process.chdir(origCwd);
      if (origStateDir !== undefined) process.env.OPENCLAW_STATE_DIR = origStateDir;
      else delete process.env.OPENCLAW_STATE_DIR;
      if (origConfigPath !== undefined) process.env.OPENCLAW_CONFIG_PATH = origConfigPath;
      else delete process.env.OPENCLAW_CONFIG_PATH;
    }
  }

  private async doStart(): Promise<number> {
    if (this.canUseInProcess()) {
      return this.doStartInProcess();
    }

    return new Promise((resolve, reject) => {
      // Use --auth none to disable authentication. On Windows, rely on our own
      // port cleanup instead of OpenClaw's --force implementation.
      const args = buildGatewayArgs(this.port);
      const env = getEnhancedEnv(this.customEnv);
      // Use bundled Node.js directly (no Electron, no system Node)
      const bundledNode = getNodeBinaryPath();
      if (!fs.existsSync(bundledNode)) {
        reject(new Error(`Bundled Node.js not found at ${bundledNode}. Please restart Sudowork to install it.`));
        return;
      }

      const spawnCwd = this.stateDir ? path.join(this.stateDir, 'cli', 'package') : undefined;
      const launcherPath = spawnCwd ? path.join(spawnCwd, 'launcher.mjs') : null;

      if (!launcherPath || !fs.existsSync(launcherPath)) {
        reject(new Error(`Launcher not found at ${launcherPath}. Please reinstall Sudoclaw.`));
        return;
      }

      if (this.stateDir) {
        env.OPENCLAW_STATE_DIR = this.stateDir;
        env.OPENCLAW_CONFIG_PATH = path.join(this.stateDir, 'sudoclaw.json');
      }

      // Inject sudorouter credentials so skills (e.g. image-analysis) can access them
      // Read directly from sudoclaw.json to avoid cross-layer import issues
      try {
        const configPath = this.stateDir ? path.join(this.stateDir, 'sudoclaw.json') : '';
        if (configPath && fs.existsSync(configPath)) {
          const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
          const sr = config?.models?.providers?.sudorouter;
          if (sr?.apiKey) {
            env.SUDOROUTER_BASE_URL = (sr.baseUrl || 'https://hk.sudorouter.ai/v1').replace(/\/+$/, '');
            env.SUDOROUTER_API_KEY = sr.apiKey;
            console.log('[OpenClawGatewayManager] Injected SUDOROUTER env vars, baseUrl:', env.SUDOROUTER_BASE_URL);
          }
          // CHAT_MODEL is not injected here — it would go stale if user changes model mid-session.
          // Scripts read the current model from sudoclaw.json via OPENCLAW_CONFIG_PATH instead.
        }
      } catch (e) {
        console.warn('[OpenClawGatewayManager] Failed to read sudoclaw.json for env injection:', e);
      }
      console.log('[OpenClawGatewayManager] Using bundled Node.js:', bundledNode);
      mainLog('OpenClawGatewayManager', 'Using bundled Node.js', { path: bundledNode });

      // Inject safety hook for Sudoclaw gateway process
      // Hook will self-regulate by polling /safe/config/enabled from Nexus
      const hookJsPath = getHookJsPath();
      const hookExists = fs.existsSync(hookJsPath);
      const nodeArgs = hookExists ? ['-r', hookJsPath, launcherPath] : [launcherPath];

      if (hookExists) {
        console.log('[OpenClawGatewayManager] Injecting safety hook:', hookJsPath);
        // Also set NODE_OPTIONS so child processes (agents) inherit the hook
        // The hook will self-regulate by polling /safe/config/enabled from Nexus
        env.NODE_OPTIONS = `-r ${hookJsPath}`;
      } else {
        console.warn('[OpenClawGatewayManager] Safety hook not found, starting without:', hookJsPath);
        mainWarn('OpenClawGatewayManager', 'Safety hook not found, starting without preload hook', { hookJsPath });
      }
      console.log(`[OpenClawGatewayManager] Starting: ${bundledNode} ${nodeArgs.join(' ')} ${args.join(' ')}`);
      this.lastLaunchCommand = {
        command: bundledNode,
        args: [...nodeArgs, ...args],
        cwd: spawnCwd && fs.existsSync(spawnCwd) ? spawnCwd : undefined,
      };
      mainLog('OpenClawGatewayManager', 'Starting gateway subprocess', this.lastLaunchCommand);

      this.process = spawn(bundledNode, [...nodeArgs, ...args], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
        shell: false,
        windowsHide: process.platform === 'win32',
        cwd: spawnCwd && fs.existsSync(spawnCwd) ? spawnCwd : undefined,
      });
      this.lastLaunchCommand = {
        ...this.lastLaunchCommand,
        pid: this.process.pid,
      };
      mainLog('OpenClawGatewayManager', 'Gateway subprocess spawned', this.lastLaunchCommand);
      gatewayRegistry.set(this.port, this);

      let hasResolved = false;
      let stdoutBuffer = '';
      let stderrBuffer = '';
      this.recentStdout = '';
      this.recentStderr = '';

      // Look for ready signal in stdout
      this.process.stdout?.on('data', (data: Buffer) => {
        const output = data.toString();
        stdoutBuffer += output;
        this.recentStdout = (this.recentStdout + output).slice(-4000);
        this.emit('stdout', output);
        const trimmed = output.trim();
        if (trimmed) {
          mainLog('OpenClawGatewayManager', 'Gateway stdout', { output: trimmed.slice(-1000) });
        }

        // Look for gateway ready signals
        if (!hasResolved && (output.includes('Gateway listening') || output.includes(`port ${this.port}`) || output.includes('WebSocket server started') || output.includes('gateway ready') || output.includes('listening on'))) {
          hasResolved = true;
          console.log(`[OpenClawGatewayManager] Gateway ready on port ${this.port}`);
          this.emit('ready', this.port);
          resolve(this.port);
        }
      });

      // Capture stderr
      this.process.stderr?.on('data', (data: Buffer) => {
        const output = data.toString();
        stderrBuffer += output;
        this.recentStderr = (this.recentStderr + output).slice(-4000);
        this.emit('stderr', output);
        const trimmed = output.trim();
        if (trimmed) {
          mainWarn('OpenClawGatewayManager', 'Gateway stderr', { output: trimmed.slice(-1000) });
        }

        // Some CLIs output ready message to stderr
        if (!hasResolved && (output.includes('Gateway listening') || output.includes(`port ${this.port}`) || output.includes('WebSocket server started') || output.includes('gateway ready') || output.includes('listening on'))) {
          hasResolved = true;
          console.log(`[OpenClawGatewayManager] Gateway ready on port ${this.port}`);
          this.emit('ready', this.port);
          resolve(this.port);
        }
      });

      this.process.on('error', (error) => {
        console.error('[OpenClawGatewayManager] Process error:', error);
        mainError('OpenClawGatewayManager', 'Gateway process error', error);
        if (!hasResolved) {
          reject(error);
        }
        this.emit('error', error);
      });

      this.process.on('exit', (code, signal) => {
        gatewayRegistry.delete(this.port);
        console.log(`[OpenClawGatewayManager] Process exited: code=${code}, signal=${signal}`);
        mainLog('OpenClawGatewayManager', 'Gateway process exited', { code, signal });
        this.emit('exit', { code, signal });
        this.process = null;

        if (!hasResolved) {
          const errorMsg = `Gateway exited with code ${code}.\nStdout: ${stdoutBuffer.slice(-500)}\nStderr: ${stderrBuffer.slice(-500)}`;
          reject(new Error(errorMsg));
        }
      });

      void (async () => {
        await wait(200);
        if (!hasResolved && this.process && !this.process.killed) {
          const deferredReadiness = {
            launchCommand: this.lastLaunchCommand,
            stdout: stdoutBuffer.slice(-1000),
            stderr: stderrBuffer.slice(-1000),
          };
          mainLog('OpenClawGatewayManager', 'Gateway subprocess started; deferring readiness to health check', deferredReadiness);
          hasResolved = true;
          this.emit('ready', this.port);
          resolve(this.port);
        }
      })();
    });
  }

  /**
   * Stop the gateway process
   */
  async stop(): Promise<void> {
    if (this.inProcess) {
      // In-process gateway runs in main process — cannot stop without quitting app.
      // Gateway stays running until app quit; next session will reuse if port in use.
      this.inProcess = false;
      return;
    }
    if (!this.process) {
      return;
    }

    gatewayRegistry.delete(this.port);
    console.log('[OpenClawGatewayManager] Stopping gateway...');
    const child = this.process;
    const childPid = child.pid;

    if (process.platform === 'win32' && childPid) {
      await new Promise<void>((resolve) => {
        execFile('taskkill', ['/PID', String(childPid), '/T', '/F'], { windowsHide: true }, () => resolve());
      });
    } else {
      child.kill('SIGTERM');
    }

    // Force kill after timeout
    const forceKillTimeout = setTimeout(() => {
      if (this.process && !this.process.killed) {
        console.log('[OpenClawGatewayManager] Force killing gateway...');
        if (process.platform === 'win32' && childPid) {
          void new Promise<void>((resolve) => {
            execFile('taskkill', ['/PID', String(childPid), '/T', '/F'], { windowsHide: true }, () => resolve());
          });
        } else {
          this.process.kill('SIGKILL');
        }
      }
    }, 5000);

    await new Promise<void>((resolve) => {
      if (!this.process) {
        clearTimeout(forceKillTimeout);
        resolve();
        return;
      }

      this.process.once('exit', () => {
        clearTimeout(forceKillTimeout);
        resolve();
      });
    });

    await wait(300);
    this.process = null;
    console.log('[OpenClawGatewayManager] Gateway stopped');
  }

  /**
   * Check if gateway is running
   */
  get isRunning(): boolean {
    return this.inProcess || (this.process !== null && !this.process.killed);
  }

  /**
   * Get current port
   */
  get currentPort(): number {
    return this.port;
  }

  /**
   * Get the gateway URL
   */
  get gatewayUrl(): string {
    return `ws://127.0.0.1:${this.port}`;
  }

  getRecentOutput(): { stdout: string; stderr: string } {
    return { stdout: this.recentStdout, stderr: this.recentStderr };
  }

  getLastLaunchCommand(): { command: string; args: string[]; cwd?: string; pid?: number } | null {
    return this.lastLaunchCommand;
  }

  /**
   * Check if gateway is running in-process (vs subprocess).
   * In-process mode cannot receive SIGUSR1 for hot-reload.
   */
  isInProcess(): boolean {
    return this.inProcess;
  }

  /**
   * Send SIGUSR1 to the gateway process for hot-reload (skills/config).
   * On Unix, OpenClaw handles SIGUSR1 to reload config and skills without full restart.
   * On Windows, SIGUSR1 is not supported — no-op.
   */
  sendReloadSignal(): void {
    if (this.inProcess) {
      // In-process gateway: cannot send signal to self
      return;
    }
    if (!this.process || this.process.killed) {
      return;
    }
    if (process.platform === 'win32') {
      // Windows does not support SIGUSR1
      return;
    }
    try {
      this.process.kill('SIGUSR1');
      console.log('[OpenClawGatewayManager] Sent SIGUSR1 for skill/config reload');
    } catch (err) {
      console.warn('[OpenClawGatewayManager] Failed to send SIGUSR1:', err);
    }
  }
}
