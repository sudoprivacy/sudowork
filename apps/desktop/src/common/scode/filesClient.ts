import { getScodeServiceClient, type ScodeServiceClient } from './serviceClient';

export interface IScodeFileEntry {
  path: string;
  name: string;
  entry_type: number;
  isDirectory: boolean;
}

interface IScodeStat {
  path: string;
  entryType: number;
  isDirectory: boolean;
  size: number;
  zone_id: string;
}

/** Filesystem and mount capabilities exposed by Sudocode to the frontend. */
export class ScodeFilesClient {
  constructor(private readonly service: () => ScodeServiceClient = getScodeServiceClient) {}

  async callBinary(method: string, payload: Buffer): Promise<Buffer> {
    const result = await this.service().request<string>('mounts.call', { method, data: payload.toString('base64') });
    return Buffer.from(result, 'base64');
  }

  serverInfo(): Promise<{ version?: string; zone_id?: string }> {
    return this.service().request('service.status');
  }

  async write(path: string, content: string | Buffer): Promise<Record<string, unknown>> {
    const bytes = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
    await this.service().request('files.write', { path, data: bytes.toString('base64') });
    return { path, size: bytes.length };
  }

  async read(path: string, returnMetadata?: boolean): Promise<Buffer | Record<string, unknown>> {
    const result = await this.service().request<string>('files.read', { path });
    const content = Buffer.from(result, 'base64');
    if (!returnMetadata) return content;
    const metadata = await this.service().request<IScodeStat>('files.stat', { path });
    return { content, ...metadata };
  }

  async exists(path: string): Promise<boolean> {
    return this.service().request('files.exists', { path });
  }

  async mkdir(path: string, isParents?: boolean): Promise<void> {
    await this.service().request('files.mkdir', { path, parents: isParents ?? true });
  }

  async list(path: string): Promise<IScodeFileEntry[]> {
    const entries = await this.service().request<Array<{ name: string; entryType: number }>>('files.list', { path });
    return entries.map((entry) => ({ path: entry.name, name: entry.name.split('/').pop() || entry.name, entry_type: entry.entryType, isDirectory: entry.entryType === 1 }));
  }

  delete(path: string): Promise<boolean> {
    return this.service().request('files.delete', { path });
  }
}

const client = new ScodeFilesClient();

export function getScodeFilesClient(): ScodeFilesClient {
  return client;
}
