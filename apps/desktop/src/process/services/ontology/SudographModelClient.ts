import { spawn } from 'node:child_process';
import path from 'node:path';

export interface ISudographRuntime {
  python: string;
  compilerRoot: string;
  modelDirectory: string;
}

export interface ISudographContext {
  format: 'sudograph-agent-context/v1';
  revision: string;
  context_digest: string;
  text: string;
}

export class SudographCompilerError extends Error {
  constructor(
    public readonly code: string,
    reason: string,
    public readonly recovery: unknown
  ) {
    super(reason);
  }
}

/** Host-only subprocess adapter. Tool inputs never choose paths, actors or code. */
export class SudographModelClient {
  constructor(private readonly runtime: ISudographRuntime) {}

  async invoke<T>(modelRef: string, actor: string, request: Record<string, unknown>): Promise<T> {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(modelRef) || !actor.trim()) throw new Error('Invalid registered Sudograph model binding.');
    const store = path.join(this.runtime.modelDirectory, `${modelRef}.db`);
    return new Promise<T>((resolve, reject) => {
      const child = spawn(this.runtime.python, ['-m', 'compiler.workspace', '--store', store, '--actor', actor], {
        cwd: this.runtime.compilerRoot,
        windowsHide: true,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let size = 0;
      let isSettled = false;
      const fail = (error: Error) => {
        if (isSettled) return;
        isSettled = true;
        clearTimeout(timer);
        reject(error);
      };
      const timer = setTimeout(() => {
        child.kill();
        fail(new Error('Sudograph compiler response timed out. Retry with the same operation ID to recover its receipt.'));
      }, 30_000);
      child.on('error', fail);
      child.stdin.on('error', fail);
      child.stdout.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 32 * 1024 * 1024) {
          child.kill();
          fail(new Error('Sudograph compiler response exceeds the host limit.'));
        } else stdout.push(chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        if (stderr.reduce((total, item) => total + item.length, 0) < 64 * 1024) stderr.push(chunk);
      });
      child.on('close', (code) => {
        if (isSettled) return;
        clearTimeout(timer);
        if (code !== 0) return fail(new Error(`Sudograph compiler exited ${code}: ${Buffer.concat(stderr).toString('utf8')}`));
        try {
          const response = JSON.parse(Buffer.concat(stdout).toString('utf8')) as { ok: boolean; result?: T; error?: { code: string; reason: string; recovery: unknown } };
          if (!response.ok || !('result' in response)) throw new SudographCompilerError(response.error?.code || 'PROTOCOL_ERROR', response.error?.reason || 'Invalid compiler response.', response.error?.recovery);
          isSettled = true;
          resolve(response.result as T);
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)));
        }
      });
      child.stdin.end(JSON.stringify(request) + '\n');
    });
  }
}

/** Deployment-owned configuration; registered projects fail closed if it is missing. */
export function getSudographModelClient(): SudographModelClient {
  const python = process.env.SUDOGRAPH_PYTHON;
  const compilerRoot = process.env.SUDOGRAPH_COMPILER_ROOT;
  const modelDirectory = process.env.SUDOGRAPH_MODEL_DIRECTORY;
  if (!python || !compilerRoot || !modelDirectory) throw new Error('Sudograph runtime is not configured. Set its Python, compiler root and model directory in the host deployment.');
  return new SudographModelClient({ python, compilerRoot, modelDirectory });
}
