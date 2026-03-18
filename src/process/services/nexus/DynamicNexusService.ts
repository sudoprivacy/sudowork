import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { app } from 'electron';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import * as net from 'net';

const execAsync = promisify(exec);

// URL map for different platforms
const NEXUS_DOWNLOAD_URLS = {
  'darwin-arm64': 'https://github.com/nexi-lab/nexus/releases/download/v0.9.7/nexus-macos-arm64-0.9.7.tar.gz',
  'darwin-x64': 'https://github.com/nexi-lab/nexus/releases/download/v0.9.7/nexus-macos-x86_64-0.9.7.tar.gz',
  'linux-x64': '', // Placeholder - needs real URL
  'win32-x64': 'https://github.com/nexi-lab/nexus/releases/download/v0.9.7/nexus-windows-x86_64-0.9.7.tar.gz',
};

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
    console.log(`[DynamicNexus] ${message}`);
    for (const cb of this._setupCallbacks) cb({ stage, message, percent });
  }

  /**
   * Checks if nexus is already installed locally
   */
  async checkInstalled(): Promise<boolean> {
    const envDir = this.getCondaEnvDir();
    const markerFile = path.join(envDir, CONDA_READY_MARKER);
    const nexusdBin = path.join(envDir, 'bin', 'nexusd');

    return fs.existsSync(markerFile) && fs.existsSync(nexusdBin);
  }

  /**
   * Downloads and installs nexus for the current platform
   */
  async install(): Promise<void> {
    if (this._running) {
      throw new Error('Nexus is already running, please stop it first');
    }

    const platformKey = `${os.platform()}-${os.arch()}`;
    const downloadUrl = NEXUS_DOWNLOAD_URLS[platformKey as keyof typeof NEXUS_DOWNLOAD_URLS];

    if (!downloadUrl) {
      throw new Error(`Nexus is not available for platform ${platformKey}`);
    }

    const envDir = this.getCondaEnvDir();
    let tempTarGzPath = path.join(os.tmpdir(), `nexus-${Date.now()}.tar.gz`);
    // 声明在 try 外，finally 块也能访问
    let useLocalResource = false;
    let resourcePath = '';

    try {
      // 尝试几种可能的本地资源路径
      const possibleResourcePaths = [
        path.join(process.resourcesPath || path.join(__dirname, '../../../..'), 'resources', 'nexus.tar.gz'),
        path.join(__dirname, '../../../../resources', 'nexus.tar.gz'), // Development path
        path.join(process.cwd(), 'resources', 'nexus.tar.gz'), // Fallback path
      ];

      for (const possiblePath of possibleResourcePaths) {
        if (fs.existsSync(possiblePath)) {
          const stats = fs.statSync(possiblePath);
          // 检查是否是真实文件而非占位符（大于1MB）
          if (stats.size >= 1024 * 1024) {
            resourcePath = possiblePath;
            useLocalResource = true;
            break;
          }
        }
      }

      if (useLocalResource && resourcePath) {
        // 在开发环境或有本地资源的情况下，使用本地资源文件
        this.emitSetup('extracting', 'Using local Nexus resource file...');
        tempTarGzPath = resourcePath;
      } else {
        // 如果没有本地资源文件，则从远端下载
        this.emitSetup('downloading', `Downloading Nexus for ${platformKey}...`, 0);

        // Download the tar.gz file with progress reporting
        await this.downloadFileWithRetry(downloadUrl, tempTarGzPath, 3, (percent) => {
          this.emitSetup('downloading', `Downloading Nexus for ${platformKey}... ${percent}%`, percent);
        });
      }

      // Remove old environment if exists
      if (fs.existsSync(envDir)) {
        fs.rmSync(envDir, { recursive: true, force: true });
      }

      // Extract - if tempTarGzPath is the resource path, we need to copy it to temp first
      if (useLocalResource && tempTarGzPath === resourcePath) {
        // Create a temp copy to avoid potential permission issues with the original resource
        const tempCopyPath = path.join(os.tmpdir(), `nexus-resource-${Date.now()}.tar.gz`);
        fs.copyFileSync(tempTarGzPath, tempCopyPath);
        tempTarGzPath = tempCopyPath;
      }

      // Extract
      fs.mkdirSync(envDir, { recursive: true });
      this.emitSetup('extracting', 'Extracting Nexus environment...');
      await execAsync(`tar -xzf "${tempTarGzPath}" -C "${envDir}"`);

      // Run conda-unpack to fix hardcoded paths
      const condaUnpack = path.join(envDir, 'bin', 'conda-unpack');
      fs.chmodSync(condaUnpack, 0o755);
      this.emitSetup('unpacking', 'Running conda-unpack to fix install paths...');
      await execAsync(`"${condaUnpack}"`);

      // Ensure nexusd is executable
      const nexusdBin = path.join(envDir, 'bin', 'nexusd');
      if (!fs.existsSync(nexusdBin)) {
        throw new Error(`nexusd not found at ${nexusdBin} after extraction`);
      }
      fs.chmodSync(nexusdBin, 0o755);

      // Write version marker
      const markerFile = path.join(envDir, CONDA_READY_MARKER);
      fs.writeFileSync(markerFile, app.getVersion());

      this.emitSetup('idle', 'Nexus installation completed successfully');
      console.log('[DynamicNexus] Installation completed');
    } finally {
      // Clean up temp file (only if it's a downloaded file, not the original resource)
      if (!useLocalResource && fs.existsSync(tempTarGzPath)) {
        try {
          fs.unlinkSync(tempTarGzPath);
        } catch (e) {
          // Ignore errors during cleanup
          console.warn('[DynamicNexus] Could not cleanup temp file:', e);
        }
      }
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
    const nexusdBin = path.join(envDir, 'bin', 'nexusd');

    if (!fs.existsSync(nexusdBin)) {
      throw new Error('Nexus not installed. Please install it first.');
    }

    // If the port is already taken (orphaned from a previous session), force-kill it
    // before launching a new process so nexusd doesn't exit with "already running".
    const portOccupied = await this.isPortInUse(this._port);
    if (portOccupied) {
      console.log(`[DynamicNexus] Port ${this._port} already in use — killing orphaned process and restarting`);
      this.emitSetup('starting', `Port ${this._port} already in use. Force-restarting...`);
      await this.killProcessOnPort(this._port);
      // Give the OS a moment to release the port
      await new Promise<void>((resolve) => setTimeout(resolve, 800));
    }

    // Use the python interpreter from the conda env to run nexusd
    const pythonPath = path.join(envDir, 'bin', 'python');
    const executablePath = pythonPath; // Use python from conda env

    // 使用固定参数，包括固定端口
    const spawnArgs = [nexusdBin, '--host', 'localhost', '--profile=embedded', '--auth-type', 'none', '--port', String(this._port)];

    this.emitSetup('starting', `Starting server from: ${nexusdBin} on port ${this._port}`);
    this.process = spawn(executablePath, spawnArgs, { stdio: 'pipe' });

    this.process.stdout?.on('data', (d: Buffer) => {
      console.log(`[DynamicNexus] ${d.toString().trim()}`);
    });
    this.process.stderr?.on('data', (d: Buffer) => {
      console.error(`[DynamicNexus] ${d.toString().trim()}`);
    });
    this.process.on('exit', (code) => {
      console.log(`[DynamicNexus] Process exited with code ${code}`);
      this._running = false;
    });
    this.process.on('error', (err) => {
      console.error(`[DynamicNexus] Failed to start process:`, err);
      this._running = false;
      this.emitSetup('error', `Failed to start process: ${err.message}`);
    });

    await this.waitForPort(this._port, WAIT_PORT_TIMEOUT_NORMAL_MS);
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
      console.log(`[DynamicNexus] Killed process on port ${port}`);
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
   * Returns the path to the conda env directory inside userData.
   * e.g. ~/Library/Application Support/Sudowork/nexus_env
   */
  private getCondaEnvDir(): string {
    return path.join(app.getPath('userData'), 'nexus_env');
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

  private async downloadFileWithRetry(url: string, dest: string, maxRetries = 3, onPercent?: (percent: number) => void): Promise<void> {
    const https = await import('https');

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[DynamicNexus] Attempting download ${attempt}/${maxRetries}: ${url}`);

        await new Promise<void>((resolve, reject) => {
          const file = fs.createWriteStream(dest);

          const request = https.get(url, (response: import('http').IncomingMessage) => {
            if (response.statusCode === 301 || response.statusCode === 302) {
              // Handle redirects
              const redirectUrl = response.headers.location;
              if (redirectUrl) {
                console.log(`[DynamicNexus] Following redirect to: ${redirectUrl}`);
                file.close(() => {
                  try {
                    fs.unlinkSync(dest);
                  } catch (_) {
                    // Ignore error when unlinking destination during redirect
                  }
                  // resolve/reject is delegated to the recursive call; skip outer success log
                  this.downloadFileWithRetry(redirectUrl, dest, 1, onPercent).then(resolve).catch(reject);
                });
                return;
              }
            }

            if (response.statusCode !== 200) {
              reject(new Error(`Download failed with status ${response.statusCode}: ${response.statusMessage}`));
              return;
            }

            const total = parseInt(response.headers['content-length'] ?? '0', 10);
            let received = 0;
            let lastPercent = -1;

            response.on('data', (chunk: Buffer) => {
              received += chunk.length;
              if (total > 0 && onPercent) {
                const pct = Math.round((received / total) * 100);
                if (pct !== lastPercent) {
                  lastPercent = pct;
                  onPercent(pct);
                }
              }
            });

            response.pipe(file);
            file.on('finish', () => {
              file.close(() => resolve());
            });
            file.on('error', (err) => {
              fs.unlink(dest, () => {}); // Clean up on error
              reject(err);
            });
          });

          request.on('error', (err: Error) => {
            fs.unlink(dest, () => {}); // Clean up on error
            reject(err);
          });

          // Add timeout
          request.setTimeout(30000, () => {
            request.abort();
            fs.unlink(dest, () => {});
            reject(new Error('Download timed out after 30 seconds'));
          });
        });

        console.log(`[DynamicNexus] Successfully downloaded to ${dest}`);
        return;
      } catch (error) {
        console.error(`[DynamicNexus] Download attempt ${attempt} failed:`, error.message);

        // 磁盘空间不足，重试没有意义，立即抛出友好提示
        if ((error as NodeJS.ErrnoException).code === 'ENOSPC') {
          throw new Error('磁盘空间不足，无法下载 Nexus，请清理磁盘空间后重试。');
        }

        if (attempt === maxRetries) {
          throw error;
        }

        // Wait before retry
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt)); // Exponential backoff
      }
    }
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
