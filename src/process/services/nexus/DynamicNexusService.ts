import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { app } from 'electron';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import * as net from 'net';
import * as tar from 'tar';
import { getDataPath } from '@process/utils';
import { mainLog, mainWarn, mainError } from '@process/utils/mainLogger';

const execAsync = promisify(exec);

// Marker filename written inside the extracted env to record the app version it was unpacked for.
const CONDA_READY_MARKER = '.nexus-conda-ready';

// How long to wait for the server port after extraction (first run can be slow).
const WAIT_PORT_TIMEOUT_AFTER_SETUP_MS = 5 * 60 * 1000; // 5 minutes
const WAIT_PORT_TIMEOUT_NORMAL_MS = 30 * 1000; // 30 seconds

export type NexusSetupStage =
  | 'idle'
  | 'checking' // Checking if already installed
  | 'downloading' // Downloading nexus.tar.gz
  | 'extracting' // tar -xzf in progress
  | 'unpacking' // conda-unpack in progress
  | 'starting' // server process launched, waiting for port
  | 'ready'
  | 'error';

export interface NexusSetupStatus {
  stage: NexusSetupStage;
  message: string;
  percent?: number;
}

export type NexusSetupCallback = (status: NexusSetupStatus) => void;

class DynamicNexusService {
  private process: import('child_process').ChildProcess | null = null;
  private _running = false;
  private _port = 0;
  private _setupStage: NexusSetupStage = 'idle';
  private _setupCallbacks: NexusSetupCallback[] = [];
  private readonly isWindows = process.platform === 'win32';

  /**
   * Get the bin/Scripts directory name for the current platform.
   * Windows uses 'Scripts', macOS/Linux uses 'bin'.
   */
  private getBinDir(): string {
    return this.isWindows ? 'Scripts' : 'bin';
  }

  /**
   * Get the nexusd executable path for the current platform.
   */
  private getNexusdPath(envDir: string): string {
    const binDir = this.getBinDir();
    if (this.isWindows) {
      return path.join(envDir, binDir, 'nexusd.exe');
    }
    return path.join(envDir, binDir, 'nexusd');
  }

  /**
   * Get the conda-unpack executable path for the current platform.
   */
  private getCondaUnpackPath(envDir: string): string {
    const binDir = this.getBinDir();
    if (this.isWindows) {
      return path.join(envDir, binDir, 'conda-unpack.exe');
    }
    return path.join(envDir, binDir, 'conda-unpack');
  }

  /**
   * Get the python executable path for the current platform.
   * On Windows, python.exe is in the root directory of the conda env.
   * On macOS/Linux, it's in bin/python.
   */
  private getPythonPath(envDir: string): string {
    if (this.isWindows) {
      return path.join(envDir, 'python.exe');
    }
    return path.join(envDir, 'bin', 'python');
  }

  get isRunning(): boolean {
    return this._running;
  }

  get port(): number {
    return this._port;
  }

  get setupStage(): NexusSetupStage {
    return this._setupStage;
  }

  /** Subscribe to setup progress events (fires on stage transitions). */
  onSetupStatus(cb: NexusSetupCallback): void {
    this._setupCallbacks.push(cb);
  }

  private emitSetup(stage: NexusSetupStage, message: string, percent?: number): void {
    this._setupStage = stage;
    mainLog('Nexus', message);
    for (const cb of this._setupCallbacks) cb({ stage, message, percent });
  }

  /**
   * Checks if nexus is already installed locally.
   * Returns true if no bundled resource is available (Nexus is optional — skip silently).
   * Only checks for the nexusd executable (consistent with Node/Sudoclaw pattern).
   */
  async checkInstalled(): Promise<boolean> {
    // No bundle available → Nexus is not required for this build, treat as "installed"
    if (!this.getBundledNexusPath()) {
      return true;
    }

    const envDir = this.getCondaEnvDir();
    const nexusdBin = this.getNexusdPath(envDir);
    return fs.existsSync(nexusdBin);
  }

  /**
   * Get the bundled Nexus resource path.
   * Returns null if not found.
   */
  private getBundledNexusPath(): string | null {
    // Packaged app: check resourcesPath
    if (app.isPackaged) {
      const packagedPath = path.join(process.resourcesPath, 'nexus.tar.gz');
      if (fs.existsSync(packagedPath)) {
        const stats = fs.statSync(packagedPath);
        if (stats.size >= 1024 * 1024) {
          return packagedPath;
        }
      }
    }

    // Development mode: check resources directory
    const devPath = path.join(app.getAppPath(), 'resources', 'nexus.tar.gz');
    if (fs.existsSync(devPath)) {
      const stats = fs.statSync(devPath);
      if (stats.size >= 1024 * 1024) {
        return devPath;
      }
    }

    return null;
  }

  /**
   * Installs nexus for the current platform from bundled resources.
   */
  async install(): Promise<void> {
    if (this._running) {
      throw new Error('Nexus is already running, please stop it first');
    }

    const platformKey = `${os.platform()}-${os.arch()}`;
    const envDir = this.getCondaEnvDir();

    // Use bundled resource only (no OSS fallback)
    const bundledPath = this.getBundledNexusPath();
    if (!bundledPath) {
      throw new Error(`Nexus bundled resource not found for platform ${platformKey}. Please rebuild the app with nexus resources.`);
    }

    mainLog('Nexus', `Using bundled Nexus from ${bundledPath}...`);

    try {
      // Remove old environment if exists
      if (fs.existsSync(envDir)) {
        fs.rmSync(envDir, { recursive: true, force: true });
      }

      // Copy to temp to avoid permission issues with original resource
      const tempTarGzPath = path.join(os.tmpdir(), `nexus-${Date.now()}.tar.gz`);
      fs.copyFileSync(bundledPath, tempTarGzPath);

      try {
        // Extract
        fs.mkdirSync(envDir, { recursive: true });
        this.emitSetup('extracting', 'Extracting Nexus environment...');
        await tar.x({ file: tempTarGzPath, cwd: envDir });

        // Run conda-unpack to fix hardcoded paths
        const condaUnpack = this.getCondaUnpackPath(envDir);
        if (fs.existsSync(condaUnpack)) {
          if (!this.isWindows) fs.chmodSync(condaUnpack, 0o755);
          this.emitSetup('unpacking', 'Running conda-unpack to fix install paths...');
          if (this.isWindows) {
            // On Windows, conda-unpack.exe is a binary executable, run it directly
            await execAsync(`"${condaUnpack}"`);
          } else {
            // On macOS/Linux, use python from conda env to run conda-unpack (shebang may point to wrong path)
            const pythonBin = this.getPythonPath(envDir);
            await execAsync(`"${pythonBin}" "${condaUnpack}"`);
          }
        }

        // Ensure nexusd is executable
        const nexusdBin = this.getNexusdPath(envDir);
        if (!fs.existsSync(nexusdBin)) {
          throw new Error(`nexusd not found at ${nexusdBin} after extraction`);
        }
        if (!this.isWindows) fs.chmodSync(nexusdBin, 0o755);

        // Write version marker
        const markerFile = path.join(envDir, CONDA_READY_MARKER);
        fs.writeFileSync(markerFile, app.getVersion());

        this.emitSetup('idle', 'Nexus installation completed successfully');
        mainLog('Nexus', 'Installation completed');
      } finally {
        // Clean up temp file
        if (fs.existsSync(tempTarGzPath)) {
          try {
            fs.unlinkSync(tempTarGzPath);
          } catch {
            // Ignore errors during cleanup
          }
        }
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.emitSetup('error', `Installation failed: ${errorMsg}`);
      throw err;
    }
  }

  /**
   * Starts the nexus service (assumes it's installed).
   * If the port is already occupied by an orphaned nexusd from a previous
   * session, the old process is killed before a fresh one is spawned.
   */
  async start(): Promise<void> {
    if (this._running) return;

    // 使用固定端口 12012
    this._port = 12012;

    const envDir = this.getCondaEnvDir();
    const nexusdBin = this.getNexusdPath(envDir);

    if (!fs.existsSync(nexusdBin)) {
      throw new Error('Nexus not installed. Please install it first.');
    }

    // If the port is already taken (orphaned from a previous session), fire-and-forget
    // the kill so we don't block here. waitForPort() below handles the retry loop.
    const portOccupied = await this.isPortInUse(this._port);
    if (portOccupied) {
      mainLog('Nexus', `Port ${this._port} already in use — killing orphaned process (non-blocking)`);
      this.emitSetup('starting', `Port ${this._port} already in use. Force-restarting...`);
      // Fire-and-forget the kill; give the OS a small moment to begin releasing the port,
      // then proceed to spawn. waitForPort() will retry until the new process is ready.
      void this.killProcessOnPort(this._port);
      await new Promise<void>((resolve) => setTimeout(resolve, 300));
    }

    // Remove stale PID file if exists (nexusd checks this on startup)
    // On Windows, os.kill(pid, 0) in nexus's _is_nexusd_process() fails with WinError 87,
    // so we need to clean up the PID file before starting a new instance.
    const pidFile = path.join(getDataPath(), 'nexusd.pid');
    if (fs.existsSync(pidFile)) {
      try {
        fs.unlinkSync(pidFile);
        mainLog('Nexus', `Removed stale PID file: ${pidFile}`);
      } catch (err) {
        mainWarn('Nexus', `Failed to remove PID file: ${err}`);
      }
    }

    // Use the python interpreter from the extracted conda env to run nexusd.
    const pythonPath = this.getPythonPath(envDir);
    const executablePath = pythonPath;

    // Use the full profile on the fixed localhost port.
    const spawnArgs = [nexusdBin, '--host', 'localhost', '--profile=full', '--auth-type', 'none', '--port', String(this._port)];

    const spawnStart = Date.now();
    this.emitSetup('starting', `Starting server from: ${nexusdBin} on port ${this._port}`);
    mainLog('Nexus', `Spawning: ${executablePath} ${spawnArgs.join(' ')}`);
    this.process = spawn(executablePath, spawnArgs, { stdio: 'pipe' });

    this.process.stdout?.on('data', (d: Buffer) => {
      mainLog('Nexus:stdout', d.toString().trim());
    });
    this.process.stderr?.on('data', (d: Buffer) => {
      const msg = d.toString().trim();
      if (!msg) return;
      // Nexus (Python) writes info/debug logs to stderr; only escalate warnings and errors
      if (/\[(warn|warning|error|critical)\s*\]/i.test(msg)) {
        mainError('Nexus:stderr', msg);
      }
    });
    this.process.on('exit', (code, signal) => {
      mainLog('Nexus', `Process exited — code=${code} signal=${signal} uptime=${Date.now() - spawnStart}ms`);
      this._running = false;
    });
    this.process.on('error', (err) => {
      mainError('Nexus', `Failed to start process: ${err.message}`);
      this._running = false;
      this.emitSetup('error', `Failed to start process: ${err.message}`);
    });

    mainLog('Nexus', `Waiting for port ${this._port} (timeout ${WAIT_PORT_TIMEOUT_NORMAL_MS}ms)...`);
    await this.waitForPort(this._port, WAIT_PORT_TIMEOUT_NORMAL_MS);
    const elapsed = Date.now() - spawnStart;
    mainLog('Nexus', `Server ready — port=${this._port} startup=${elapsed}ms`);
    this._running = true;
    this.emitSetup('ready', `Server ready on http://127.0.0.1:${this._port}`);
  }

  /**
   * Stops the nexus service.
   * Kills the tracked child process first, then also force-kills any orphaned
   * nexusd that may still be holding the port (e.g. if the child exited but
   * nexusd itself was spawned as a sub-process and detached).
   */
  stop(): void {
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
    }
    this._running = false;
    // Fire-and-forget: ensure no orphaned process keeps the port occupied
    if (this._port > 0) {
      this.killProcessOnPort(this._port).catch(() => {});
    }
  }

  /**
   * Returns true when something is already listening on the given port.
   */
  private isPortInUse(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = net.connect(port, '127.0.0.1', () => {
        socket.destroy();
        resolve(true);
      });
      socket.on('error', () => resolve(false));
    });
  }

  /**
   * Force-kills whatever process is currently holding the given TCP port.
   * macOS/Linux: lsof + kill -9
   * Windows: netstat + taskkill
   */
  private async killProcessOnPort(port: number): Promise<void> {
    try {
      if (process.platform === 'win32') {
        const { stdout } = await execAsync(`netstat -ano | findstr :${port} | findstr LISTENING`);
        for (const line of stdout.trim().split('\n')) {
          const parts = line.trim().split(/\s+/);
          const pid = parts[parts.length - 1];
          if (pid && /^\d+$/.test(pid) && pid !== '0') {
            await execAsync(`taskkill /F /PID ${pid}`).catch(() => {});
          }
        }
      } else {
        // macOS / Linux
        await execAsync(`lsof -ti tcp:${port} | xargs kill -9 2>/dev/null || true`);
      }
      mainLog('Nexus', `Killed process on port ${port}`);
    } catch {
      // Port was already free, nothing to do
    }
  }

  /**
   * Probes whether nexusd is actually reachable on its port.
   * Falls back to a port check when the internal _running flag is false
   * (e.g. child exited but an orphaned process is still serving).
   */
  async checkActualRunning(): Promise<boolean> {
    // Check if the process is actually running by verifying the process object exists
    // and hasn't exited, which is more reliable than port checking
    if (this.process && !this.process.killed && this._running) {
      return true;
    }

    // If process object is gone but we think it's running, update our internal state
    if (this._running) {
      this._running = false;
    }

    return false;
  }

  private findFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as net.AddressInfo;
        server.close((err) => (err ? reject(err) : resolve(addr.port)));
      });
      server.on('error', reject);
    });
  }

  /**
   * Returns the path to the conda env directory.
   * Uses ~/.nexus/nexus_env for consistency with other runtime components.
   */
  private getCondaEnvDir(): string {
    return path.join(getDataPath(), 'nexus_env');
  }

  private waitForPort(port: number, timeoutMs = 10000): Promise<void> {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + timeoutMs;

      const attempt = () => {
        const socket = net.connect(port, '127.0.0.1', () => {
          socket.destroy();
          resolve();
        });
        socket.on('error', () => {
          if (Date.now() >= deadline) {
            reject(new Error(`[DynamicNexus] Server did not start within ${timeoutMs}ms`));
            return;
          }
          setTimeout(attempt, 200);
        });
      };

      attempt();
    });
  }
}

export const dynamicNexusService = new DynamicNexusService();

// Export convenience functions for use in IPC or other contexts
export const installNexusService = async (): Promise<void> => {
  await dynamicNexusService.install();
};

export const checkNexusInstalled = async (): Promise<boolean> => {
  return await dynamicNexusService.checkInstalled();
};

export const startNexusIfInstalled = async (): Promise<boolean> => {
  const isInstalled = await dynamicNexusService.checkInstalled();
  if (isInstalled) {
    await dynamicNexusService.start();
    return true;
  }
  return false;
};
