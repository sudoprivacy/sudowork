import { randomUUID } from 'node:crypto';

// Use stderr for all logging to avoid corrupting ACP stdio pipe
const log = {
  debug: (...args: unknown[]) => process.stderr.write(`[nexus] ${args.join(' ')}\n`),
  info: (...args: unknown[]) => process.stderr.write(`[nexus] ${args.join(' ')}\n`),
  error: (...args: unknown[]) => process.stderr.write(`[nexus] ERROR: ${args.join(' ')}\n`),
};

export class Nexus {
  constructor(
    protected readonly serverUrl: string,
    protected readonly apikey?: string
  ) {}

  protected async callRPC(method: string, params: Record<string, unknown>): Promise<unknown> {
    log.debug(`API call: ${method} with params: ${JSON.stringify(params)}`);
    const url = new URL(`/api/nfs/${method}`, this.serverUrl);
    const rpcRequest = {
      jsonrpc: '2.0',
      id: randomUUID(),
      method: method,
      params: params,
    };
    const response = await fetch(url, {
      method: 'POST',
      body: JSON.stringify(rpcRequest),
      headers: {
        'Content-Type': 'application/json',
        'Accept-Encoding': 'gzip',
        Authorization: `Bearer ${this.apikey}`,
      },
    });
    if (!response.ok) {
      log.error(`API call failed: ${method} - HTTP ${response.status}`);
      throw new Error(`Request failed: ${await response.text()}`);
    }
    const rpcResponse = (await response.json()) as RPCResponse;
    if (rpcResponse.error) {
      log.error(`API call RPC error: ${method} - ${rpcResponse.error.message}`);
      throwRPCError(rpcResponse.error);
    }
    log.info(`API call completed: ${method}`);
    return rpcResponse.result;
  }

  public async write(path: string, content: string | Buffer, if_match?: string, if_none_match?: boolean, force?: boolean): Promise<Record<string, unknown>> {
    return (await this.callRPC('write', {
      path,
      content,
      if_match,
      if_none_match,
      force,
    })) as Record<string, unknown>;
  }

  public async read(path: string, returnMetadata?: boolean): Promise<Buffer | Record<string, unknown>> {
    const result = await this.callRPC('read', { path, return_metadata: returnMetadata });
    if (result && typeof result === 'object') {
      const dict = result as Record<string, unknown>;
      if (dict.__type__ === 'bytes' && 'data' in dict) {
        return Buffer.from(dict.data as string, 'base64');
      }
      if ('content' in dict) {
        const content = dict.content;
        const encoding = dict.encoding || 'base64';
        let decodedContent: Buffer;
        if (encoding === 'base64' && typeof content === 'string') {
          decodedContent = Buffer.from(content, 'base64');
        } else if (content instanceof Buffer) {
          decodedContent = content;
        } else if (typeof content === 'string') {
          decodedContent = Buffer.from(content);
        } else {
          decodedContent = Buffer.from(String(content));
        }
        if (returnMetadata) {
          return { ...dict, content: decodedContent };
        } else {
          return decodedContent;
        }
      }
    }
    if (result instanceof Buffer) {
      return result;
    }
    return result as Record<string, unknown>;
  }

  public async exists(path: string): Promise<boolean> {
    return !!((await this.callRPC('exists', { path })) as { exists?: boolean })?.exists;
  }

  public async delete(path: string): Promise<void> {
    await this.callRPC('delete', { path });
  }

  public async readUntilExists(path: string, timeout?: number): Promise<Buffer> {
    const start = Date.now();
    while (!((timeout && Date.now() - start > timeout) || (await this.exists(path)))) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return (await this.read(path, false)) as Buffer;
  }
}

interface RPCResponse {
  jsonrpc: '2.0';
  id?: string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: Record<string, unknown>;
  };
}

const enum RPCErrorCode {
  // Standard JSON-RPC errors

  INTERNAL_ERROR = -32603,

  // Nexus-specific errors
  FILE_NOT_FOUND = -32000,
  FILE_EXISTS = -32001,
  INVALID_PATH = -32002,
  ACCESS_DENIED = -32003,
  PERMISSION_ERROR = -32004,
  VALIDATION_ERROR = -32005,
  CONFLICT = -32006, // Optimistic concurrency conflict
}

export class NexusError extends Error {
  constructor(
    message: string,
    public path?: string
  ) {
    super(message);
  }

  format(): string {
    if (this.path) {
      return `${this.message}: ${this.path}`;
    }
    return this.message;
  }
}

function throwRPCError(error: RPCResponse['error']) {
  if (!error) {
    return;
  }
  const code = error.code || RPCErrorCode.INTERNAL_ERROR;
  const message = error.message || 'Unknown error';
  switch (code) {
    case RPCErrorCode.FILE_NOT_FOUND:
      throw new NexusError('File not found', (error.data?.path as string) || message);
    case RPCErrorCode.FILE_EXISTS:
      throw new NexusError('File exists', (error.data?.path as string) || message);
    case RPCErrorCode.INVALID_PATH:
      throw new NexusError('Invalid path', (error.data?.path as string) || message);
    case RPCErrorCode.ACCESS_DENIED:
    case RPCErrorCode.PERMISSION_ERROR:
      throw new NexusError('Permission denied', message);
    case RPCErrorCode.VALIDATION_ERROR:
      throw new NexusError('Invalid value', message);
    case RPCErrorCode.CONFLICT:
      const expectedEtag = error.data?.expected_etag || '(unknown)';
      const currentEtag = error.data?.current_etag || '(unknown)';
      const path = (error.data?.path as string) || 'unknown';
      throw new NexusError(`Conflict detected - file was modified by another agent. Expected etag '${expectedEtag}', but current etag is '${currentEtag}'`, path);
    default:
      throw new NexusError(`RPC error: [${code}]: ${message}`);
  }
}
