/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { getRuntimeActionDescriptors, getStatusInfo, resolveRuntimeStatus, type ToolRow } from '@/renderer/components/SettingsModal/contents/runtimeStatus';

const t = (key: string, opts?: Record<string, unknown>): string => {
  if (key === 'settings.runtimeSettings.status.running') {
    return `运行中 :${String(opts?.port ?? '')}`;
  }

  if (key === 'settings.runtimeSettings.phase.extracting') {
    return `解压中 ${String(opts?.percent ?? '')}`.trim();
  }

  const fallbackMap: Record<string, string> = {
    'settings.runtimeSettings.status.notInstalled': '未安装',
    'settings.runtimeSettings.status.installed': '已安装',
    'settings.runtimeSettings.status.notRunning': '未运行',
    'settings.runtimeSettings.status.checking': '检查中…',
    'settings.runtimeSettings.phase.installing': '安装中…',
  };

  return fallbackMap[key] ?? String(opts?.defaultValue ?? key);
};

function createRecord(overrides: Partial<ToolRow> = {}): ToolRow {
  return {
    key: 'node',
    displayName: 'Node.js',
    command: 'node',
    badge: 'NJ',
    status: { installed: false, source: 'managed' },
    loadState: 'idle',
    onRefresh: async () => {},
    ...overrides,
  };
}

describe('runtimeStatus helpers', () => {
  it('treats installing as the highest-priority status', () => {
    const record = createRecord({
      key: 'nexus',
      nexusInstalled: true,
      nexusRunning: true,
      loadState: 'installing',
      installPhase: 'extracting',
      installPercent: 45,
    });

    expect(resolveRuntimeStatus(record)).toBe('installing');
    expect(getStatusInfo(record, t)).toEqual({
      dotColor: 'bg-blue-5',
      statusText: '解压中 45%',
    });
  });

  it('renders service runtime as running only from actual runtime data', () => {
    const record = createRecord({
      key: 'sudoclaw',
      status: { installed: true, source: 'managed', version: '1.2.3' },
      sudoclawGatewayRunning: true,
      sudoclawGatewayPort: 7331,
    });

    expect(resolveRuntimeStatus(record)).toBe('running');
    expect(getStatusInfo(record, t)).toEqual({
      dotColor: 'bg-green-5',
      statusText: '运行中 :7331',
    });
  });

  it('removes stop action for running services and keeps refresh only', () => {
    const record = createRecord({
      key: 'nexus',
      status: { installed: true, source: 'managed', version: '0.9.0' },
      nexusInstalled: true,
      nexusRunning: true,
      onInstall: async () => {},
      onUninstall: async () => {},
      onStart: async () => {},
    });

    expect(getRuntimeActionDescriptors(record)).toEqual([{ key: 'refresh', type: 'outline' }]);
  });

  it('shows start for installed but not running services', () => {
    const record = createRecord({
      key: 'nexus',
      status: { installed: true, source: 'managed', version: '0.9.0' },
      nexusInstalled: true,
      nexusRunning: false,
      onInstall: async () => {},
      onUninstall: async () => {},
      onStart: async () => {},
    });

    expect(getRuntimeActionDescriptors(record)).toEqual([
      { key: 'start', type: 'secondary' },
      { key: 'uninstall', status: 'warning', type: 'outline' },
      { key: 'refresh', type: 'outline' },
    ]);
  });

  it('shows install for not installed runtimes', () => {
    const record = createRecord({
      onInstall: async () => {},
    });

    expect(getRuntimeActionDescriptors(record)).toEqual([
      { key: 'install', type: 'primary' },
      { key: 'refresh', type: 'outline' },
    ]);
  });
});
