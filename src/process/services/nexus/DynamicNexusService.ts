import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { app } from 'electron';
import { spawn, exec, execFile } from 'child_process';
import { promisify } from 'util';
import * as net from 'net';
import { getDataPath } from '@process/utils';
import { mainLog, mainWarn, mainError } from '@process/utils/mainLogger';
import runtimeVersions from '@/shared/runtime-versions.json';
import { extractTarGzWithProgress } from '../archiveProgress';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// Marker filename written inside the extracted env to record the app version it was unpacked for.
const CONDA_READY_MARKER = '.nexus-conda-ready';

// Marker written after macOS ad-hoc codesign repair. Presence means the repair has already run
// for this installation, so start() skips it on subsequent launches.
const CODESIGN_REPAIR_MARKER = '.nexus-codesign-repaired';

const NEXUS_HEALTHCHECK_TIMEOUT_MS = 1000; // 1 second
const NEXUS_POLL_INTERVAL_MS = 200;
const NEXUS_DEFAULT_PORT = 12012;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
export type NexusSetupUnsubscribe = () => void;

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

  private getCondaUnpackScriptPath(envDir: string): string | null {
    const binDir = this.getBinDir();
    const candidates = this.isWindows ? ['conda-unpack-script.py', 'conda-unpack.py'] : ['conda-unpack'];

    for (const candidate of candidates) {
      const candidatePath = path.join(envDir, binDir, candidate);
      if (fs.existsSync(candidatePath)) {
        return candidatePath;
      }
    }

    return null;
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

  private getPidFilePath(): string {
    return path.join(getDataPath(), 'nexusd.pid');
  }

  private getReadyFilePath(): string {
    return path.join(getDataPath(), 'nexusd.ready');
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

  hasBundledResource(): boolean {
    return this.getBundledNexusPath() !== null;
  }

  getBundledVersion(): string | undefined {
    const value = runtimeVersions.nexus;
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  /**
   * Returns the nexus runtime version string used as the content of marker files.
   * Falls back to the app version if runtime-versions.json has no nexus entry.
   */
  private getNexusVersion(): string {
    return this.getBundledVersion() ?? app.getVersion();
  }

  /**
   * Returns true when a marker file exists AND its content matches the current
   * nexus runtime version. A version mismatch (upgrade scenario) is treated the
   * same as an absent file so that setup steps re-run automatically.
   */
  private isMarkerCurrent(markerPath: string): boolean {
    if (!fs.existsSync(markerPath)) return false;
    try {
      const content = fs.readFileSync(markerPath, 'utf-8').trim();
      return content === this.getNexusVersion();
    } catch {
      return false;
    }
  }

  private normalizeVersion(value?: string): string | undefined {
    if (!value) return undefined;
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const matched = trimmed.match(/(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)/);
    return matched?.[1] || trimmed.replace(/^v/i, '');
  }

  async getVersionState(): Promise<{ installedVersion?: string; bundledVersion?: string; needsUpgrade: boolean }> {
    const bundledPath = this.getBundledNexusPath();
    const bundledVersion = this.normalizeVersion(this.getBundledVersion());
    const installedVersion = this.normalizeVersion(await this.getInstalledVersion());

    if (!bundledPath || !bundledVersion || !installedVersion) {
      return {
        installedVersion,
        bundledVersion,
        needsUpgrade: false,
      };
    }

    return {
      installedVersion,
      bundledVersion,
      needsUpgrade: installedVersion !== bundledVersion,
    };
  }

  async getInstalledVersion(): Promise<string | undefined> {
    const envDir = this.getCondaEnvDir();
    const pythonPath = this.getPythonPath(envDir);
    const nexusdPath = this.getNexusdPath(envDir);

    if (!fs.existsSync(pythonPath) || !fs.existsSync(nexusdPath)) {
      return undefined;
    }

    try {
      const { stdout, stderr } = await execFileAsync(pythonPath, [nexusdPath, '--version'], {
        timeout: 10_000,
      });
      const raw = `${stdout}\n${stderr}`.trim();
      if (!raw) return undefined;
      const firstLine = raw
        .split('\n')
        .map((line) => line.trim())
        .find(Boolean);
      if (!firstLine) return undefined;
      return this.normalizeVersion(firstLine);
    } catch (error) {
      mainWarn('Nexus', `Failed to get nexusd version: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }

  private getCondaReadyMarkerPath(envDir: string = this.getCondaEnvDir()): string {
    return path.join(envDir, CONDA_READY_MARKER);
  }

  private formatCommandError(error: unknown): string {
    if (!(error instanceof Error)) {
      return String(error);
    }

    const execError = error as Error & { code?: number | string; stdout?: string; stderr?: string };
    const details = [execError.message, execError.code !== undefined ? `code=${String(execError.code)}` : null, execError.stdout?.trim() ? `stdout=${execError.stdout.trim()}` : null, execError.stderr?.trim() ? `stderr=${execError.stderr.trim()}` : null].filter(Boolean);

    return details.join(' | ');
  }

  /** Timeout for conda-unpack execution (10 minutes). conda-unpack traverses all
   *  files in the conda environment to fix hardcoded paths, which can be very slow
   *  on Windows with large environments. */
  private static readonly CONDA_UNPACK_TIMEOUT_MS = 10 * 60 * 1000;

  private async runCondaUnpack(envDir: string): Promise<void> {
    const pythonPath = this.getPythonPath(envDir);
    const condaUnpack = this.getCondaUnpackPath(envDir);
    const condaUnpackScript = this.getCondaUnpackScriptPath(envDir);
    const timeout = DynamicNexusService.CONDA_UNPACK_TIMEOUT_MS;

    if (condaUnpackScript) {
      mainLog('Nexus', `Running conda-unpack via python: ${pythonPath} ${condaUnpackScript}`);
      try {
        await execFileAsync(pythonPath, [condaUnpackScript], { timeout });
        return;
      } catch (error) {
        throw new Error(`conda-unpack script failed: ${this.formatCommandError(error)}`);
      }
    }

    if (!fs.existsSync(condaUnpack)) {
      mainWarn('Nexus', `conda-unpack not found at ${condaUnpack} — skipping`);
      return;
    }

    if (!this.isWindows) {
      fs.chmodSync(condaUnpack, 0o755);
      mainLog('Nexus', `Running conda-unpack via python: ${pythonPath} ${condaUnpack}`);
      try {
        await execFileAsync(pythonPath, [condaUnpack], { timeout });
        return;
      } catch (error) {
        throw new Error(`conda-unpack failed: ${this.formatCommandError(error)}`);
      }
    }

    mainLog('Nexus', `Running conda-unpack executable: ${condaUnpack}`);
    try {
      await execFileAsync(condaUnpack, [], { timeout });
    } catch (error) {
      throw new Error(`conda-unpack executable failed: ${this.formatCommandError(error)}`);
    }
  }

  /**
   * Returns true only when the extracted runtime exists and its install marker
   * matches the bundled/runtime version. This avoids treating a partially
   * extracted env as ready during startup.
   */
  checkInstalledSync(): boolean {
    if (!this.getBundledNexusPath()) {
      return true;
    }

    const envDir = this.getCondaEnvDir();
    const nexusdBin = this.getNexusdPath(envDir);
    if (!fs.existsSync(nexusdBin)) {
      return false;
    }

    return this.isMarkerCurrent(this.getCondaReadyMarkerPath(envDir));
  }

  /** Subscribe to setup progress events (fires on stage transitions). */
  onSetupStatus(cb: NexusSetupCallback): NexusSetupUnsubscribe {
    this._setupCallbacks.push(cb);
    return () => {
      this._setupCallbacks = this._setupCallbacks.filter((registeredCb) => registeredCb !== cb);
    };
  }

  private emitSetup(stage: NexusSetupStage, message: string, percent?: number): void {
    this._setupStage = stage;
    mainLog('Nexus', message);
    for (const cb of this._setupCallbacks) cb({ stage, message, percent });
  }

  /**
   * Checks if nexus is already installed locally.
   * Returns true if no bundled resource is available (Nexus is optional — skip silently).
   * Requires both the nexusd executable and the current install marker so a
   * partial extraction is not mistaken for a completed install.
   */
  async checkInstalled(): Promise<boolean> {
    return this.checkInstalledSync();
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
    const stagingDir = this.getCondaEnvStagingDir();
    const backupDir = this.getCondaEnvBackupDir();

    // Use bundled resource only (no OSS fallback)
    const bundledPath = this.getBundledNexusPath();
    if (!bundledPath) {
      throw new Error(`Nexus bundled resource not found for platform ${platformKey}. Please rebuild the app with nexus resources.`);
    }

    mainLog('Nexus', `Using bundled Nexus from ${bundledPath}...`);

    try {
      let switchedCondaEnv = false;
      this.deletePidFile();
      this.deleteReadyFile();
      this.removeDirIfExists(stagingDir);
      this.removeDirIfExists(backupDir);

      try {
        // Extract directly from bundled resource (no temp copy needed — extractTarGzWithProgress
        // uses read-only streams, so permission issues with the original resource do not apply)
        fs.mkdirSync(stagingDir, { recursive: true });
        this.emitSetup('extracting', 'Extracting Nexus environment...', 0);
        await extractTarGzWithProgress(bundledPath, stagingDir, (percent) => {
          this.emitSetup('extracting', `Extracting Nexus environment... ${percent}%`, percent);
        });

        const stagedNexusdBin = this.getNexusdPath(stagingDir);
        if (!fs.existsSync(stagedNexusdBin)) {
          throw new Error(`nexusd not found at ${stagedNexusdBin} after extraction`);
        }
        if (!this.isWindows) fs.chmodSync(stagedNexusdBin, 0o755);

        await this.switchCondaEnvDirectory(stagingDir);
        switchedCondaEnv = true;

        try {
          // Run conda-unpack to fix hardcoded paths
          this.emitSetup('unpacking', 'Running conda-unpack to fix install paths... (this may take several minutes on Windows)');
          await this.runCondaUnpack(envDir);

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

          // Write version marker (nexus runtime version so upgrades invalidate it)
          const markerFile = path.join(envDir, CONDA_READY_MARKER);
          fs.writeFileSync(markerFile, this.getNexusVersion());

          this.removeDirIfExists(backupDir);

          this.emitSetup('idle', 'Nexus installation completed successfully');
          mainLog('Nexus', 'Installation completed');
          switchedCondaEnv = false;
        } catch (err) {
          if (switchedCondaEnv) {
            await this.rollbackCondaEnvDirectorySwitch(err);
            switchedCondaEnv = false;
          }
          throw err;
        }
      } finally {
        try {
          this.removeDirIfExists(stagingDir);
        } catch {
          // Ignore staging cleanup errors.
        }
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.emitSetup('error', `Installation failed: ${errorMsg}`);
      throw err;
    }
  }

  /**
   * Installs Nexus from bundled resources and starts the server.
   * Keeps setup-event subscription local to the install lifecycle.
   */
  async installAndStart(onSetupStatus?: NexusSetupCallback): Promise<void> {
    const unsubscribe = onSetupStatus ? this.onSetupStatus(onSetupStatus) : null;
    try {
      await this.install();
      await this.start();
    } finally {
      unsubscribe?.();
    }
  }

  /**
   * Starts the nexus service (assumes it's installed).
   * If the fixed port is already serving a healthy Nexus instance, reuse it.
   * Otherwise clear the stale listener before spawning a fresh process.
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

    if (fs.existsSync(this.getPidFilePath())) {
      const stopped = await this.stopManagedPidFromFile('before startup');
      if (!stopped) {
        mainWarn('Nexus', 'Found stale nexusd.pid before startup, removing it before launch');
        this.deletePidFile();
      }
    }

    this.deleteReadyFile();

    // If the port is already taken, clear it synchronously before spawning a new
    // process. Otherwise the readiness check can latch onto the old listener and
    // report a false-positive startup.
    const portOccupied = await this.isPortInUse(this._port);
    if (portOccupied) {
      const occupantPids = await this.getPidsOnPort(this._port);
      const pidSummary = occupantPids.length > 0 ? ` (pid=${occupantPids.join(',')})` : '';
      throw new Error(`Port ${this._port} is still in use after pre-start PID stop${pidSummary}`);
    }

    // Use the python interpreter from the extracted conda env to run nexusd.
    const pythonPath = this.getPythonPath(envDir);
    const executablePath = pythonPath;

    // Use the cluster profile (lite + federation) for local development.
    const spawnArgs = [nexusdBin, '--host', 'localhost', '--profile=cluster', '--auth-type', 'none', '--port', String(this._port)];

    // Point Nexus RecordStore to its own SQLite database under ~/.nexus/
    const nexusDbPath = path.join(getDataPath(), 'nexus_record_store.db');
    const nexusEnv = {
      ...process.env,
      NEXUS_DATABASE_URL: `sqlite:///${nexusDbPath.replace(/\\/g, '/')}`,
    };

    const spawnStart = Date.now();
    this.emitSetup('starting', `Starting server from: ${nexusdBin} on port ${this._port}`);
    mainLog('Nexus', `Spawning: ${executablePath} ${spawnArgs.join(' ')}`);
    this.process = spawn(executablePath, spawnArgs, { stdio: 'pipe', env: nexusEnv });

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

    mainLog('Nexus', `Waiting for healthy Nexus server on port ${this._port}...`);
    await this.waitForHealthyServer(this._port);
    const elapsed = Date.now() - spawnStart;
    mainLog('Nexus', `Server ready — port=${this._port} startup=${elapsed}ms`);
    this._running = true;
    this.emitSetup('ready', `Server ready on http://127.0.0.1:${this._port}`);
  }

  getStartCommandPreview(port = NEXUS_DEFAULT_PORT): { command: string; args: string[] } {
    const envDir = this.getCondaEnvDir();
    const pythonPath = this.getPythonPath(envDir);
    const nexusdBin = this.getNexusdPath(envDir);
    return {
      command: pythonPath,
      args: [nexusdBin, '--host', 'localhost', '--profile=cluster', '--auth-type', 'none', '--port', String(port)],
    };
  }

  /**
   * Stops the nexus service.
   * Stops only the PID recorded in nexusd.pid.
   * This avoids killing unrelated processes that may happen to use the same port.
   */
  async stop(): Promise<void> {
    this._running = false;
    const stopped = await this.stopManagedPidFromFile('on stop');
    if (!stopped) {
      mainWarn('Nexus', 'nexusd.pid not found or does not reference a managed nexusd process, skipping Nexus stop');
    }
    await this.forceKillProcessesOnPort(this._port || NEXUS_DEFAULT_PORT);
    this.deleteReadyFile();
    this.process = null;
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

  private readPidFromFile(): string | null {
    const pidFile = this.getPidFilePath();
    if (!fs.existsSync(pidFile)) {
      return null;
    }

    try {
      const pid = fs.readFileSync(pidFile, 'utf-8').trim();
      return /^\d+$/.test(pid) ? pid : null;
    } catch {
      return null;
    }
  }

  private async getCommandLineForPid(pid: string): Promise<string | null> {
    try {
      if (process.platform === 'win32') {
        const { stdout } = await execAsync(`powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \\"ProcessId = ${pid}\\").CommandLine"`);
        const commandLine = stdout.trim();
        return commandLine || null;
      }

      const { stdout } = await execAsync(`ps -p ${pid} -o command=`);
      const commandLine = stdout.trim();
      return commandLine || null;
    } catch {
      return null;
    }
  }

  private async isPidAlive(pid: string): Promise<boolean> {
    try {
      if (process.platform === 'win32') {
        const { stdout } = await execAsync(`powershell -NoProfile -Command "(Get-Process -Id ${pid} -ErrorAction SilentlyContinue) -ne $null"`);
        return stdout.trim().toLowerCase() === 'true';
      }

      const { stdout } = await execAsync(`ps -p ${pid} -o pid=`);
      return stdout.trim() === pid;
    } catch {
      return false;
    }
  }

  private async waitForPidToExit(pid: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (!(await this.isPidAlive(pid))) {
        return;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, NEXUS_POLL_INTERVAL_MS));
    }

    throw new Error(`Managed nexusd pid ${pid} did not exit within ${timeoutMs}ms`);
  }

  private async isManagedNexusPid(pid: string): Promise<boolean> {
    if (!/^\d+$/.test(pid)) {
      return false;
    }

    if (this.process?.pid === Number(pid)) {
      return true;
    }

    const commandLine = await this.getCommandLineForPid(pid);
    if (!commandLine) {
      return false;
    }

    const normalizedCommand = commandLine.replaceAll('\\', '/').toLowerCase();
    const envDir = this.getCondaEnvDir().replaceAll('\\', '/').toLowerCase();
    const nexusdName = this.isWindows ? 'nexusd.exe' : 'nexusd';

    return normalizedCommand.includes(envDir) && normalizedCommand.includes(nexusdName);
  }

  private deletePidFile(): void {
    const pidFile = this.getPidFilePath();
    if (!fs.existsSync(pidFile)) {
      return;
    }

    try {
      fs.unlinkSync(pidFile);
      mainLog('Nexus', `Removed PID file: ${pidFile}`);
    } catch (err) {
      mainWarn('Nexus', `Failed to remove PID file: ${String(err)}`);
    }
  }

  private deleteReadyFile(): void {
    const readyFile = this.getReadyFilePath();
    if (!fs.existsSync(readyFile)) {
      return;
    }

    try {
      fs.unlinkSync(readyFile);
      mainLog('Nexus', `Removed ready file: ${readyFile}`);
    } catch (err) {
      mainWarn('Nexus', `Failed to remove ready file: ${String(err)}`);
    }
  }

  private async stopManagedPidFromFile(context: 'before startup' | 'on stop'): Promise<boolean> {
    const pidFromFile = this.readPidFromFile();
    if (!pidFromFile) {
      return false;
    }

    if (!(await this.isManagedNexusPid(pidFromFile))) {
      mainWarn('Nexus', `PID ${pidFromFile} from nexusd.pid does not look like a managed nexusd process, skipping stop ${context}`);
      return false;
    }

    const proc = this.process;
    if (proc?.pid === Number(pidFromFile)) {
      proc.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          if (!proc.killed) {
            mainLog('Nexus', `SIGTERM timeout for PID ${pidFromFile}, sending SIGKILL`);
            proc.kill('SIGKILL');
          }
          resolve();
        }, 3000);
        proc.once('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    } else {
      await this.killPids([pidFromFile]);
      await this.waitForPidToExit(pidFromFile, 5000);
    }

    this.deletePidFile();
    return true;
  }

  private async killPids(pids: string[]): Promise<void> {
    if (pids.length === 0) {
      mainLog('Nexus', 'No managed Nexus process found to kill');
      return;
    }

    try {
      if (process.platform === 'win32') {
        for (const pid of pids) {
          await execAsync(`taskkill /F /T /PID ${pid}`).catch(() => {});
        }
      } else {
        for (const pid of pids) {
          await execAsync(`kill -9 ${pid}`).catch(() => {});
        }
      }
      mainLog('Nexus', `Killed managed Nexus process(es): ${pids.join(',')}`);
    } catch {
      // Processes may already be gone, nothing else to do.
    }
  }

  private async forceKillProcessesOnPort(port: number): Promise<void> {
    const pids = await this.getPidsOnPort(port);
    if (pids.length === 0) {
      return;
    }

    mainWarn('Nexus', `Force-killing processes on port ${port}: ${pids.join(',')}`);
    await this.killPids(pids);
  }

  /**
   * Probes whether nexusd is actually reachable on its port.
   * "Running" must mean the HTTP health endpoint responds with status=healthy;
   * a live child-process reference alone is not sufficient.
   */
  async checkActualRunning(): Promise<boolean> {
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
    if (!force && this.isMarkerCurrent(repairMarker)) {
      mainLog('Nexus', 'macOS codesign repair already done for this nexus version — skipping');
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

echo "codesign-repair: signed=$$SIGNED failed=$$FAILED"
`;

    try {
      const { stdout, stderr } = await execAsync(script, { shell: '/bin/bash', timeout: 180000 });
      if (stdout.trim()) mainLog('Nexus', stdout.trim());
      if (stderr.trim()) mainWarn('Nexus', stderr.trim());
      fs.writeFileSync(repairMarker, this.getNexusVersion());
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

  private getCondaEnvStagingDir(): string {
    return path.join(getDataPath(), 'nexus_env.new');
  }

  private getCondaEnvBackupDir(): string {
    return path.join(getDataPath(), 'nexus_env.old');
  }

  private removeDirIfExists(targetPath: string): void {
    if (!fs.existsSync(targetPath)) {
      return;
    }
    fs.rmSync(targetPath, { recursive: true, force: true });
  }

  private killWindowsProcessTree(pid: string): void {
    try {
      execFile('taskkill', ['/PID', pid, '/T', '/F'], { windowsHide: true }, () => {});
    } catch {
      // Best effort only.
    }
  }

  private cleanupWindowsInstallLocks(): void {
    if (!this.isWindows) {
      return;
    }

    const pidFromFile = this.readPidFromFile();
    if (pidFromFile) {
      this.killWindowsProcessTree(pidFromFile);
    }

    void this.getPidsOnPort(NEXUS_DEFAULT_PORT).then((pids) => {
      for (const pid of pids) {
        this.killWindowsProcessTree(pid);
      }
    });

    try {
      const script = ["$patterns = @('.nexus\\\\nexus_env', 'nexusd.exe', '--profile=cluster', '--port 12012')", 'Get-CimInstance Win32_Process | Where-Object { $_.CommandLine } | Where-Object {', '  $cmd = $_.CommandLine', '  foreach ($pattern in $patterns) { if ($cmd -like "*${pattern}*") { return $true } }', '  return $false', '} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }'].join('; ');
      execFile('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true }, () => {});
    } catch {
      // Best effort only.
    }
  }

  private async switchCondaEnvDirectory(stagingDir: string): Promise<void> {
    const activeDir = this.getCondaEnvDir();
    const backupDir = this.getCondaEnvBackupDir();
    const maxAttempts = this.isWindows ? 5 : 1;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        this.removeDirIfExists(backupDir);

        if (fs.existsSync(activeDir)) {
          fs.renameSync(activeDir, backupDir);
        }

        fs.renameSync(stagingDir, activeDir);
        return;
      } catch (err) {
        lastError = err;

        if (!fs.existsSync(activeDir) && fs.existsSync(backupDir)) {
          try {
            fs.renameSync(backupDir, activeDir);
          } catch {
            // Leave backup in place for manual recovery.
          }
        }

        if (attempt === maxAttempts || !this.isWindows) {
          throw err;
        }

        mainWarn('Nexus', `Environment switch failed on attempt ${attempt}/${maxAttempts}: ${err instanceof Error ? err.message : String(err)}`);
        await this.stop().catch(() => {});
        this.cleanupWindowsInstallLocks();
        await wait(attempt * 500);
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async rollbackCondaEnvDirectorySwitch(reason: unknown): Promise<void> {
    const activeDir = this.getCondaEnvDir();
    const backupDir = this.getCondaEnvBackupDir();
    const maxAttempts = this.isWindows ? 5 : 1;
    const reasonText = reason instanceof Error ? reason.message : String(reason);

    if (!fs.existsSync(backupDir)) {
      mainWarn('Nexus', `Skipping env rollback because no backup directory exists. reason=${reasonText}`);
      return;
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        mainWarn('Nexus', `Rolling back failed Nexus environment switch (${attempt}/${maxAttempts}). reason=${reasonText}`);

        if (fs.existsSync(activeDir)) {
          this.removeDirIfExists(activeDir);
        }

        fs.renameSync(backupDir, activeDir);
        mainLog('Nexus', 'Restored previous Nexus environment after install failure');
        return;
      } catch (rollbackErr) {
        if (attempt === maxAttempts || !this.isWindows) {
          throw rollbackErr;
        }

        mainWarn('Nexus', `Rollback failed on attempt ${attempt}/${maxAttempts}: ${rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)}`);
        await this.stop().catch(() => {});
        this.cleanupWindowsInstallLocks();
        await wait(attempt * 500);
      }
    }
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

  private async waitForHealthyServer(port: number, timeoutMs?: number): Promise<void> {
    const deadline = timeoutMs === undefined ? Number.POSITIVE_INFINITY : Date.now() + timeoutMs;

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
