/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock '@process/initStorage' to avoid touching real config file
vi.mock('@process/initStorage', () => ({
  ProcessConfig: {
    get: vi.fn(async () => undefined),
    set: vi.fn(async () => undefined),
  },
}));

// Mock '@process/i18n' to provide a deterministic translator
vi.mock('@process/i18n', () => ({
  default: {
    t: (key: string, params?: Record<string, string>) => {
      if (key === 'notification.sessionEnd.title') return 'Session finished';
      if (key === 'notification.sessionEnd.body') return `${params?.backend ?? 'Agent'} has finished the current session.`;
      if (key === 'notification.sessionEnd.fallbackBackend') return 'Agent';
      return key;
    },
  },
}));

// Mock logger
vi.mock('@process/utils/mainLogger', () => ({
  mainLog: vi.fn(),
  mainWarn: vi.fn(),
  mainError: vi.fn(),
}));

// Mock electron module — supplies the Notification and BrowserWindow that
// SessionNotificationService imports by default. Tests that want to assert
// concrete constructor args inject their own mock via the constructor.
vi.mock('electron', () => {
  class FakeNotification {
    static isSupported = vi.fn(() => true);
    static readonly lastOptions: Electron.NotificationConstructorOptions[] = [];
    options: Electron.NotificationConstructorOptions;
    show = vi.fn();
    on = vi.fn();
    constructor(options: Electron.NotificationConstructorOptions) {
      this.options = options;
      FakeNotification.lastOptions.push(options);
    }
  }
  return {
    Notification: FakeNotification,
    BrowserWindow: {
      getAllWindows: vi.fn(() => []),
    },
  };
});

// Import AFTER the mocks are set up
import { SessionNotificationService, DEFAULT_SESSION_END_NOTIFICATION_CONFIG } from '@/process/services/notification/SessionNotificationService';

type FakeWindow = {
  isDestroyed: () => boolean;
  isFocused: () => boolean;
  isMinimized: () => boolean;
  restore: () => void;
  show: () => void;
  focus: () => void;
};

function makeWindow(focused = false, destroyed = false): FakeWindow {
  return {
    isDestroyed: () => destroyed,
    isFocused: () => focused,
    isMinimized: () => false,
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
  };
}

type NotificationMock = {
  show: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  options: Electron.NotificationConstructorOptions;
};

function buildService(overrides?: { isSupported?: boolean; windows?: FakeWindow[]; now?: number }) {
  const instances: NotificationMock[] = [];

  class FakeNotification {
    show = vi.fn();
    on = vi.fn();
    options: Electron.NotificationConstructorOptions;
    constructor(options: Electron.NotificationConstructorOptions) {
      this.options = options;
      instances.push(this as unknown as NotificationMock);
    }
  }

  const service = new SessionNotificationService({
    notificationCtor: FakeNotification as unknown as typeof import('electron').Notification,
    isSupported: () => overrides?.isSupported ?? true,
    getAllWindows: () => (overrides?.windows ?? []) as unknown as Electron.BrowserWindow[],
    translate: (key, params) => {
      if (key === 'notification.sessionEnd.title') return 'Session finished';
      if (key === 'notification.sessionEnd.body') return `${params?.backend ?? 'Agent'} done`;
      if (key === 'notification.sessionEnd.fallbackBackend') return 'Agent';
      return key;
    },
    now: () => overrides?.now ?? 1000,
  });

  return { service, instances };
}

describe('SessionNotificationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes sensible defaults', () => {
    expect(DEFAULT_SESSION_END_NOTIFICATION_CONFIG).toEqual({
      enabled: true,
      notifyWhenFocused: false,
      silent: false,
    });
  });

  it('does nothing when disabled', () => {
    const { service, instances } = buildService();
    service.updateSettings({ enabled: false, notifyWhenFocused: false, silent: false });
    service.notifySessionFinished({ conversationId: 'c1', backend: 'claude' });
    expect(instances).toHaveLength(0);
  });

  it('does nothing when Notification is not supported', () => {
    const { service, instances } = buildService({ isSupported: false });
    service.notifySessionFinished({ conversationId: 'c1', backend: 'claude' });
    expect(instances).toHaveLength(0);
  });

  it('skips when a window is focused and notifyWhenFocused=false', () => {
    const { service, instances } = buildService({ windows: [makeWindow(true, false)] });
    service.notifySessionFinished({ conversationId: 'c1', backend: 'claude' });
    expect(instances).toHaveLength(0);
  });

  it('still notifies when a window is focused and notifyWhenFocused=true', () => {
    const { service, instances } = buildService({ windows: [makeWindow(true, false)] });
    service.updateSettings({ enabled: true, notifyWhenFocused: true, silent: false });
    service.notifySessionFinished({ conversationId: 'c1', backend: 'claude' });
    expect(instances).toHaveLength(1);
    expect(instances[0].show).toHaveBeenCalledTimes(1);
    expect(instances[0].options.title).toBe('Session finished');
    expect(instances[0].options.body).toBe('claude done');
    expect(instances[0].options.silent).toBe(false);
  });

  it('notifies when no windows exist (background state)', () => {
    const { service, instances } = buildService();
    service.notifySessionFinished({ conversationId: 'c1', backend: 'codex' });
    expect(instances).toHaveLength(1);
    expect(instances[0].options.body).toBe('codex done');
  });

  it('ignores destroyed focused windows', () => {
    const { service, instances } = buildService({ windows: [makeWindow(true, true)] });
    service.notifySessionFinished({ conversationId: 'c1', backend: 'claude' });
    expect(instances).toHaveLength(1);
  });

  it('throttles repeated notifications for the same conversation', () => {
    const { service, instances } = buildService({ now: 1000 });
    service.notifySessionFinished({ conversationId: 'c1', backend: 'claude' });
    // Same clock → throttled
    service.notifySessionFinished({ conversationId: 'c1', backend: 'claude' });
    expect(instances).toHaveLength(1);

    // A different conversation ID should still notify
    service.notifySessionFinished({ conversationId: 'c2', backend: 'claude' });
    expect(instances).toHaveLength(2);
  });

  it('allows notifying again after the throttle window passes', () => {
    let currentTime = 0;
    const calls: Electron.NotificationConstructorOptions[] = [];
    const service = new SessionNotificationService({
      notificationCtor: class {
        show = vi.fn();
        on = vi.fn();
        constructor(public options: Electron.NotificationConstructorOptions) {
          calls.push(options);
        }
      } as unknown as typeof import('electron').Notification,
      isSupported: () => true,
      getAllWindows: () => [],
      translate: (key) => key,
      now: () => currentTime,
    });

    currentTime = 100;
    service.notifySessionFinished({ conversationId: 'c1', backend: 'claude' });
    expect(calls).toHaveLength(1);

    currentTime = 100 + 1500; // within throttle
    service.notifySessionFinished({ conversationId: 'c1', backend: 'claude' });
    expect(calls).toHaveLength(1);

    currentTime = 100 + 2500; // past throttle
    service.notifySessionFinished({ conversationId: 'c1', backend: 'claude' });
    expect(calls).toHaveLength(2);
  });

  it('respects silent flag', () => {
    const { service, instances } = buildService();
    service.updateSettings({ enabled: true, notifyWhenFocused: false, silent: true });
    service.notifySessionFinished({ conversationId: 'c1', backend: 'claude' });
    expect(instances[0].options.silent).toBe(true);
  });

  it('falls back to a generic backend name when backend is missing', () => {
    const { service, instances } = buildService();
    service.notifySessionFinished({ conversationId: 'c1' });
    expect(instances).toHaveLength(1);
    expect(instances[0].options.body).toBe('Agent done');
  });

  it('getSettings returns a defensive copy', () => {
    const { service } = buildService();
    const snapshot = service.getSettings();
    snapshot.enabled = false;
    expect(service.getSettings().enabled).toBe(true);
  });

  it('clearThrottle resets the dedupe map', () => {
    const { service, instances } = buildService();
    service.notifySessionFinished({ conversationId: 'c1', backend: 'claude' });
    service.clearThrottle();
    service.notifySessionFinished({ conversationId: 'c1', backend: 'claude' });
    expect(instances).toHaveLength(2);
  });
});
