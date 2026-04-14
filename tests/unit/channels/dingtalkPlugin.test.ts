/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression tests for issue #335:
 * "DingTalk channel status shows connected, but bot stops responding after
 *  an idle period."
 *
 * These tests exercise the watchdog that was added to DingTalkPlugin so that
 * a silently-dead DWClient is detected and restarted, and the plugin status
 * is flipped to `error` so the UI reflects reality.
 */

type MockDWClient = {
  connected: boolean;
  registered: boolean;
  registerCallbackListener: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  socketCallBackResponse: ReturnType<typeof vi.fn>;
};

type MockControl = {
  connectImpl: () => Promise<void>;
  instances: MockDWClient[];
  // Intercept httpRequest on the plugin to avoid real network calls
  httpRequest: ReturnType<typeof vi.fn>;
};

const mockControl: MockControl = {
  connectImpl: () => Promise.resolve(),
  instances: [],
  httpRequest: vi.fn(),
};

function createConfig() {
  const now = Date.now();
  return {
    id: 'dingtalk-1',
    type: 'dingtalk' as const,
    name: 'DingTalk',
    enabled: true,
    credentials: { clientId: 'test-client', clientSecret: 'test-secret' },
    status: 'created' as const,
    createdAt: now,
    updatedAt: now,
  };
}

async function loadPluginClass() {
  vi.resetModules();

  mockControl.instances = [];

  vi.doMock('dingtalk-stream', () => {
    class DWClient {
      connected = false;
      registered = false;
      registerCallbackListener = vi.fn();
      socketCallBackResponse = vi.fn();
      connect = vi.fn(async () => {
        await mockControl.connectImpl();
        // Simulate successful connect + register
        this.connected = true;
        this.registered = true;
      });
      disconnect = vi.fn(() => {
        this.connected = false;
        this.registered = false;
      });

      constructor(_opts: unknown) {
        mockControl.instances.push(this as unknown as MockDWClient);
      }
    }

    return {
      DWClient,
      TOPIC_ROBOT: 'robot',
      TOPIC_CARD: 'card',
      EventAck: { SUCCESS: 'SUCCESS', LATER: 'LATER' },
    };
  });

  const mod = await import('@/channels/plugins/dingtalk/DingTalkPlugin');
  return mod.DingTalkPlugin;
}

function stubHttp(plugin: unknown): void {
  // Replace the private httpRequest to short-circuit token refresh.
  (plugin as { httpRequest: (..._args: unknown[]) => Promise<unknown> }).httpRequest = vi.fn().mockResolvedValue({ accessToken: 'mock-token', expireIn: 7200 });
}

describe('DingTalkPlugin watchdog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mockControl.connectImpl = () => Promise.resolve();
    mockControl.instances = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('marks status as error and schedules a restart when the stream goes unhealthy', async () => {
    vi.useFakeTimers();

    const DingTalkPlugin = await loadPluginClass();
    const plugin = new DingTalkPlugin();
    stubHttp(plugin);

    const statusEvents: Array<{ status: string; error: string | null }> = [];
    plugin.onStatusChange((status, error) => {
      statusEvents.push({ status, error });
    });

    await plugin.initialize(createConfig());
    await plugin.start();

    expect(plugin.status).toBe('running');
    expect(mockControl.instances).toHaveLength(1);

    // Simulate the underlying socket dying silently.
    const firstClient = mockControl.instances[0];
    firstClient.connected = false;
    firstClient.registered = false;

    // First watchdog tick (30s interval).
    await vi.advanceTimersByTimeAsync(30_000);

    expect(plugin.status).toBe('error');
    expect(plugin.error).toMatch(/disconnected/);
    expect(statusEvents.some((e) => e.status === 'error')).toBe(true);

    // Give the scheduled restart (2s backoff) time to fire.
    await vi.advanceTimersByTimeAsync(2_000);
    // Let pending microtasks resolve.
    await vi.advanceTimersByTimeAsync(0);

    // A second DWClient should have been created by the restart.
    expect(mockControl.instances.length).toBeGreaterThanOrEqual(2);

    // Old client should have been disconnected to avoid leaking SDK timers.
    expect(firstClient.disconnect).toHaveBeenCalled();

    // After a successful restart, status is back to running.
    expect(plugin.status).toBe('running');
    expect(statusEvents[statusEvents.length - 1].status).toBe('running');
  });

  it('keeps backing off and does not fire concurrent restarts when reconnection fails', async () => {
    vi.useFakeTimers();

    const DingTalkPlugin = await loadPluginClass();
    const plugin = new DingTalkPlugin();
    stubHttp(plugin);

    await plugin.initialize(createConfig());
    await plugin.start();

    // Break subsequent connects so the watchdog sees persistent failure.
    mockControl.connectImpl = () => Promise.reject(new Error('network down'));

    // Mark the existing client as unhealthy.
    const firstClient = mockControl.instances[0];
    firstClient.connected = false;
    firstClient.registered = false;

    // Trigger two health-check ticks back-to-back; the second should be a
    // no-op because the first restart is already scheduled/in-flight.
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(30_000);

    // The restart timer (2s backoff) fires once, creating one extra client.
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(0);

    // One start client + one failed restart attempt = 2 instances max so far.
    expect(mockControl.instances.length).toBeLessThanOrEqual(2);
    expect(plugin.status).toBe('error');
  });

  it('stops the watchdog and disconnects cleanly on stop()', async () => {
    const DingTalkPlugin = await loadPluginClass();
    const plugin = new DingTalkPlugin();
    stubHttp(plugin);

    await plugin.initialize(createConfig());
    await plugin.start();

    expect(plugin.status).toBe('running');
    const client = mockControl.instances[0];

    await plugin.stop();

    expect(plugin.status).toBe('stopped');
    expect(client.disconnect).toHaveBeenCalled();
    // Internal watchdog timer must be cleared.
    expect((plugin as unknown as { healthCheckTimer: unknown }).healthCheckTimer).toBeNull();
    expect((plugin as unknown as { restartTimer: unknown }).restartTimer).toBeNull();
  });
});
