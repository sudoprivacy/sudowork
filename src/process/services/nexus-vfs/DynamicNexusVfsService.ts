import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import * as http from 'http';
import * as net from 'net';
import * as crypto from 'crypto';
import { app } from 'electron';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import { mainLog, mainWarn, mainError } from '@process/utils/mainLogger';
import { processSupervisor } from '@process/ProcessSupervisor';
import runtimeVersions from '@/shared/runtime-versions.json';
import runtimeSha256 from '@/shared/runtime-sha256.json';
import { COS_RUNTIME_BASE, COS_LEGACY_NEXUS_VFS_BASE } from '@/shared/cos';
import { extractTarGzWithProgress, extractZipWithProgress } from '../archiveProgress';
import { vaultPluginInstaller } from './VaultPluginInstaller';

const execAsync = promisify(exec);

/**
 * nexus-vfs — a third managed runtime, independent of and additive to the
 * existing Nexus (~/.nexus, port 12012) and Sudocode runtimes. It launches the
 * `nexusd-cluster` daemon from the nexus-vfs repo (version pinned in runtime-versions.json) under ~/.nexus-vfs
 * and binds gRPC on 127.0.0.1:12022.
 *
 * Differences from DynamicNexusService that matter here:
 *  - nexusd-cluster speaks gRPC only; there is NO HTTP /health endpoint, so
 *    readiness is a TCP-connect probe against the bind port.
 *  - Its CLI is --hostname / --bind-addr / --bootstrap-mode / --data-dir /
 *    --no-tls (NOT --host/--port/--profile/--auth-type). bootstrap-mode `static`
 *    with empty peers brings up a healthy single-node 1-voter zone.
 */

const NEXUS_VFS_BIND_HOST = '127.0.0.1';
const NEXUS_VFS_DEFAULT_PORT = 12022;
const NEXUS_VFS_POLL_INTERVAL_MS = 200;
const NEXUS_VFS_START_TIMEOUT_MS = 30_000;

/** Marker file recording the installed version inside the bin directory. */
const NEXUS_VFS_READY_MARKER = '.nexus-vfs-bin-ready';

/** COS mirrors hosting the nexus-vfs artifacts. Runtime bucket is primary; the
 *  legacy bucket stays live as a fallback during deprecation. Both serve the same
 *  bytes (server-side copy), so the SHA256 check below holds for either source. */
const NEXUS_VFS_RUNTIME_BASE_URL = `${COS_RUNTIME_BASE}/nexus-vfs/release`;
const NEXUS_VFS_LEGACY_BASE_URL = `${COS_LEGACY_NEXUS_VFS_BASE}/nexus-vfs/release`;

/** Node.js process.platform → artifact OS token. */
const OS_NAME_MAP: Record<string, string> = { darwin: 'macos', win32: 'windows', linux: 'linux' };
/** Node.js process.arch → artifact arch token (note: arm64 → aarch64). */
const ARCH_NAME_MAP: Record<string, string> = { arm64: 'aarch64', x64: 'x86_64' };

/** Known-good SHA256 sums for the cluster binaries. Sourced from
 *  `src/shared/runtime-sha256.json` so the build-time downloader
 *  (`scripts/download-nexus-vfs.js`) and this runtime re-installer always
 *  see the SAME bytes. Pre-#918 these were two parallel hand-maintained
 *  tables; bumping the script alone left this side stuck on the old
 *  SHA, which is exactly how the v0.3.0 Mac smoke broke. */
const NEXUS_VFS_SHA256SUMS: Record<string, string> = runtimeSha256 as Record<string, string>;

export type NexusVfsStage = 'idle' | 'checking' | 'downloading' | 'installing' | 'starting' | 'ready' | 'error';

export interface NexusVfsStatus {
  stage: NexusVfsStage;
  message: string;
  percent?: number;
}

export type NexusVfsCallback = (status: NexusVfsStatus) => void;
export type NexusVfsUnsubscribe = () => void;

class DynamicNexusVfsService {
  private process: import('child_process').ChildProcess | null = null;
  private _running = false;
  private _port = 0;
  private _stage: NexusVfsStage = 'idle';
  private _callbacks: NexusVfsCallback[] = [];
  private readonly isWindows = process.platform === 'win32';

  get isRunning(): boolean {
    return this._running;
  }

  get port(): number {
    return this._port;
  }

  get setupStage(): NexusVfsStage {
    return this._stage;
  }

  resetRunningState(): void {
    this._running = false;
    this.process = null;
  }

  onSetupStatus(cb: NexusVfsCallback): NexusVfsUnsubscribe {
    this._callbacks.push(cb);
    return () => {
      this._callbacks = this._callbacks.filter((registered) => registered !== cb);
    };
  }

  private emit(stage: NexusVfsStage, message: string, percent?: number): void {
    this._stage = stage;
    mainLog('NexusVfs', message);
    for (const cb of this._callbacks) cb({ stage, message, percent });
  }

  // ── Paths ──────────────────────────────────────────────────────────────────

  /** Install root: ~/.nexus-vfs (parallel to ~/.nexus, never inside it). */
  private getInstallRoot(): string {
    return path.join(app.getPath('home'), '.nexus-vfs');
  }

  private getBinDir(): string {
    return path.join(this.getInstallRoot(), 'bin');
  }

  /** Persistent data directory passed to the daemon via --data-dir. */
  private getDaemonDataDir(): string {
    return path.join(this.getInstallRoot(), 'data');
  }

  private getBinaryName(): string {
    return this.isWindows ? 'nexusd-cluster.exe' : 'nexusd-cluster';
  }

  private getInstalledBinaryPath(): string {
    return path.join(this.getBinDir(), this.getBinaryName());
  }

  private getReadyMarkerPath(): string {
    return path.join(this.getBinDir(), NEXUS_VFS_READY_MARKER);
  }

  // ── Version / artifact resolution ────────────────────────────────────────────

  getBundledVersion(): string {
    return (runtimeVersions as Record<string, string>)['nexus-vfs'];
  }

  private getArtifactName(): string {
    const osName = OS_NAME_MAP[process.platform];
    const archName = ARCH_NAME_MAP[process.arch];
    if (!osName || !archName) {
      throw new Error(`nexus-vfs: unsupported platform ${process.platform}-${process.arch}`);
    }
    const ext = this.isWindows ? '.zip' : '.tar.gz';
    return `nexusd-cluster-${osName}-${archName}${ext}`;
  }

  /** Versioned archive filename matching the extraResources filter in electron-builder.yml.
   *  Pattern: v${VERSION}-nexusd-cluster-${os}-${arch}.${ext} */
  private getVersionedArchiveName(): string {
    return `v${this.getBundledVersion()}-${this.getArtifactName()}`;
  }

  /** Find the locally bundled nexus-vfs archive from the packaged app's
   *  extraResources or the development resources directory. Returns null if
   *  not found (caller should fall back to remote download). */
  private getBundledNexusVfsPath(): string | null {
    const versionedName = this.getVersionedArchiveName();

    if (app.isPackaged) {
      const packagedPath = path.join(process.resourcesPath, versionedName);
      if (fs.existsSync(packagedPath)) {
        const stats = fs.statSync(packagedPath);
        if (stats.size >= 1024 * 100) {
          return packagedPath;
        }
      }
    }

    // Development mode
    const devPath = path.join(app.getAppPath(), 'resources', versionedName);
    if (fs.existsSync(devPath)) {
      const stats = fs.statSync(devPath);
      if (stats.size >= 1024 * 100) {
        return devPath;
      }
    }

    return null;
  }

  /** Ordered download URLs: runtime bucket first, legacy bucket as fallback. */
  private getDownloadUrls(): { label: string; url: string }[] {
    const tail = `v${this.getBundledVersion()}/${this.getArtifactName()}`;
    return [
      { label: 'Runtime COS', url: `${NEXUS_VFS_RUNTIME_BASE_URL}/${tail}` },
      { label: 'Legacy COS', url: `${NEXUS_VFS_LEGACY_BASE_URL}/${tail}` },
    ];
  }

  // ── Install state ────────────────────────────────────────────────────────────

  private isMarkerCurrent(): boolean {
    const marker = this.getReadyMarkerPath();
    if (!fs.existsSync(marker)) return false;
    try {
      return fs.readFileSync(marker, 'utf-8').trim() === this.getBundledVersion();
    } catch {
      return false;
    }
  }

  checkInstalledSync(): boolean {
    return fs.existsSync(this.getInstalledBinaryPath()) && this.isMarkerCurrent() && (!vaultPluginInstaller.isPlatformSupported() || vaultPluginInstaller.checkInstalledSync());
  }

  async checkInstalled(): Promise<boolean> {
    return this.checkInstalledSync();
  }

  // ── Download + install ───────────────────────────────────────────────────────

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
            const code = response.statusCode;
            if (code && [301, 302, 307, 308].includes(code) && response.headers.location) {
              response.resume();
              doRequest(response.headers.location);
              return;
            }

            if (code === 404) {
              response.resume();
              reject(new Error('NOT_FOUND'));
              return;
            }

            if (code !== 200) {
              response.resume();
              reject(new Error(`HTTP ${code}`));
              return;
            }

            const totalSize = parseInt(response.headers['content-length'] || '0', 10);
            let downloaded = 0;
            const file = fs.createWriteStream(destPath);

            response.on('data', (chunk: Buffer) => {
              downloaded += chunk.length;
              if (totalSize > 0) {
                const percent = Math.round((downloaded / totalSize) * 100);
                this.emit('downloading', `Downloading nexus-vfs... ${percent}%`, percent);
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

  private async extractArchive(archivePath: string, targetDir: string): Promise<void> {
    // Archives wrap everything in a single top-level dir
    // (nexusd-cluster-<os>-<arch>/), so strip it to drop files straight into bin.
    if (archivePath.endsWith('.zip')) {
      await extractZipWithProgress(archivePath, targetDir, undefined, { strip: 1 });
    } else if (archivePath.endsWith('.tar.gz') || archivePath.endsWith('.tgz')) {
      await extractTarGzWithProgress(archivePath, targetDir, undefined, { strip: 1 });
    } else {
      throw new Error(`Unsupported archive format: ${archivePath}`);
    }
  }

  /**
   * Downloads nexus-vfs from the COS mirror and installs the binary to
   * ~/.nexus-vfs/bin. A missing platform artifact (HTTP 404) surfaces a clear
   * error — no GitHub fallback, no guessing alternate paths.
   */
  async install(): Promise<void> {
    if (this._running) {
      throw new Error('nexus-vfs is already running, please stop it first');
    }

    const binDir = this.getBinDir();
    const downloadDir = path.join(this.getInstallRoot(), 'downloads');
    fs.mkdirSync(downloadDir, { recursive: true });
    fs.mkdirSync(binDir, { recursive: true });

    // Try bundled local resource first, then fall back to remote download.
    const bundledPath = this.getBundledNexusVfsPath();
    let archivePath: string;

    if (bundledPath) {
      archivePath = bundledPath;
      mainLog('NexusVfs', `Using bundled nexus-vfs archive from ${bundledPath}`);
      this.emit('downloading', `Using bundled nexus-vfs from ${bundledPath}`, 0);
    } else {
      mainLog('NexusVfs', 'Bundled nexus-vfs not found, attempting remote download...');
      archivePath = path.join(downloadDir, this.getArtifactName());

      const attempts = this.getDownloadUrls();
      let downloaded = false;
      let lastReason = 'unknown error';
      let allNotFound = true;
      for (const attempt of attempts) {
        this.emit('downloading', `Downloading nexus-vfs from ${attempt.label} (${attempt.url})`, 0);
        try {
          await this.downloadFile(attempt.url, archivePath);
          downloaded = true;
          break;
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          lastReason = reason;
          if (reason !== 'NOT_FOUND') allNotFound = false;
          mainWarn('NexusVfs', `${attempt.label} download failed: ${reason}`);
        }
      }

      if (!downloaded) {
        if (allNotFound) {
          const msg = `nexus-vfs binary not available for ${process.platform}-${process.arch} in v${this.getBundledVersion()} (all COS mirrors → HTTP 404)`;
          this.emit('error', msg);
          throw new Error(msg);
        }
        this.emit('error', `Failed to download nexus-vfs: ${lastReason}`);
        throw new Error(lastReason);
      }
    }

    // Integrity check before we trust the archive — reject anything unverified.
    const expectedSha = NEXUS_VFS_SHA256SUMS[this.getArtifactName()];
    if (!expectedSha) {
      throw new Error(`No known SHA256 for ${this.getArtifactName()}; refusing to install an unverified artifact.`);
    }
    const actualSha = crypto.createHash('sha256').update(fs.readFileSync(archivePath)).digest('hex');
    if (actualSha !== expectedSha) {
      // Only delete the downloaded file, not a bundled resource.
      if (!bundledPath) {
        try {
          fs.unlinkSync(archivePath);
        } catch {}
      }
      const msg = `nexus-vfs SHA256 mismatch for ${this.getArtifactName()}: expected ${expectedSha}, got ${actualSha}`;
      this.emit('error', msg);
      throw new Error(msg);
    }
    mainLog('NexusVfs', `SHA256 verified: ${actualSha}`);

    this.emit('installing', 'Extracting nexus-vfs...', 80);
    const extractDir = path.join(downloadDir, `extract-${Date.now()}`);
    fs.mkdirSync(extractDir, { recursive: true });
    await this.extractArchive(archivePath, extractDir);

    const extractedBinary = path.join(extractDir, this.getBinaryName());
    if (!fs.existsSync(extractedBinary)) {
      throw new Error(`nexus-vfs archive did not contain expected binary ${this.getBinaryName()}`);
    }

    const targetBinary = this.getInstalledBinaryPath();
    fs.copyFileSync(extractedBinary, targetBinary);
    if (!this.isWindows) {
      fs.chmodSync(targetBinary, 0o755);
    }
    fs.writeFileSync(this.getReadyMarkerPath(), this.getBundledVersion());

    try {
      fs.rmSync(extractDir, { recursive: true, force: true });
      // Only delete the downloaded archive, not a bundled resource.
      if (!bundledPath) {
        fs.unlinkSync(archivePath);
      }
    } catch {}

    this.emit('idle', `nexus-vfs installed: ${targetBinary}`, 100);

    await vaultPluginInstaller.install((stage, message, percent) => this.emit(stage, message, percent));
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  private getPluginDir(): string {
    return path.join(this.getInstallRoot(), 'plugins');
  }

  private resolveStartCommand(port: number): { command: string; args: string[] } {
    const bin = this.getInstalledBinaryPath();
    if (!fs.existsSync(bin)) {
      throw new Error('nexus-vfs not installed. Please install it first.');
    }
    const pluginDir = this.getPluginDir();
    const args = ['--hostname', 'localhost', '--bind-addr', `${NEXUS_VFS_BIND_HOST}:${port}`, '--bootstrap-mode', 'static', '--data-dir', this.getDaemonDataDir(), '--no-tls'];
    if (vaultPluginInstaller.isPlatformSupported() && vaultPluginInstaller.checkInstalledSync()) {
      args.push('--plugin-dir', pluginDir);
    }
    return { command: bin, args };
  }

  getStartCommandPreview(port = NEXUS_VFS_DEFAULT_PORT): { command: string; args: string[] } {
    return this.resolveStartCommand(port);
  }

  async start(): Promise<void> {
    if (this._running) return;

    this._port = NEXUS_VFS_DEFAULT_PORT;
    this._running = false;

    const launchCommand = this.resolveStartCommand(this._port);

    // Clear any stale listener before spawning, otherwise the readiness probe can
    // latch onto an old process and report a false-positive start.
    if (await this.isPortInUse(this._port)) {
      await this.forceKillProcessesOnPort(this._port);
      if (await this.isPortInUse(this._port)) {
        throw new Error(`nexus-vfs port ${this._port} is still in use after pre-start cleanup`);
      }
    }

    fs.mkdirSync(this.getDaemonDataDir(), { recursive: true });

    const spawnStart = Date.now();
    this.emit('starting', `Starting nexus-vfs on ${NEXUS_VFS_BIND_HOST}:${this._port}`);
    mainLog('NexusVfs', `Spawning: ${launchCommand.command} ${launchCommand.args.join(' ')}`);
    // Inject NEXUS_DATA_DIR so signed plugins (vault et al.) use the canonical
    // data root instead of the upstream `./nexus-data` relative-path fallback
    // (vault v0.1.3 rust/services/vault/src/lib.rs:47-52). Without this, macOS
    // Finder launches with cwd=/ hit EROFS under SIP and panic; Windows silently
    // writes vault data to whatever cwd the shortcut/exe inherited.
    // Spread process.env first, then assign — Node spawn does NOT inherit env
    // when the option is set, so PATH/HOME/etc. must be carried explicitly.
    this.process = spawn(launchCommand.command, launchCommand.args, {
      stdio: 'pipe',
      env: { ...process.env, NEXUS_DATA_DIR: this.getDaemonDataDir() },
    });
    processSupervisor.track(this.process);

    this.process.stdout?.on('data', (d: Buffer) => {
      const msg = d.toString().trim();
      if (msg) mainLog('NexusVfs:stdout', msg);
    });
    this.process.stderr?.on('data', (d: Buffer) => {
      const msg = d.toString().trim();
      if (!msg) return;
      // nexusd-cluster writes structured tracing logs (INFO/WARN) to stderr;
      // only escalate genuine errors.
      if (/\b(ERROR|CRITICAL)\b/.test(msg)) {
        mainError('NexusVfs:stderr', msg);
      } else {
        mainLog('NexusVfs:stderr', msg);
      }
    });
    this.process.on('exit', (code, signal) => {
      mainLog('NexusVfs', `Process exited — code=${code} signal=${signal} uptime=${Date.now() - spawnStart}ms`);
      this._running = false;
    });
    this.process.on('error', (err) => {
      mainError('NexusVfs', `Failed to start process: ${err.message}`);
      this._running = false;
      this.emit('error', `Failed to start process: ${err.message}`);
    });

    mainLog('NexusVfs', `Waiting for nexus-vfs gRPC port ${this._port} to accept connections...`);
    await this.waitForPortReady(this._port, NEXUS_VFS_START_TIMEOUT_MS);
    const elapsed = Date.now() - spawnStart;
    mainLog('NexusVfs', `nexus-vfs ready — port=${this._port} startup=${elapsed}ms`);
    this._running = true;
    this.emit('ready', `nexus-vfs ready on ${NEXUS_VFS_BIND_HOST}:${this._port}`);
  }

  async stop(): Promise<void> {
    this._running = false;
    const proc = this.process;
    if (proc && proc.exitCode === null && !proc.killed) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          if (proc.exitCode === null && !proc.killed) {
            mainWarn('NexusVfs', 'SIGTERM timeout, sending SIGKILL');
            proc.kill('SIGKILL');
          }
          resolve();
        }, 3000);
        proc.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
        proc.kill('SIGTERM');
      });
    }
    // Fallback: clear anything still bound to the port.
    await this.forceKillProcessesOnPort(this._port || NEXUS_VFS_DEFAULT_PORT);
    this.process = null;
  }

  async installAndStart(onSetupStatus?: NexusVfsCallback): Promise<void> {
    const unsubscribe = onSetupStatus ? this.onSetupStatus(onSetupStatus) : null;
    try {
      if (!this.checkInstalledSync()) {
        await this.install();
      }
      await this.start();
    } finally {
      unsubscribe?.();
    }
  }

  // ── Port / readiness helpers ─────────────────────────────────────────────────

  /** Readiness = TCP connection accepted on the gRPC bind port. */
  private isPortInUse(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = net.connect(port, NEXUS_VFS_BIND_HOST, () => {
        socket.destroy();
        resolve(true);
      });
      socket.on('error', () => resolve(false));
    });
  }

  private async waitForPortReady(port: number, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.process?.exitCode !== null && this.process?.exitCode !== undefined) {
        throw new Error(`nexus-vfs exited before becoming ready (code=${this.process.exitCode})`);
      }
      if (this.process?.signalCode) {
        throw new Error(`nexus-vfs exited before becoming ready (signal=${this.process.signalCode})`);
      }
      if (await this.isPortInUse(port)) {
        return;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, NEXUS_VFS_POLL_INTERVAL_MS));
    }
    throw new Error(`nexus-vfs did not start listening on port ${port} within ${timeoutMs}ms`);
  }

  async checkActualRunning(): Promise<boolean> {
    const port = this._port > 0 ? this._port : NEXUS_VFS_DEFAULT_PORT;
    const listening = await this.isPortInUse(port);
    if (listening) this._port = port;
    this._running = listening;
    return listening;
  }

  private async getPidsOnPort(port: number): Promise<string[]> {
    try {
      if (this.isWindows) {
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

  private async forceKillProcessesOnPort(port: number): Promise<void> {
    const pids = await this.getPidsOnPort(port);
    if (pids.length === 0) return;
    mainWarn('NexusVfs', `Force-killing processes on port ${port}: ${pids.join(',')}`);
    for (const pid of pids) {
      try {
        if (this.isWindows) {
          await execAsync(`taskkill /F /T /PID ${pid}`).catch(() => {});
        } else {
          await execAsync(`kill -9 ${pid}`).catch(() => {});
        }
      } catch {
        // Process may already be gone.
      }
    }
  }
}

export const dynamicNexusVfsService = new DynamicNexusVfsService();

export const installNexusVfsService = async (): Promise<void> => {
  await dynamicNexusVfsService.install();
};

export const startNexusVfsIfInstalled = async (): Promise<boolean> => {
  if (await dynamicNexusVfsService.checkInstalled()) {
    await dynamicNexusVfsService.start();
    return true;
  }
  return false;
};
