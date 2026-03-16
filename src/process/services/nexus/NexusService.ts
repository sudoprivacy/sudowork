import { app } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import * as net from 'net';
import * as path from 'path';

const NEXUS_PORT = 8080;

class NexusService {
  private process: ChildProcess | null = null;
  private _running = false;

  get isRunning(): boolean {
    return this._running;
  }

  get port(): number {
    return NEXUS_PORT;
  }

  async start(): Promise<void> {
    if (this._running) return;

    const scriptPath = this.resolveScriptPath();
    console.log(`[Nexus] Starting server from: ${scriptPath}`);

    if (app.isPackaged) {
      // Production: run the PyInstaller-compiled binary
      this.process = spawn(scriptPath, [String(NEXUS_PORT)], { stdio: 'pipe' });
    } else {
      // Development: run the .py script directly with python3
      this.process = spawn('python3', [scriptPath, String(NEXUS_PORT)], { stdio: 'pipe' });
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

    await this.waitForPort(NEXUS_PORT);
    this._running = true;
    console.log(`[Nexus] Server ready on http://127.0.0.1:${NEXUS_PORT}`);
  }

  stop(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this._running = false;
  }

  private resolveScriptPath(): string {
    if (app.isPackaged) {
      const ext = process.platform === 'win32' ? '.exe' : '';
      return path.join(process.resourcesPath, 'nexus', `server${ext}`);
    }
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
