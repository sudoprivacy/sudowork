import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@process/utils/mainLogger', () => ({ mainLog: vi.fn(), mainWarn: vi.fn(), mainError: vi.fn() }));
vi.mock('@process/services/serviceManager/RuntimeInstaller', () => ({ runtimeInstaller: {} }));
vi.mock('@common/nexus/nexus-secret-client', () => ({ getNexusSecretClient: vi.fn() }));
vi.mock('@common/nexus/nexus-vfs-client', () => ({ getNexusRpcClient: vi.fn() }));
vi.mock('@process/ProcessSupervisor', () => ({ processSupervisor: { track: vi.fn() } }));

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
  await dynamicNexusVfsService.stop();
  vi.restoreAllMocks();
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
  it('preserves a connected client when the Sudoclaw service manager clears a listener', async () => {
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

    const manager = new ServiceManager() as unknown as { killProcessesOnPort: (port: number, label: string) => Promise<void> };
    await manager.killProcessesOnPort(port, 'test listener');

    await listenerExited;
    expect(listener.child.signalCode).toBe('SIGKILL');
    expect(client.child.exitCode).toBeNull();
    expect(client.child.signalCode).toBeNull();
    const response = once(client.child, 'message', { signal: AbortSignal.timeout(1000) });
    client.child.send('ping', () => {});
    expect((await response)[0]).toBe('alive');
  });
});

describe('Nexus process ownership', () => {
  it('leaves a real occupied listener alive after a rejected start and stop', async () => {
    const listener = await startChild(`
      const server = require('node:net').createServer(() => {});
      server.listen(0, '127.0.0.1', () => process.send(server.address().port));
      process.on('message', () => process.send('alive'));
    `);
    const service = dynamicNexusVfsService as unknown as {
      isPortInUse: (port: number) => Promise<boolean>;
      resolveStartCommand: (port: number) => { command: string; args: string[] };
    };
    const probe = service.isPortInUse.bind(service);
    // Use an ephemeral port so the regression test cannot touch the user's daemon.
    vi.spyOn(service, 'isPortInUse').mockImplementation(() => probe(Number(listener.message)));
    vi.spyOn(service, 'resolveStartCommand').mockReturnValue({ command: process.execPath, args: [] });

    await expect(dynamicNexusVfsService.start()).rejects.toThrow('already in use by another process');
    await dynamicNexusVfsService.stop();
    expect(await dynamicNexusVfsService.checkActualRunning()).toBe(false);
    expect(dynamicNexusVfsService.acpTunnelEndpoint).toBeNull();
    expect(listener.child.exitCode).toBeNull();
    expect(listener.child.signalCode).toBeNull();
    const response = once(listener.child, 'message', { signal: AbortSignal.timeout(1000) });
    listener.child.send('ping', () => {});
    expect((await response)[0]).toBe('alive');
  });

  it.skipIf(process.platform === 'win32')('waits for its owned process to exit when it ignores SIGTERM', async () => {
    const owned = await startChild(`
      process.on('SIGTERM', () => {});
      setInterval(() => {}, 1000);
      process.send('ready');
    `);
    const service = dynamicNexusVfsService as unknown as { process: ChildProcess | null };
    service.process = owned.child;
    const exited = once(owned.child, 'exit');

    await dynamicNexusVfsService.stop();
    await exited;

    expect(owned.child.killed).toBe(true);
    expect(owned.child.signalCode).toBe('SIGKILL');
    expect(service.process).toBeNull();
  });
});
