/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { getEnhancedEnv } from '@process/utils/shellEnv';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

interface GatewayManagerConfig {
  /** Path to openclaw CLI (default: 'openclaw') */
  cliPath?: string;
  /** Gateway port (default: 18799 for Sudoclaw) */
  port?: number;
  /** Custom environment variables */
  customEnv?: Record<string, string>;
  /** OpenClaw state dir (e.g. ~/.sudoclaw) — set cwd to package/ for reliable module resolution */
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

export class OpenClawGatewayManager extends EventEmitter {
  private process: ChildProcess | null = null;
  private inProcess = false;
  private readonly cliPath: string;
  private readonly port: number;
  private readonly customEnv?: Record<string, string>;
  private readonly stateDir?: string;
  private readonly forceSubprocessGateway: boolean;
  private isStarting = false;
  private startPromise: Promise<number> | null = null;

  constructor(config: GatewayManagerConfig = {}) {
    super();
    this.cliPath = config.cliPath || 'openclaw';
    this.port = config.port || 18799;
    this.customEnv = config.customEnv;
    this.stateDir = config.stateDir;
    this.forceSubprocessGateway = config.forceSubprocessGateway ?? false;
  }

  private resolveCommandPath(cmd: string, envPath?: string): string {
    // Absolute/relative paths: use as-is.
    if (cmd.includes('/') || cmd.includes('\\')) return cmd;
    const p = envPath || process.env.PATH || '';
    const sep = process.platform === 'win32' ? ';' : ':';
    for (const dir of p.split(sep)) {
      if (!dir) continue;
      const candidate = path.join(dir, cmd);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        // continue
      }
    }
    return cmd;
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
    if (this.forceSubprocessGateway) return false;
    if (!this.stateDir) return false;
    const pkgRoot = path.join(this.stateDir, 'cli', 'package');
    const entryPath = path.join(pkgRoot, 'openclaw.mjs');
    const hasEntry = fs.existsSync(entryPath);
    const hasDist = fs.existsSync(path.join(pkgRoot, 'dist', 'entry.mjs')) || fs.existsSync(path.join(pkgRoot, 'dist', 'entry.js'));
    const resolvedCli = this.resolveCommandPath(this.cliPath, process.env.PATH || '');
    const isSudoclaw = resolvedCli.includes('.sudoclaw') && (resolvedCli.includes('bin/openclaw') || resolvedCli.includes('bin\\openclaw'));
    return isSudoclaw && hasEntry && hasDist;
  }

  private async doStartInProcess(): Promise<number> {
    const pkgRoot = path.join(this.stateDir!, 'cli', 'package');
    const entryPath = path.join(pkgRoot, 'openclaw.mjs');
    const origArgv = [...process.argv];
    const origCwd = process.cwd();
    const origStateDir = process.env.OPENCLAW_STATE_DIR;

    process.argv = ['node', entryPath, 'gateway', '--port', String(this.port), '--allow-unconfigured'];
    process.env.OPENCLAW_STATE_DIR = this.stateDir!;
    process.chdir(pkgRoot);

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
    }
  }

  private async doStart(): Promise<number> {
    if (this.canUseInProcess()) {
      return this.doStartInProcess();
    }

    return new Promise((resolve, reject) => {
      const args = ['gateway', '--port', String(this.port), '--allow-unconfigured'];

      // Use enhanced env with shell variables
      const env = getEnhancedEnv(this.customEnv);

      const isWindows = process.platform === 'win32';

      const spawnCwd = this.stateDir ? path.join(this.stateDir, 'cli', 'package') : undefined;
      const launcherPath = spawnCwd ? path.join(spawnCwd, 'launcher.mjs') : null;

      // Sudoclaw: spawn Electron directly with launcher + args. Do NOT pass execPath as an arg to openclaw
      // (wrong: spawn("openclaw", [execPath, "gateway", ...]) — causes "unknown command" error)
      const useDirectElectron = this.stateDir && launcherPath && fs.existsSync(launcherPath) && this.cliPath.includes('.sudoclaw') && (this.cliPath.includes('bin/openclaw') || this.cliPath.includes('bin\\openclaw'));

      let spawnCommand: string;
      let spawnArgs: string[];

      if (useDirectElectron) {
        spawnCommand = process.execPath;
        spawnArgs = [launcherPath!, ...args];
        env.ELECTRON_RUN_AS_NODE = '1';
        if (this.stateDir) env.OPENCLAW_STATE_DIR = this.stateDir;
      } else {
        const resolvedCli = this.resolveCommandPath(this.cliPath, env.PATH);
        spawnCommand = resolvedCli;
        spawnArgs = args;
      }

      if (spawnCwd && fs.existsSync(spawnCwd)) {
        console.log('[OpenClawGatewayManager] Using cwd:', spawnCwd);
      }
      console.log(`[OpenClawGatewayManager] Starting: ${spawnCommand} ${spawnArgs.join(' ')}`);

      this.process = spawn(spawnCommand, spawnArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
        shell: isWindows,
        cwd: spawnCwd && fs.existsSync(spawnCwd) ? spawnCwd : undefined,
      });

      let hasResolved = false;
      let stdoutBuffer = '';
      let stderrBuffer = '';

      // Look for ready signal in stdout
      this.process.stdout?.on('data', (data: Buffer) => {
        const output = data.toString();
        stdoutBuffer += output;
        this.emit('stdout', output);

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
        this.emit('stderr', output);

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
        if (!hasResolved) {
          reject(error);
        }
        this.emit('error', error);
      });

      this.process.on('exit', (code, signal) => {
        console.log(`[OpenClawGatewayManager] Process exited: code=${code}, signal=${signal}`);
        this.emit('exit', { code, signal });
        this.process = null;

        if (!hasResolved) {
          const errorMsg = `Gateway exited with code ${code}.\nStdout: ${stdoutBuffer.slice(-500)}\nStderr: ${stderrBuffer.slice(-500)}`;
          reject(new Error(errorMsg));
        }
      });

      // Timeout fallback - assume ready after 5 seconds if no explicit signal
      // Only resolve if process is still running (not already exited)
      setTimeout(() => {
        if (!hasResolved && this.process && !this.process.killed) {
          hasResolved = true;
          console.log(`[OpenClawGatewayManager] Gateway assumed ready (timeout fallback) on port ${this.port}`);
          this.emit('ready', this.port);
          resolve(this.port);
        }
      }, 5000);
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

    console.log('[OpenClawGatewayManager] Stopping gateway...');

    // Send SIGTERM first
    this.process.kill('SIGTERM');

    // Force kill after timeout
    const forceKillTimeout = setTimeout(() => {
      if (this.process && !this.process.killed) {
        console.log('[OpenClawGatewayManager] Force killing gateway...');
        this.process.kill('SIGKILL');
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
}
