import { spawn } from 'node:child_process';
import path from 'node:path';
import type { ISudographSourceConnector } from './sourceConfig.js';
import { SudographSourceProvider } from './SudographSourceProvider.js';

export interface ISudographRuntime {
  python: string;
  compilerRoot: string;
  modelDirectory: string;
  source?: { dsn: string; connector: ISudographSourceConnector };
}

export interface ISudographContext {
  format: 'sudograph-agent-context/v1';
  revision: string;
  context_digest: string;
  text: string;
}

export interface ISudographSourceRegistration {
  source: string;
  namespace: string;
  operationId: string;
  language: 'en' | 'zh';
}

export interface ISudographSourceReceipt {
  contract: {
    revision: string;
    namespace: string;
    baseline: { manifest: string; sha256: string };
    model: string;
  };
  registration: {
    format: 'sudograph-source-registration/v1';
    operation_id: string;
    initial_revision: string;
    connection: {
      status: 'connected';
      provider: 'sqlite' | 'postgresql' | 'mysql';
      source: string;
      observed_at: string;
    };
    scan: {
      status: 'complete';
      structure_complete: true;
      inventory_exhausted: true;
      objects: number;
      fields: number;
    };
    records: { delivery: 'live'; export_complete: false; rows_embedded: 0 };
  };
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
    return this.runWorker<T>(modelRef, actor, 'compiler.workspace', request, 30_000);
  }

  /** Authorized host routes only; resource and model are resolved from its registry. */
  async review<T>(modelRef: string, actor: string, resource: string, request: Record<string, unknown>): Promise<T> {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(resource)) throw new Error('Invalid registered review resource.');
    return this.runWorker<T>(modelRef, actor, 'compiler.review_host', request, 30_000, ['--resource', resource]);
  }

  /** Host connection intake only. The builder MCP never accepts sources or paths. */
  async registerSource(modelRef: string, actor: string, input: ISudographSourceRegistration): Promise<ISudographSourceReceipt> {
    const result = await this.runWorker<ISudographSourceReceipt>(
      modelRef,
      actor,
      'compiler.registration',
      {
        source: input.source,
        namespace: input.namespace,
        operation_id: input.operationId,
        language: input.language,
        snapshot_records: false,
      },
      120_000
    );
    const receipt = result?.registration;
    if (
      receipt?.format !== 'sudograph-source-registration/v1' ||
      receipt.operation_id !== input.operationId ||
      !receipt.initial_revision ||
      receipt.connection?.status !== 'connected' ||
      !['sqlite', 'postgresql', 'mysql'].includes(receipt.connection.provider) ||
      !receipt.connection.source ||
      receipt.scan?.status !== 'complete' ||
      receipt.scan.structure_complete !== true ||
      receipt.scan.inventory_exhausted !== true ||
      !Number.isSafeInteger(receipt.scan.objects) ||
      receipt.scan.objects < 0 ||
      !Number.isSafeInteger(receipt.scan.fields) ||
      receipt.scan.fields < 0 ||
      receipt.records?.delivery !== 'live' ||
      receipt.records.export_complete !== false ||
      receipt.records.rows_embedded !== 0 ||
      result.contract?.namespace !== input.namespace ||
      !result.contract.revision ||
      typeof result.contract.model !== 'string' ||
      !result.contract.baseline?.sha256
    ) {
      throw new SudographCompilerError('REGISTRATION_RECEIPT_INVALID', 'The compiler did not return a complete live-source registration receipt.', 'Keep the existing project and inspect the pinned compiler runtime before retrying.');
    }
    return result;
  }

  private async runWorker<T>(modelRef: string, actor: string, module: 'compiler.workspace' | 'compiler.registration' | 'compiler.review_host', request: Record<string, unknown>, timeout: number, hostArgs: string[] = []): Promise<T> {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(modelRef) || !actor.trim()) throw new Error('Invalid registered Sudograph model binding.');
    const store = path.join(this.runtime.modelDirectory, `${modelRef}.db`);
    const provider = this.runtime.source ? new SudographSourceProvider(this.runtime.source.dsn, this.runtime.source.connector) : undefined;
    const transport = provider ? await provider.start() : undefined;
    try {
      return await new Promise<T>((resolve, reject) => {
        const child = spawn(this.runtime.python, ['-m', module, '--store', store, '--actor', actor, ...hostArgs], {
          cwd: this.runtime.compilerRoot,
          windowsHide: true,
          env: {
            ...process.env,
            PYTHONIOENCODING: 'utf-8',
            PYTHONUTF8: '1',
            ...(transport ? { SUDOGRAPH_REGISTERED_SOURCE: transport } : {}),
          },
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
        }, timeout);
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
            const response = JSON.parse(Buffer.concat(stdout).toString('utf8')) as {
              ok: boolean;
              result?: T;
              error?: { code: string; reason: string; recovery: unknown };
            };
            if (!response.ok || !('result' in response)) throw new SudographCompilerError(response.error?.code || 'PROTOCOL_ERROR', response.error?.reason || 'Invalid compiler response.', response.error?.recovery);
            isSettled = true;
            resolve(response.result as T);
          } catch (error) {
            fail(error instanceof Error ? error : new Error(String(error)));
          }
        });
        child.stdin.end(JSON.stringify(request) + '\n');
      });
    } finally {
      await provider?.close();
    }
  }
}

/** Deployment-owned configuration; registered projects fail closed if it is missing. */
export function getSudographModelClient(source?: ISudographRuntime['source']): SudographModelClient {
  const python = process.env.SUDOGRAPH_PYTHON;
  const compilerRoot = process.env.SUDOGRAPH_COMPILER_ROOT;
  const modelDirectory = process.env.SUDOGRAPH_MODEL_DIRECTORY;
  if (!python || !compilerRoot || !modelDirectory) throw new Error('Sudograph runtime is not configured. Set its Python, compiler root and model directory in the host deployment.');
  return new SudographModelClient({
    python,
    compilerRoot,
    modelDirectory,
    source,
  });
}
