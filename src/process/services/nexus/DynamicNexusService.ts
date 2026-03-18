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
  'darwin-arm64': 'https://github.com/sudoprivacy/sudorepo/releases/download/v0.0.1/mac-arm-nexus.tar.gz',
  'darwin-x64': 'https://github.com/sudoprivacy/sudorepo/releases/download/v0.0.1/mac-x64-nexus.tar.gz', // Placeholder - needs real URL
  'linux-x64': 'https://github.com/sudoprivacy/sudorepo/releases/download/v0.0.1/linux-x64-nexus.tar.gz', // Placeholder - needs real URL
  'win32-x64': 'https://github.com/sudoprivacy/sudorepo/releases/download/v0.0.1/win-x64-nexus.tar.gz', // Placeholder - needs real URL
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
   * Starts the nexus service (assumes it's installed)
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
   * Stops the nexus service
   */
  stop(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this._running = false;
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
