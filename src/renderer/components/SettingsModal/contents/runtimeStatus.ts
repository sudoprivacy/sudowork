/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ICliStatus, ILibreOfficeInstallPhase, NexusInstallPhase } from '@/common/ipcBridge';

export type LoadState = 'idle' | 'loading' | 'installing';

export interface ToolRow {
  key: string;
  displayName: string;
  command: string;
  badge: string;
  status: ICliStatus | null;
  statusResolved?: boolean;
  nexusPort?: number;
  nexusRunning?: boolean;
  nexusInstalled?: boolean;
  loadState: LoadState;
  installPhase?: ILibreOfficeInstallPhase | NexusInstallPhase | string;
  installPercent?: number;
  onRefresh: () => Promise<void>;
  onInstall?: () => Promise<void>;
  onUninstall?: () => Promise<void>;
  onStart?: () => Promise<void>;
}

export interface RuntimeAction {
  key: 'install' | 'reinstall' | 'refresh' | 'uninstall' | 'start';
  label: string;
  type: 'primary' | 'secondary' | 'outline';
  status?: 'warning';
  onClick: () => Promise<void>;
}

export type RuntimeResolvedStatus = 'checking' | 'installing' | 'notInstalled' | 'installed' | 'running';

type RuntimeActionDescriptor = Omit<RuntimeAction, 'label' | 'onClick'>;

type TranslateFn = (key: string, opts?: Record<string, unknown>) => string;

function getRunningStatusText(t: TranslateFn, port?: number): string {
  if (port != null) {
    return t('settings.runtimeSettings.status.running', { port });
  }

  return t('settings.runtimeSettings.status.running', { port: '' }).replace(' :', '');
}

export function isInstalled(record: ToolRow): boolean {
  if (record.key === 'nexus') return !!record.nexusInstalled;
  return !!record.status?.installed;
}

export function isRuntimeRunning(record: ToolRow): boolean {
  if (record.key === 'nexus') return !!record.nexusRunning;
  return false;
}

export function resolveRuntimeStatus(record: ToolRow): RuntimeResolvedStatus {
  if (record.loadState === 'installing') {
    return 'installing';
  }

  if (isRuntimeRunning(record)) {
    return 'running';
  }

  if (record.key === 'nexus') {
    if (record.statusResolved === false) {
      return 'checking';
    }
    return isInstalled(record) ? 'installed' : 'notInstalled';
  }

  if (record.status === null) {
    return 'checking';
  }

  return isInstalled(record) ? 'installed' : 'notInstalled';
}

export function getStatusInfo(record: ToolRow, t: TranslateFn): { dotColor: string; statusText: string } {
  const resolvedStatus = resolveRuntimeStatus(record);

  switch (resolvedStatus) {
    case 'installing': {
      const phase = record.installPhase ?? 'installing';
      const phaseKey = `settings.runtimeSettings.phase.${phase}`;
      const percent = record.installPercent != null ? `${record.installPercent}%` : '';
      return {
        dotColor: 'bg-blue-5',
        statusText: t(phaseKey, { percent, defaultValue: t('settings.runtimeSettings.phase.installing') }),
      };
    }
    case 'running':
      return {
        dotColor: 'bg-green-5',
        statusText: getRunningStatusText(t, record.key === 'nexus' ? record.nexusPort : undefined),
      };
    case 'installed':
      return {
        dotColor: 'bg-gray-4',
        statusText: record.key === 'nexus' ? t('settings.runtimeSettings.status.notRunning') : t('settings.runtimeSettings.status.installed'),
      };
    case 'checking':
      return {
        dotColor: 'bg-gray-4',
        statusText: t('settings.runtimeSettings.status.checking'),
      };
    case 'notInstalled':
    default:
      return {
        dotColor: 'bg-gray-4',
        statusText: t('settings.runtimeSettings.status.notInstalled'),
      };
  }
}

export function getRuntimeActionDescriptors(record: ToolRow): RuntimeActionDescriptor[] {
  const installed = isInstalled(record);
  const source = record.status?.source;
  const canUninstall = record.key !== 'node' && source === 'managed';
  const supportsStart = !!record.onStart;
  const resolvedStatus = resolveRuntimeStatus(record);

  switch (resolvedStatus) {
    case 'installing':
    case 'checking':
      return [{ key: 'refresh', type: 'outline' }];
    case 'notInstalled': {
      const actions: RuntimeActionDescriptor[] = [];
      if (record.onInstall) {
        actions.push({ key: 'install', type: 'primary' });
      }
      actions.push({ key: 'refresh', type: 'outline' });
      return actions;
    }
    case 'running': {
      const actions: RuntimeActionDescriptor[] = [];
      if (installed && record.onUninstall && canUninstall) {
        actions.push({ key: 'uninstall', type: 'outline', status: 'warning' });
      }
      actions.push({ key: 'refresh', type: 'outline' });
      return actions;
    }
    case 'installed': {
      const actions: RuntimeActionDescriptor[] = [];

      if (supportsStart) {
        actions.push({ key: 'start', type: 'secondary' });
      }

      if (installed && record.onUninstall && canUninstall) {
        actions.push({ key: 'uninstall', type: 'outline', status: 'warning' });
      } else if (installed && record.onInstall && !record.onUninstall) {
        actions.push({ key: 'reinstall', type: 'outline' });
      }

      actions.push({ key: 'refresh', type: 'outline' });
      return actions;
    }
    default:
      return [{ key: 'refresh', type: 'outline' }];
  }
}

export function getRuntimeActions(record: ToolRow, t: TranslateFn): RuntimeAction[] {
  return getRuntimeActionDescriptors(record).flatMap((action) => {
    switch (action.key) {
      case 'install':
        return record.onInstall
          ? [
              {
                ...action,
                label: t('settings.runtimeSettings.button.install'),
                onClick: record.onInstall,
              },
            ]
          : [];
      case 'reinstall':
        return record.onInstall
          ? [
              {
                ...action,
                label: t('settings.runtimeSettings.button.reinstall'),
                onClick: record.onInstall,
              },
            ]
          : [];
      case 'uninstall':
        return record.onUninstall
          ? [
              {
                ...action,
                label: t('settings.runtimeSettings.button.uninstall'),
                onClick: record.onUninstall,
              },
            ]
          : [];
      case 'start':
        return record.onStart
          ? [
              {
                ...action,
                label: t('settings.runtimeSettings.button.start'),
                onClick: record.onStart,
              },
            ]
          : [];
      case 'refresh':
      default:
        return record.onRefresh
          ? [
              {
                ...action,
                label: t('settings.runtimeSettings.button.refresh'),
                onClick: record.onRefresh,
              },
            ]
          : [];
    }
  });
}
