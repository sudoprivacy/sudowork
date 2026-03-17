import { app } from 'electron';
import { spawn, exec } from 'child_process';
import type { ChildProcess } from 'child_process';
import { promisify } from 'util';
import * as net from 'net';
import * as path from 'path';
import * as fs from 'fs';

const execAsync = promisify(exec);

// Marker filename written inside the extracted env to record the app version it was unpacked for.
// When the app version changes, the env is re-extracted automatically.
const CONDA_READY_MARKER = '.nexus-conda-ready';

// How long to wait for the server port after extraction (first run can be slow).
const WAIT_PORT_TIMEOUT_AFTER_SETUP_MS = 5 * 60 * 1000; // 5 minutes
const WAIT_PORT_TIMEOUT_NORMAL_MS = 30 * 1000;           // 30 seconds

export type NexusSetupStage =
  | 'idle'
  | 'extracting'   // tar -xzf in progress
  | 'unpacking'    // conda-unpack in progress
  | 'starting'     // server process launched, waiting for port
  | 'ready'
  | 'error';

export interface NexusSetupStatus {
  stage: NexusSetupStage;
  message: string;
}

export type NexusSetupCallback = (status: NexusSetupStatus) => void;

class NexusService {
  private process: ChildProcess | null = null;
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

  private emitSetup(stage: NexusSetupStage, message: string): void {
    this._setupStage = stage;
    console.log(`[Nexus] ${message}`);
    for (const cb of this._setupCallbacks) cb({ stage, message });
  }

  async start(): Promise<void> {
    if (this._running) return;

    this._port = await this.findFreePort();

    let executablePath: string;
    let spawnArgs: string[];
    let justExtracted = false;

    if (app.isPackaged && process.platform !== 'win32') {
      // Packaged macOS / Linux: use conda-packed environment
      const result = await this.ensureCondaEnv();
      executablePath = result.nexusdBin;
      justExtracted = result.justExtracted;
      spawnArgs = [String(this._port)];
    } else if (app.isPackaged || this.devBinaryExists()) {
      // Packaged Windows or dev with pre-built PyInstaller binary
      executablePath = this.resolveScriptPath();
      spawnArgs = [String(this._port)];
    } else {
      // Development (no binary): resolve python3 from the user's login shell
      const python3 = await this.resolvePython3Dev();
      console.log(`[Nexus] Using Python: ${python3}`);
      executablePath = python3;
      spawnArgs = [this.resolveScriptPath(), String(this._port)];
    }

    this.emitSetup('starting', `Starting server from: ${executablePath} on port ${this._port}`);
    this.process = spawn(executablePath, spawnArgs, { stdio: 'pipe' });

    this.process.stdout?.on('data', (d: Buffer) => {
      console.log(`[Nexus] ${d.toString().trim()}`);
    });
    this.process.stderr?.on('data', (d: Buffer) => {
      console.error(`[Nexus] ${d.toString().trim()}`);
    });
    this.process.on('exit', (code) => {
      console.log(`[Nexus] Process exited with code ${code}`);
      this._running = false;
    });
    this.process.on('error', (err) => {
      console.error(`[Nexus] Failed to start process:`, err);
      this._running = false;
      this.emitSetup('error', `Failed to start process: ${err.message}`);
    });

    // Use a longer timeout after first-run extraction since the env may need
    // additional warm-up time (library loading, etc.)
    const timeoutMs = justExtracted
      ? WAIT_PORT_TIMEOUT_AFTER_SETUP_MS
      : WAIT_PORT_TIMEOUT_NORMAL_MS;
    await this.waitForPort(this._port, timeoutMs);
    this._running = true;
    this.emitSetup('ready', `Server ready on http://127.0.0.1:${this._port}`);
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

  stop(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this._running = false;
  }

  /** In dev mode, find a python3 that has psutil via the user's interactive shell. */
  private resolvePython3Dev(): Promise<string> {
    return new Promise((resolve) => {
      const shell = process.env.SHELL || '/bin/zsh';
      // Run inside interactive shell so conda/pyenv PATH is active.
      // The python command prints its own executable path only if psutil is importable.
      // We filter stdout to lines starting with '/' to discard session-restore banners.
      const cmd = `${shell} -i -c "python3 -c \\"import psutil, sys; print(sys.executable)\\"" 2>/dev/null`;
      exec(cmd, { timeout: 8000 }, (_err, stdout) => {
        const p = stdout
          .split('\n')
          .map((l) => l.trim())
          .find((l) => l.startsWith('/'));
        resolve(p || 'python3');
      });
    });
  }

  private devBinaryExists(): boolean {
    const ext = process.platform === 'win32' ? '.exe' : '';
    return fs.existsSync(path.join(app.getAppPath(), 'nexus', 'dist', `server${ext}`));
  }

  private resolveScriptPath(): string {
    if (app.isPackaged) {
      const ext = process.platform === 'win32' ? '.exe' : '';
      return path.join(process.resourcesPath, 'nexus', `server${ext}`);
    }
    // Dev: prefer pre-built binary from nexus/dist/, fall back to .py script
    const ext = process.platform === 'win32' ? '.exe' : '';
    const devBinary = path.join(app.getAppPath(), 'nexus', 'dist', `server${ext}`);
    if (fs.existsSync(devBinary)) return devBinary;
    return path.join(app.getAppPath(), 'nexus', 'server.py');
  }

  /**
   * Returns the path to the conda env directory inside userData.
   * e.g. ~/Library/Application Support/Sudowork/nexus_env
   */
  private getCondaEnvDir(): string {
    return path.join(app.getPath('userData'), 'nexus_env');
  }

  /**
   * Ensures the conda-packed environment is extracted and unpacked for the
   * current app version. Returns the nexusd path and whether extraction ran.
   *
   * Workflow:
   *   1. Check if envDir/.nexus-conda-ready contains the current app version.
   *   2. If not (first run or app update), delete old env and re-extract.
   *   3. Run conda-unpack to fix hardcoded install paths.
   *   4. Write the version marker so step 1 passes on next launch.
   */
  private async ensureCondaEnv(): Promise<{ nexusdBin: string; justExtracted: boolean }> {
    const envDir = this.getCondaEnvDir();
    const markerFile = path.join(envDir, CONDA_READY_MARKER);
    const nexusdBin = path.join(envDir, 'bin', 'nexusd');
    const currentVersion = app.getVersion();

    // Check if already set up for this version
    if (fs.existsSync(markerFile) && fs.existsSync(nexusdBin)) {
      const markedVersion = fs.readFileSync(markerFile, 'utf8').trim();
      if (markedVersion === currentVersion) {
        return { nexusdBin, justExtracted: false };
      }
      this.emitSetup('extracting', `App updated (${markedVersion} → ${currentVersion}), re-extracting conda env...`);
      fs.rmSync(envDir, { recursive: true, force: true });
    } else if (fs.existsSync(envDir)) {
      this.emitSetup('extracting', 'Conda env incomplete, re-extracting...');
      fs.rmSync(envDir, { recursive: true, force: true });
    } else {
      this.emitSetup('extracting', 'First run: extracting Nexus environment (this may take a few minutes)...');
    }

    const tarGzPath = path.join(process.resourcesPath, 'nexus.tar.gz');
    if (!fs.existsSync(tarGzPath)) {
      this.emitSetup('error', `nexus.tar.gz not found at ${tarGzPath}`);
      throw new Error(`[Nexus] nexus.tar.gz not found at ${tarGzPath}`);
    }

    // Detect placeholder written by download-nexus.js when no URL is configured.
    // A real conda-pack archive is always several hundred MB; anything under 1 MB is a placeholder.
    const tarGzSize = fs.statSync(tarGzPath).size;
    if (tarGzSize < 1024 * 1024) {
      this.emitSetup('error', `nexus.tar.gz is a placeholder (${tarGzSize} bytes) — no conda env configured for this platform`);
      throw new Error(`[Nexus] nexus.tar.gz is a placeholder — add the download URL in scripts/download-nexus.js`);
    }

    // Step 1: Extract
    fs.mkdirSync(envDir, { recursive: true });
    await execAsync(`tar -xzf "${tarGzPath}" -C "${envDir}"`);

    // Step 2: Fix hardcoded paths (conda-unpack)
    const condaUnpack = path.join(envDir, 'bin', 'conda-unpack');
    fs.chmodSync(condaUnpack, 0o755);
    this.emitSetup('unpacking', 'Running conda-unpack to fix install paths...');
    await execAsync(`"${condaUnpack}"`);

    // Step 3: Ensure nexusd is executable
    if (!fs.existsSync(nexusdBin)) {
      this.emitSetup('error', `nexusd not found at ${nexusdBin} after extraction`);
      throw new Error(`[Nexus] nexusd not found at ${nexusdBin} after extraction`);
    }
    fs.chmodSync(nexusdBin, 0o755);

    // Step 4: Write version marker
    fs.writeFileSync(markerFile, currentVersion);
    return { nexusdBin, justExtracted: true };
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
            reject(new Error(`[Nexus] Server did not start within ${timeoutMs}ms`));
            return;
          }
          setTimeout(attempt, 200);
        });
      };

      attempt();
    });
  }
}

export const nexusService = new NexusService();
