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

  it('starts watchdog even when initial connection fails, and auto-recovers when network returns', async () => {
    vi.useFakeTimers();

    const DingTalkPlugin = await loadPluginClass();
    const plugin = new DingTalkPlugin();
    stubHttp(plugin);

    // Make initial connection fail.
    mockControl.connectImpl = () => Promise.reject(new Error('network down'));

    await plugin.initialize(createConfig());
    await expect(plugin.start()).rejects.toThrow('network down');

    // Plugin is in error state, but watchdog should still be running.
    expect(plugin.status).toBe('error');
    expect((plugin as unknown as { healthCheckTimer: unknown }).healthCheckTimer).not.toBeNull();

    // Fix the network and wait for the next health check tick (30s).
    mockControl.connectImpl = () => Promise.resolve();

    await vi.advanceTimersByTimeAsync(30_000);
    // Wait for the 2s restart backoff.
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(0);

    // A new client should have been created, and plugin recovered to running.
    expect(mockControl.instances.length).toBeGreaterThanOrEqual(1);
    expect(plugin.status).toBe('running');
  });

  it('uses exponential backoff with correct delays', async () => {
    vi.useFakeTimers();

    const DingTalkPlugin = await loadPluginClass();
    const plugin = new DingTalkPlugin();
    stubHttp(plugin);

    const restartLog: Array<{ timerTime: number; attempt: string }> = [];
    let timerElapsed = 0;

    await plugin.initialize(createConfig());
    await plugin.start();

    // Break connection and make all restarts fail.
    mockControl.connectImpl = () => {
      restartLog.push({ timerTime: timerElapsed, attempt: '' });
      return Promise.reject(new Error('fail'));
    };
    const client = mockControl.instances[0];
    client.connected = false;
    client.registered = false;

    // We spy on console.warn to capture the backoff delay from log messages.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Tick 1: health check (30s) → restart scheduled in 2s.
    await vi.advanceTimersByTimeAsync(30_000);
    timerElapsed += 30_000;
    await vi.advanceTimersByTimeAsync(2_000);
    timerElapsed += 2_000;
    await vi.advanceTimersByTimeAsync(0);

    // Tick 2: health check (30s) → restart scheduled in 4s.
    await vi.advanceTimersByTimeAsync(30_000);
    timerElapsed += 30_000;
    await vi.advanceTimersByTimeAsync(4_000);
    timerElapsed += 4_000;
    await vi.advanceTimersByTimeAsync(0);

    // Tick 3: health check (30s) → restart scheduled in 8s.
    await vi.advanceTimersByTimeAsync(30_000);
    timerElapsed += 30_000;
    await vi.advanceTimersByTimeAsync(8_000);
    timerElapsed += 8_000;
    await vi.advanceTimersByTimeAsync(0);

    // Tick 4: health check (30s) → restart scheduled in 16s.
    await vi.advanceTimersByTimeAsync(30_000);
    timerElapsed += 30_000;
    await vi.advanceTimersByTimeAsync(16_000);
    timerElapsed += 16_000;
    await vi.advanceTimersByTimeAsync(0);

    // Tick 5: health check (30s) → restart scheduled in 32s.
    await vi.advanceTimersByTimeAsync(30_000);
    timerElapsed += 30_000;
    await vi.advanceTimersByTimeAsync(32_000);
    timerElapsed += 32_000;
    await vi.advanceTimersByTimeAsync(0);

    // Tick 6: health check (30s) → restart scheduled in 60s (capped).
    await vi.advanceTimersByTimeAsync(30_000);
    timerElapsed += 30_000;
    await vi.advanceTimersByTimeAsync(60_000);
    timerElapsed += 60_000;
    await vi.advanceTimersByTimeAsync(0);

    expect(restartLog).toHaveLength(6);

    // Verify backoff delays from log messages.
    const backoffMessages = warnSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((m) => m.includes('Scheduling restart'));

    expect(backoffMessages[0]).toMatch(/in 2s/);
    expect(backoffMessages[1]).toMatch(/in 4s/);
    expect(backoffMessages[2]).toMatch(/in 8s/);
    expect(backoffMessages[3]).toMatch(/in 16s/);
    expect(backoffMessages[4]).toMatch(/in 32s/);
    expect(backoffMessages[5]).toMatch(/in 60s/);

    expect(plugin.status).toBe('error');

    warnSpy.mockRestore();
  });

  it('falls back to floor interval after max consecutive failures', async () => {
    vi.useFakeTimers();

    const DingTalkPlugin = await loadPluginClass();
    const plugin = new DingTalkPlugin();
    stubHttp(plugin);

    await plugin.initialize(createConfig());
    await plugin.start();

    // Break connection and make all restarts fail.
    mockControl.connectImpl = () => Promise.reject(new Error('fail'));
    const client = mockControl.instances[0];
    client.connected = false;
    client.registered = false;

    // Run enough cycles to exhaust 10 fast retries, then verify floor retry.
    // Each cycle: 30s health check + backoff delay.
    // Attempts 1-10 use exponential backoff (2s to 60s).
    // After attempt 10, floor interval (5 min) kicks in.

    // Advance through all 10 fast retry cycles.
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(30_000);
      // The backoff delay varies but we just need enough time for it.
      await vi.advanceTimersByTimeAsync(60_000);
      await vi.advanceTimersByTimeAsync(0);
    }

    expect(plugin.status).toBe('error');

    // After 10 failures, the next health check should schedule a floor retry.
    const instanceCountBefore = mockControl.instances.length;
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(5 * 60_000); // 5 min floor interval
    await vi.advanceTimersByTimeAsync(0);

    // A new client should have been created (floor retry fired).
    expect(mockControl.instances.length).toBeGreaterThan(instanceCountBefore);
  });

  it('resets failure counter on stop + start', async () => {
    vi.useFakeTimers();

    const DingTalkPlugin = await loadPluginClass();
    const plugin = new DingTalkPlugin();
    stubHttp(plugin);

    await plugin.initialize(createConfig());
    await plugin.start();

    // Break connection and accumulate failures.
    mockControl.connectImpl = () => Promise.reject(new Error('fail'));
    const client = mockControl.instances[0];
    client.connected = false;
    client.registered = false;

    // Let watchdog detect and attempt restart twice.
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(4_000);
    await vi.advanceTimersByTimeAsync(0);

    expect((plugin as unknown as { consecutiveRestartFailures: number }).consecutiveRestartFailures).toBeGreaterThan(0);

    // Stop and restart — counter should reset.
    await plugin.stop();
    mockControl.connectImpl = () => Promise.resolve();
    await plugin.start();

    expect(plugin.status).toBe('running');
    expect((plugin as unknown as { consecutiveRestartFailures: number }).consecutiveRestartFailures).toBe(0);
  });

  it('does not flip status back to running when stop() is called during a restart', async () => {
    vi.useFakeTimers();

    const DingTalkPlugin = await loadPluginClass();
    const plugin = new DingTalkPlugin();
    stubHttp(plugin);

    const statusEvents: Array<{ status: string }> = [];
    plugin.onStatusChange((status) => {
      statusEvents.push({ status });
    });

    await plugin.initialize(createConfig());
    await plugin.start();

    // Break connection.
    mockControl.connectImpl = () => Promise.reject(new Error('fail'));
    const client = mockControl.instances[0];
    client.connected = false;
    client.registered = false;

    // Trigger health check → schedule restart (2s).
    await vi.advanceTimersByTimeAsync(30_000);

    // Just before restart fires, stop the plugin.
    await plugin.stop();

    // Let the restart timer fire — it should be a no-op because shuttingDown is true.
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(0);

    expect(plugin.status).toBe('stopped');
    // No 'running' event should appear after 'stopped'.
    const stoppedIdx = statusEvents.findIndex((e) => e.status === 'stopped');
    const runningAfterStop = statusEvents.slice(stoppedIdx + 1).some((e) => e.status === 'running');
    expect(runningAfterStop).toBe(false);
  });
});
