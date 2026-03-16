import { ipcBridge } from '../../common';
import { nexusService } from '../services/nexus/NexusService';

export function initNexusBridge(): void {
  ipcBridge.nexus.ping.provider(async () => {
    if (!nexusService.isRunning) {
      return { success: false, msg: 'Nexus server is not running' };
    }
    try {
      const res = await fetch(`http://127.0.0.1:${nexusService.port}/ping`);
      const data = (await res.json()) as { message: string; timestamp: number; port: number };
      return { success: true, data };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, msg };
    }
  });

  ipcBridge.nexus.getStatus.provider(() => {
    return Promise.resolve({
      success: true,
      data: { running: nexusService.isRunning, port: nexusService.port },
    });
  });
}
