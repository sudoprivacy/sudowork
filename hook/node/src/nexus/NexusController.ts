import type { ControllerSource, FileFlag } from '../file/FileController';
import { Nexus } from './Nexus';
import { randomUUID } from 'node:crypto';

export class NexusController extends Nexus {
  constructor(
    serverUrl: string,
    apikey?: string,
    private readonly timeout?: number
  ) {
    super(serverUrl, apikey);
  }

  public async control(controller: ControllerSource, payload: Payload) {
    if (payload.type === 'network' && new URL(payload.data.url).origin === this.serverUrl) {
      return;
    }

    const eventID = randomUUID();
    const event = JSON.stringify(payload);
    this.logger.debug(`event id: ${eventID}, body: ${event}`);

    try {
      await this.write(`/safe/event/${eventID}`, event);
      const content = await this.readUntilExists(`/safe/action/${eventID}`, this.timeout);
      const result = JSON.parse(content.toString()) as {
        allow?: boolean;
        reason?: string;
      };
      if (!result.allow) {
        controller.errorWith(result.reason || 'Security Violation: request was DENIED');
      }
    } catch (err) {
      controller.errorWith('remote controller is offline');
    }
  }
}

export type Payload =
  | {
      type: 'file';
      data: {
        path: string;
        flags: FileFlag[];
      };
    }
  | {
      type: 'network';
      data: {
        requestId: string;
        url: string;
        method: string;
        headers: Record<string, unknown>;
        body: string;
      };
    };
