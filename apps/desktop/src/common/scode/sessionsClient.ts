import { NexusSessionTransport, type NexusSessionEndpoint, type NexusSessionTransportOptions, type StreamReadResult } from '@nexus-ai-fs/vfs-client';
import { getScodeServiceClient, type ScodeServiceClient } from './serviceClient';

/** Session control and bytes use Sudocode; the published codec owns the wire format. */
export class ScodeSessionsClient {
  constructor(private readonly service: () => ScodeServiceClient = getScodeServiceClient) {}

  call<T>(method: string, params: Record<string, unknown>): Promise<T> {
    return this.service().request('sessions.call', { method, params });
  }

  openSession(endpoint: NexusSessionEndpoint, events: Pick<NexusSessionTransportOptions, 'onMessage' | 'onClose'>): NexusSessionTransport {
    return new NexusSessionTransport({
      endpoint,
      authToken: '',
      ...events,
      client: {
        streamWrite: async (path, data) => {
          await this.service().request('sessions.write', { path, data: data.toString('base64') });
        },
        streamReadAt: async (path, offset, _token, options): Promise<StreamReadResult> => {
          const result = await this.service().request<{ data: string; nextOffset: string; eof: boolean; timedOut: boolean }>('sessions.read', { path, offset, ...options });
          return { ...result, data: Buffer.from(result.data, 'base64') };
        },
      },
    });
  }
}
