import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { z } from 'zod';

interface IServiceResponse {
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

const ServiceResponseSchema = z
  .object({
    id: z.number().int().positive(),
    result: z.unknown().optional(),
    error: z.object({ code: z.number().int(), message: z.string() }).strict().optional(),
  })
  .strict()
  .refine((response) => 'result' in response !== 'error' in response, 'Expected one result or error');

interface IPendingCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** One frontend connection to Sudocode's capability service. */
export class ScodeServiceClient {
  private process: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, IPendingCall>();

  constructor(private readonly executable: () => string) {}

  private connect(): ChildProcessWithoutNullStreams {
    if (this.process) return this.process;
    const child = spawn(this.executable(), ['service', 'stdio'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, SCODE_CHECK_UPDATES: '0' },
    });
    this.process = child;
    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      let response: IServiceResponse;
      try {
        response = ServiceResponseSchema.parse(JSON.parse(line)) as IServiceResponse;
      } catch {
        this.fail(child, new Error('Sudocode service returned an invalid response'));
        return;
      }
      const call = this.pending.get(response.id);
      if (!call) return;
      this.pending.delete(response.id);
      clearTimeout(call.timer);
      if (response.error) call.reject(new Error(response.error.message));
      else if ('result' in response) call.resolve(response.result);
      else call.reject(new Error('Sudocode service returned no result'));
    });
    // Drain diagnostics without carrying secret request or response bodies to logs.
    child.stderr.resume();
    child.stdin.on('error', (error) => this.fail(child, error));
    child.on('error', (error) => this.fail(child, error));
    child.on('exit', () => {
      lines.close();
      this.fail(child, new Error('Sudocode service connection closed'));
    });
    return child;
  }

  private fail(child: ChildProcessWithoutNullStreams, error: Error): void {
    if (this.process !== child) return;
    this.process = null;
    for (const call of this.pending.values()) {
      clearTimeout(call.timer);
      call.reject(error);
    }
    this.pending.clear();
    child.stdin.end();
  }

  /** Writes are submitted once; a timeout may follow a committed write. */
  request<T>(method: string, params: unknown = {}, timeoutMs = 45_000): Promise<T> {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = this.connect();
    } catch (error) {
      return Promise.reject(error);
    }
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Sudocode service request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`, (error) => {
        if (!error) return;
        const call = this.pending.get(id);
        if (!call) return;
        this.pending.delete(id);
        clearTimeout(call.timer);
        call.reject(error);
      });
    });
  }

  /** Closing the UI connection preserves the OS-user service for other clients. */
  close(): void {
    const child = this.process;
    if (!child) return;
    this.fail(child, new Error('Sudocode service connection closed'));
  }
}

let instance: ScodeServiceClient | null = null;
let resolveExecutable: (() => string) | null = null;

/** Configured by the desktop composition root after resolving its engine binary. */
export function configureScodeService(executable: () => string): void {
  instance?.close();
  instance = null;
  resolveExecutable = executable;
}

export function getScodeServiceClient(): ScodeServiceClient {
  if (!resolveExecutable) throw new Error('Sudocode service has not been configured');
  instance ??= new ScodeServiceClient(resolveExecutable);
  return instance;
}
