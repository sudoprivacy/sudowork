/**
 * Auto-generated type stub for nexus-napi.
 * After `napi build --release`, the real index.d.ts replaces this file.
 */

export class NexusGrpcClient {
  constructor(endpoint: string);
  call(method: string, payload: string, authToken: string): string;
  read(path: string, authToken: string): Buffer;
  write(path: string, content: Buffer, authToken: string): void;
  ping(authToken: string): string;
}
