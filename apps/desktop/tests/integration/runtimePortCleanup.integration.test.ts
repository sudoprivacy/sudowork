import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@process/utils/mainLogger', () => ({ mainLog: vi.fn(), mainWarn: vi.fn(), mainError: vi.fn() }));
vi.mock('@process/services/serviceManager/RuntimeInstaller', () => ({ runtimeInstaller: {} }));
vi.mock('@common/nexus/nexus-secret-client', () => ({ getNexusSecretClient: vi.fn() }));
vi.mock('@common/nexus/nexus-vfs-client', () => ({ getNexusRpcClient: vi.fn() }));

import { ServiceManager } from '@process/services/serviceManager/ServiceManager';
import { dynamicNexusVfsService } from '@process/services/nexus-vfs/DynamicNexusVfsService';

const children: ChildProcess[] = [];

async function startChild(source: string): Promise<{ child: ChildProcess; message: unknown }> {
  const child = spawn(process.execPath, ['-e', source], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  children.push(child);
  const [message] = await once(child, 'message');
  return { child, message };
}

afterEach(async () => {
  await Promise.all(
    children.splice(0).map(async (child) => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    })
  );
});

describe.skipIf(process.platform === 'win32')('runtime port cleanup', () => {
  it.each(['service manager', 'Nexus service'] as const)('preserves a connected client when %s clears a listener', async (kind) => {
    const listener = await startChild(`
      const net = require('node:net');
      const server = net.createServer(() => {});
      server.listen(0, '127.0.0.1', () => process.send(server.address().port));
    `);
    const port = Number(listener.message);
    // The client stays alive after its socket closes, like Electron's gRPC client.
    const client = await startChild(`
      const socket = require('node:net').connect(${port}, '127.0.0.1', () => process.send('connected'));
      socket.on('error', () => {});
      process.on('message', () => process.send('alive'));
      setInterval(() => {}, 1000);
    `);
    expect(client.message).toBe('connected');
    const listenerExited = once(listener.child, 'exit');

    if (kind === 'service manager') {
      const manager = new ServiceManager() as unknown as { killProcessesOnPort: (port: number, label: string) => Promise<void> };
      await manager.killProcessesOnPort(port, 'test listener');
    } else {
      const service = dynamicNexusVfsService as unknown as { forceKillProcessesOnPort: (port: number) => Promise<void> };
      await service.forceKillProcessesOnPort(port);
    }

    await listenerExited;
    expect(listener.child.signalCode).toBe('SIGKILL');
    expect(client.child.exitCode).toBeNull();
    expect(client.child.signalCode).toBeNull();
    const response = once(client.child, 'message', { signal: AbortSignal.timeout(1000) });
    client.child.send('ping', () => {});
    expect((await response)[0]).toBe('alive');
  });
});
