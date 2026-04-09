import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import * as https from 'https';
import * as http from 'http';
import { app } from 'electron';
import { spawn, exec, execFile } from 'child_process';
import { promisify } from 'util';
import * as net from 'net';
import { getDataPath } from '@process/utils';
import { mainLog, mainWarn, mainError } from '@process/utils/mainLogger';
import runtimeVersions from '@/shared/runtime-versions.json';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// Marker filename written inside the bin directory to record the version it was installed for.
const NEXUS_READY_MARKER = '.nexus-bin-ready';

const NEXUS_HEALTHCHECK_TIMEOUT_MS = 1000; // 1 second
const NEXUS_POLL_INTERVAL_MS = 200;
const NEXUS_DEFAULT_PORT = 12012;

/** OSS base URL for downloading Nexus binaries at runtime */
const NEXUS_OSS_BASE_URL = 'https://sudoclaw-1309794936.cos.ap-beijing.myqcloud.com';
const NEXUS_GITHUB_RELEASE_BASE_URL = 'https://github.com/nexi-lab/nexus/releases/download';

/** Platform name mapping: Node.js process.platform → Nexus binary OS name */
const OS_NAME_MAP: Record<string, string> = { darwin: 'macos', win32: 'windows', linux: 'linux' };
/** Architecture mapping: Node.js process.arch → Nexus binary arch name */
const ARCH_NAME_MAP: Record<string, string> = { arm64: 'arm64', x64: 'x86_64' };

export type NexusSetupStage =
  | 'idle'
  | 'checking' // Checking if already installed
  | 'downloading' // Downloading nexusd binary
  | 'installing' // Copying binary to ~/.nexus/bin/
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
   * Get the nexusd executable name for the current platform.
   */
  private getNexusdName(): string {
    return this.isWindows ? 'nexusd.exe' : 'nexusd';
  }

  /**
   * Get the platform-specific binary name used in download URLs and versioned resource filenames.
   * e.g. 'nexus-cluster-macos-arm64' or 'nexus-cluster-windows-x86_64.exe'
   */
  getPlatformBinaryName(): string {
    const osName = OS_NAME_MAP[process.platform];
    const archName = ARCH_NAME_MAP[process.arch];
    if (!osName || !archName) throw new Error(`Unsupported platform: ${process.platform}-${process.arch}`);
    const base = `nexus-cluster-${osName}-${archName}`;
    return this.isWindows ? `${base}.exe` : base;
  }

  /**
   * Get the versioned resource filename for the current platform and bundled version.
   * e.g. 'v0.9.28-nexus-cluster-macos-arm64'
   */
  getVersionedBinaryName(): string {
    const version = this.getNexusVersion();
    return `v${version}-${this.getPlatformBinaryName()}`;
  }

  /**
   * Get the OSS download URL for the current platform's Nexus binary.
   * e.g. https://sudoclaw-1309794936.cos.ap-beijing.myqcloud.com/v0.9.28/nexus-cluster-macos-arm64
   */
  private getOssDownloadUrl(): string {
    const version = this.getNexusVersion();
    return `${NEXUS_OSS_BASE_URL}/v${version}/${this.getPlatformBinaryName()}`;
  }

  private getGitHubDownloadUrl(): string {
    const version = this.getNexusVersion();
    return `${NEXUS_GITHUB_RELEASE_BASE_URL}/v${version}/${this.getPlatformBinaryName()}`;
  }

  /**
   * Get the installed nexusd binary path: ~/.nexus/bin/nexusd (or nexusd.exe on Windows)
   */
  private getInstalledNexusdPath(): string {
    return path.join(getDataPath(), 'bin', this.getNexusdName());
  }

  private getPidFilePath(): string {
    return path.join(getDataPath(), 'nexusd.pid');
  }

  private getReadyFilePath(): string {
    return path.join(getDataPath(), 'nexusd.ready');
  }

  private getReadyMarkerPath(): string {
    return path.join(getDataPath(), 'bin', NEXUS_READY_MARKER);
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
    const bundledVersion = this.normalizeVersion(this.getBundledVersion());
    const installedVersion = this.normalizeVersion(await this.getInstalledVersion());

    if (!bundledVersion || !installedVersion) {
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
    const nexusdPath = this.getInstalledNexusdPath();

    if (!fs.existsSync(nexusdPath)) {
      return undefined;
    }

    if (this.isMarkerCurrent(this.getReadyMarkerPath())) {
      return this.normalizeVersion(this.getNexusVersion());
    }

    try {
      const { stdout, stderr } = await execFileAsync(nexusdPath, ['--version'], {
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

  /**
   * Returns true only when the installed binary exists and its install marker
   * matches the bundled/runtime version.
   */
  checkInstalledSync(): boolean {
    const nexusdBin = this.getInstalledNexusdPath();
    return fs.existsSync(nexusdBin) && this.isMarkerCurrent(this.getReadyMarkerPath());
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
   */
  async checkInstalled(): Promise<boolean> {
    return this.checkInstalledSync();
  }

  /**
   * Get the bundled Nexus resource path (the versioned binary file in resources).
   * Looks for versioned filename e.g. v0.9.28-nexus-cluster-macos-arm64.
   * Returns null if not found or too small (placeholder).
   */
  private getBundledNexusPath(): string | null {
    const versionedName = this.getVersionedBinaryName();

    // Packaged app: check resourcesPath
    if (app.isPackaged) {
      const packagedPath = path.join(process.resourcesPath, versionedName);
      if (fs.existsSync(packagedPath)) {
        const stats = fs.statSync(packagedPath);
        if (stats.size >= 1024 * 1024) {
          return packagedPath;
        }
      }
    }

    // Development mode: check resources directory
    const devPath = path.join(app.getAppPath(), 'resources', versionedName);
    if (fs.existsSync(devPath)) {
      const stats = fs.statSync(devPath);
      if (stats.size >= 1024 * 1024) {
        return devPath;
      }
    }

    return null;
  }

  /**
   * Download a file from a URL (HTTP/HTTPS) with redirect support.
   * Emits download progress events.
   */
  private downloadFile(url: string, destPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let redirects = 0;

      const doRequest = (requestUrl: string): void => {
        if (redirects++ > 10) {
          reject(new Error('Too many redirects'));
          return;
        }

        const protocol = requestUrl.startsWith('https') ? https : http;
        protocol
          .get(requestUrl, (response) => {
            if ([301, 302, 307, 308].includes(response.statusCode!) && response.headers.location) {
              mainLog('Nexus', `Download redirect → ${response.headers.location}`);
              doRequest(response.headers.location);
              return;
            }

            if (response.statusCode !== 200) {
              reject(new Error(`HTTP ${response.statusCode}`));
              return;
            }

            const totalSize = parseInt(response.headers['content-length'] || '0', 10);
            let downloaded = 0;
            const file = fs.createWriteStream(destPath);

            response.on('data', (chunk: Buffer) => {
              downloaded += chunk.length;
              if (totalSize > 0) {
                const percent = Math.round((downloaded / totalSize) * 100);
                this.emitSetup('downloading', `Downloading Nexus... ${percent}%`, percent);
              }
            });

            response.pipe(file);

            file.on('finish', () => {
              file.close();
              resolve();
            });

            file.on('error', (err) => {
              try {
                fs.unlinkSync(destPath);
              } catch {}
              reject(err);
            });
          })
          .on('error', (err) => {
            try {
              fs.unlinkSync(destPath);
            } catch {}
            reject(err);
          });
      };

      doRequest(url);
    });
  }

  /**
   * Installs nexus for the current platform.
   * Prefers bundled resources, then OSS, then GitHub release assets.
   * Copies the binary to ~/.nexus/bin/nexusd (or nexusd.exe) and sets executable permission.
   */
  async install(): Promise<void> {
    if (this._running) {
      throw new Error('Nexus is already running, please stop it first');
    }

    const platformKey = `${os.platform()}-${os.arch()}`;
    let sourcePath: string | null = null;

    const versionedName = this.getVersionedBinaryName();
    const downloadDir = path.join(getDataPath(), 'downloads');
    const downloadDest = path.join(downloadDir, versionedName);
    const bundledPath = this.getBundledNexusPath();
    if (bundledPath) {
      sourcePath = bundledPath;
      mainLog('Nexus', `Using bundled Nexus binary from ${bundledPath}`);
    } else {
      fs.mkdirSync(downloadDir, { recursive: true });

      const downloadAttempts = [
        { label: 'OSS', url: this.getOssDownloadUrl() },
        { label: 'GitHub', url: this.getGitHubDownloadUrl() },
      ];

      let lastError: string | null = null;

      for (const attempt of downloadAttempts) {
        this.emitSetup('downloading', `Downloading Nexus binary from ${attempt.label}...`, 0);
        mainLog('Nexus', `Downloading Nexus from ${attempt.label} for ${platformKey}: ${attempt.url}`);

        try {
          await this.downloadFile(attempt.url, downloadDest);
          if (!this.isWindows) {
            fs.chmodSync(downloadDest, 0o755);
          }
          sourcePath = downloadDest;
          mainLog('Nexus', `Downloaded Nexus binary from ${attempt.label} to ${downloadDest}`);
          break;
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          mainWarn('Nexus', `${attempt.label} download failed: ${lastError}`);
        }
      }

      if (!sourcePath) {
        const errorMsg = lastError ?? 'unknown error';
        this.emitSetup('error', `Failed to download Nexus runtime: ${errorMsg}`);
        throw new Error(`Nexus binary not available for platform ${platformKey}. Resource missing, OSS download failed, and GitHub download failed: ${errorMsg}`);
      }
    }

    mainLog('Nexus', `Using Nexus binary from ${sourcePath}...`);

    try {
      this.deletePidFile();
      this.deleteReadyFile();

      const binDir = path.join(getDataPath(), 'bin');
      const destPath = this.getInstalledNexusdPath();

      // Ensure bin directory exists
      fs.mkdirSync(binDir, { recursive: true });

      this.emitSetup('installing', 'Copying Nexus binary...', 0);

      // Copy the binary to ~/.nexus/bin/nexusd
      fs.copyFileSync(sourcePath, destPath);

      this.emitSetup('installing', 'Setting permissions...', 50);

      // Make binary executable on macOS/Linux
      if (!this.isWindows) {
        fs.chmodSync(destPath, 0o755);
      }

      // Write version marker
      const markerFile = this.getReadyMarkerPath();
      fs.writeFileSync(markerFile, this.getNexusVersion());

      this.emitSetup('idle', 'Nexus installation completed successfully', 100);
      mainLog('Nexus', `Installation completed: ${destPath}`);
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
   * Resolves the nexusd binary path to use for execution.
   */
  private resolveNexusdBinForExec(): string {
    const newPath = this.getInstalledNexusdPath();
    if (fs.existsSync(newPath)) {
      return newPath;
    }

    throw new Error('Nexus not installed. Please install it first.');
  }

  private resolveStartCommand(port = NEXUS_DEFAULT_PORT): { command: string; args: string[] } {
    const newPath = this.getInstalledNexusdPath();
    if (fs.existsSync(newPath)) {
      return {
        command: newPath,
        args: ['--host', 'localhost', '--profile=cluster', '--auth-type', 'none', '--port', String(port)],
      };
    }

    throw new Error('Nexus not installed. Please install it first.');
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

    const nexusdBin = this.resolveNexusdBinForExec();
    const launchCommand = this.resolveStartCommand(this._port);

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

    // Point Nexus RecordStore to its own SQLite database under ~/.nexus/
    const nexusDbPath = path.join(getDataPath(), 'nexus_record_store.db');
    const nexusEnv = {
      ...process.env,
      NEXUS_DATABASE_URL: `sqlite:///${nexusDbPath.replace(/\\/g, '/')}`,
    };

    const spawnStart = Date.now();
    this.emitSetup('starting', `Starting server from: ${nexusdBin} on port ${this._port}`);
    mainLog('Nexus', `Spawning: ${launchCommand.command} ${launchCommand.args.join(' ')}`);
    this.process = spawn(launchCommand.command, launchCommand.args, { stdio: 'pipe', env: nexusEnv });

    this.process.stdout?.on('data', (d: Buffer) => {
      mainLog('Nexus:stdout', d.toString().trim());
    });
    this.process.stderr?.on('data', (d: Buffer) => {
      const msg = d.toString().trim();
      if (!msg) return;
      // Nexus writes info/debug logs to stderr; only escalate warnings and errors
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
    return this.resolveStartCommand(port);
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
    const nexusdName = this.getNexusdName().toLowerCase();

    const binDir = path.join(getDataPath(), 'bin').replaceAll('\\', '/').toLowerCase();

    return normalizedCommand.includes(nexusdName) && normalizedCommand.includes(binDir);
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
