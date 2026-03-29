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

// Marker written after macOS ad-hoc codesign repair. Presence means the repair has already run
// for this installation, so start() skips it on subsequent launches.
const CODESIGN_REPAIR_MARKER = '.nexus-codesign-repaired';

// How long to wait for the server port after extraction (first run can be slow).
const WAIT_PORT_TIMEOUT_AFTER_SETUP_MS = 5 * 60 * 1000; // 5 minutes
const WAIT_PORT_TIMEOUT_NORMAL_MS = 30 * 1000; // 30 seconds
const WAIT_PORT_RELEASE_TIMEOUT_MS = 10 * 1000; // 10 seconds
const NEXUS_HEALTHCHECK_TIMEOUT_MS = 1000; // 1 second
const NEXUS_POLL_INTERVAL_MS = 200;
const NEXUS_DEFAULT_PORT = 12012;

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

        // Repair code signatures on macOS: strip conda-forge Team IDs and ad-hoc re-sign
        // all native libraries and executables so dlopen succeeds without Team ID conflicts.
        // force=true because this is always a fresh install — ignore any stale marker.
        this.emitSetup('unpacking', 'Repairing native library signatures (macOS)...');
        await this.repairMacOSLibrarySignatures(envDir, true);

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
    this._port = NEXUS_DEFAULT_PORT;
    this._running = false;

    const envDir = this.getCondaEnvDir();
    const nexusdBin = this.getNexusdPath(envDir);

    if (!fs.existsSync(nexusdBin)) {
      throw new Error('Nexus not installed. Please install it first.');
    }

    // One-time macOS codesign repair for existing installations that were extracted before
    // this fix was introduced. repairMacOSLibrarySignatures() is a no-op if the marker file
    // already exists (written by install() or a previous start()), so this adds no overhead
    // on subsequent launches.
    await this.repairMacOSLibrarySignatures(envDir);

    // If the port is already taken, clear it synchronously before spawning a new
    // process. Otherwise the readiness check can latch onto the old listener and
    // report a false-positive startup.
    const portOccupied = await this.isPortInUse(this._port);
    if (portOccupied) {
      const occupantPids = await this.getPidsOnPort(this._port);
      const pidSummary = occupantPids.length > 0 ? ` (pid=${occupantPids.join(',')})` : '';
      mainWarn('Nexus', `Port ${this._port} already in use${pidSummary} — clearing before restart`);
      this.emitSetup('starting', `Port ${this._port} already in use. Force-restarting...`);
      await this.killProcessOnPort(this._port);
      await this.waitForPortToBeFree(this._port, WAIT_PORT_RELEASE_TIMEOUT_MS);
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

    mainLog('Nexus', `Waiting for healthy Nexus server on port ${this._port} (timeout ${WAIT_PORT_TIMEOUT_NORMAL_MS}ms)...`);
    await this.waitForHealthyServer(this._port, WAIT_PORT_TIMEOUT_NORMAL_MS);
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
      // Use SIGKILL instead of SIGTERM: SIGKILL cannot be caught or ignored and takes
      // effect immediately. SIGTERM requires the process to handle it, but Electron's
      // before-quit handler is async and the app may exit before nexusd processes SIGTERM,
      // leaving it orphaned (adopted by launchd on macOS).
      this.process.kill('SIGKILL');
      this.process = null;
    }
    this._running = false;
    // Synchronous fallback: kill any process still holding the port.
    // execSync is used deliberately here — stop() is called from the synchronous
    // portion of before-quit and we need cleanup to complete before the process exits.
    if (this._port > 0 && process.platform !== 'win32') {
      try {
        const { execSync } = require('child_process');
        execSync(`lsof -ti tcp:${this._port} | xargs kill -9 2>/dev/null || true`, { timeout: 2000 });
      } catch {
        // Port was already free or lsof unavailable — ignore
      }
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

  private async getPidsOnPort(port: number): Promise<string[]> {
    try {
      if (process.platform === 'win32') {
        const { stdout } = await execAsync(`netstat -ano | findstr :${port} | findstr LISTENING`);
        return stdout
          .trim()
          .split('\n')
          .map((line) => line.trim().split(/\s+/).at(-1) ?? '')
          .filter((pid) => /^\d+$/.test(pid) && pid !== '0');
      }

      const { stdout } = await execAsync(`lsof -ti tcp:${port}`);
      return stdout
        .trim()
        .split('\n')
        .map((pid) => pid.trim())
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * Force-kills whatever process is currently holding the given TCP port.
   * macOS/Linux: lsof + kill -9
   * Windows: netstat + taskkill
   */
  private async killProcessOnPort(port: number): Promise<void> {
    const pids = await this.getPidsOnPort(port);
    if (pids.length === 0) {
      mainLog('Nexus', `No process found on port ${port}`);
      return;
    }

    try {
      if (process.platform === 'win32') {
        for (const pid of pids) {
          await execAsync(`taskkill /F /PID ${pid}`).catch(() => {});
        }
      } else {
        for (const pid of pids) {
          await execAsync(`kill -9 ${pid}`).catch(() => {});
        }
      }
      mainLog('Nexus', `Killed process on port ${port}: ${pids.join(',')}`);
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

    const port = this._port > 0 ? this._port : NEXUS_DEFAULT_PORT;
    const healthy = await this.isHealthyNexusServer(port);
    if (healthy) {
      this._port = port;
    }
    this._running = healthy;
    return healthy;
  }

  /**
   * Strip existing code signatures and apply a uniform ad-hoc signature to all
   * native libraries (.dylib / .so) and Mach-O executables inside the conda env.
   *
   * Why this is needed on macOS:
   *   conda-forge signs its libraries with its own Team ID. When the conda env is
   *   re-signed by the Sudowork build pipeline (afterPack.js), a signing failure on
   *   any individual file leaves it with the original conda-forge Team ID while
   *   others receive the Sudowork Team ID. macOS then refuses to dlopen the mismatched
   *   library ("different Team IDs"). Ad-hoc signing removes Team IDs from all files,
   *   making them consistent and lifting the restriction.
   *
   *   Re-signing executables (python, nexusd …) is equally important: a process signed
   *   with Hardened Runtime + a Team ID enforces Library Validation and will only load
   *   dylibs with the SAME Team ID. After ad-hoc re-signing, the process has no Team ID
   *   and no Hardened Runtime, so Library Validation is not enforced.
   *
   * @param envDir  Path to the extracted conda environment directory.
   * @param force   If false (default) the method is a no-op when the repair marker
   *                already exists, preventing redundant work on subsequent launches.
   */
  async repairMacOSLibrarySignatures(envDir: string, force = false): Promise<void> {
    if (process.platform !== 'darwin') return;

    const repairMarker = path.join(envDir, CODESIGN_REPAIR_MARKER);
    if (!force && fs.existsSync(repairMarker)) {
      mainLog('Nexus', 'macOS codesign repair already done — skipping');
      return;
    }

    mainLog('Nexus', 'Repairing native library code signatures (macOS ad-hoc re-sign)...');

    // Single bash invocation: strip + ad-hoc sign all .dylib / .so files, then all
    // Mach-O binaries under bin/.  Using process substitution (<(...)) requires bash.
    const script = `
SIGNED=0; FAILED=0

# 1. Native libraries
while IFS= read -r -d '' f; do
  codesign --remove-signature "$f" 2>/dev/null || true
  if codesign --force --sign - "$f" 2>/dev/null; then
    SIGNED=$((SIGNED+1))
  else
    echo "  warn: could not sign $f" >&2
    FAILED=$((FAILED+1))
  fi
done < <(find "${envDir}" \\( -name "*.dylib" -o -name "*.so" \\) -print0)

# 2. Mach-O executables in bin/ (removes hardened-runtime so Library Validation is not enforced)
while IFS= read -r -d '' f; do
  if file "$f" 2>/dev/null | grep -q "Mach-O"; then
    codesign --remove-signature "$f" 2>/dev/null || true
    if codesign --force --sign - "$f" 2>/dev/null; then
      SIGNED=$((SIGNED+1))
    else
      echo "  warn: could not sign $f" >&2
      FAILED=$((FAILED+1))
    fi
  fi
done < <(find "${envDir}/bin" -maxdepth 1 -type f -print0)

echo "codesign-repair: signed=\$SIGNED failed=\$FAILED"
`;

    try {
      const { stdout, stderr } = await execAsync(script, { shell: '/bin/bash', timeout: 180000 });
      if (stdout.trim()) mainLog('Nexus', stdout.trim());
      if (stderr.trim()) mainWarn('Nexus', stderr.trim());
      fs.writeFileSync(repairMarker, app.getVersion());
      mainLog('Nexus', 'macOS codesign repair complete');
    } catch (err) {
      mainWarn('Nexus', `macOS codesign repair encountered errors (non-fatal): ${err}`);
    }
  }

  /**
   * Returns the path to the conda env directory.
   * Uses ~/.nexus/nexus_env for consistency with other runtime components.
   */
  private getCondaEnvDir(): string {
    return path.join(getDataPath(), 'nexus_env');
  }

  private async waitForPortToBeFree(port: number, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (!(await this.isPortInUse(port))) {
        return;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, NEXUS_POLL_INTERVAL_MS));
    }

    const pids = await this.getPidsOnPort(port);
    const pidSummary = pids.length > 0 ? ` (pid=${pids.join(',')})` : '';
    throw new Error(`Port ${port} is still in use after ${timeoutMs}ms${pidSummary}`);
  }

  private async isHealthyNexusServer(port: number): Promise<boolean> {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(NEXUS_HEALTHCHECK_TIMEOUT_MS),
      });
      const payload = (await response.json()) as { status?: string };
      return payload.status === 'healthy';
    } catch {
      return false;
    }
  }

  private async waitForHealthyServer(port: number, timeoutMs = 10000): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (this.process?.exitCode !== null && this.process?.exitCode !== undefined) {
        throw new Error(`nexusd exited before becoming ready (code=${this.process.exitCode})`);
      }

      if (this.process?.signalCode) {
        throw new Error(`nexusd exited before becoming ready (signal=${this.process.signalCode})`);
      }

      if (await this.isHealthyNexusServer(port)) {
        return;
      }

      await new Promise<void>((resolve) => setTimeout(resolve, NEXUS_POLL_INTERVAL_MS));
    }

    throw new Error(`[DynamicNexus] Nexus server did not become healthy within ${timeoutMs}ms`);
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
