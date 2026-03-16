import { app } from 'electron';
import { spawn, exec, ChildProcess } from 'child_process';
import * as net from 'net';
import * as path from 'path';
import * as fs from 'fs';

class NexusService {
  private process: ChildProcess | null = null;
  private _running = false;
  private _port = 0;

  get isRunning(): boolean {
    return this._running;
  }

  get port(): number {
    return this._port;
  }

  async start(): Promise<void> {
    if (this._running) return;

    this._port = await this.findFreePort();
    const scriptPath = this.resolveScriptPath();
    console.log(`[Nexus] Starting server from: ${scriptPath} on port ${this._port}`);

    if (app.isPackaged || this.devBinaryExists()) {
      // Production or dev with pre-built binary: run the PyInstaller-compiled binary
      if (!app.isPackaged) console.log(`[Nexus] Using pre-built dev binary: ${scriptPath}`);
      this.process = spawn(scriptPath, [String(this._port)], { stdio: 'pipe' });
    } else {
      // Development (no binary): resolve python3 from the user's login shell so conda/pyenv envs are found
      const python3 = await this.resolvePython3Dev();
      console.log(`[Nexus] Using Python: ${python3}`);
      this.process = spawn(python3, [scriptPath, String(this._port)], { stdio: 'pipe' });
    }

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
    });

    await this.waitForPort(this._port);
    this._running = true;
    console.log(`[Nexus] Server ready on http://127.0.0.1:${this._port}`);
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
        const p = stdout.split('\n').map(l => l.trim()).find(l => l.startsWith('/'));
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
