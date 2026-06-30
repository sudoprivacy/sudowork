import type { RuntimeAction, RuntimeResolvedStatus, ToolRow } from '../types';

type RuntimeActionDescriptor = Omit<RuntimeAction, 'label' | 'onClick'>;

type TranslateFn = (key: string, opts?: Record<string, unknown>) => string;

export const badgeColors: Record<string, string> = {
  node: 'bg-cyan-1 color-cyan-6 border border-cyan-3',
  claude: 'bg-orange-1 color-orange-6 border border-orange-3',
  libreoffice: 'bg-green-1 color-green-6 border border-green-3',
  python: 'bg-[#fef3c7] color-[#d97706] border border-[#fcd34d]',
  sudocode: 'bg-purple-1 color-purple-6 border border-purple-3',
  shareone: 'bg-blue-1 color-blue-6 border border-blue-3',
  nexus: 'text-[#f6c65b] border border-[#6f5520] bg-[#2b2212]',
};

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
  const isShareOne = record.key === 'shareone';
  const shareOneStatusText = t('settings.runtimeSettings.status.disabled', { defaultValue: '未启用' });

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
        statusText: isShareOne ? shareOneStatusText : record.key === 'nexus' ? t('settings.runtimeSettings.status.notRunning') : t('settings.runtimeSettings.status.installed'),
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
        statusText: isShareOne ? shareOneStatusText : t('settings.runtimeSettings.status.notInstalled'),
      };
  }
}

export function getRuntimeActionDescriptors(record: ToolRow): RuntimeActionDescriptor[] {
  const installed = isInstalled(record);
  const source = record.status?.source;
  const canUninstall = record.key !== 'node' && source === 'managed';
  // Show an "install managed" button when only a system-level runtime was detected,
  // so the user can install the bundled version without uninstalling their existing one.
  const canInstallManaged = source === 'system' && !!record.onInstall;
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

      // System runtime detected but managed version not yet installed: offer install.
      if (canInstallManaged) {
        actions.push({ key: 'install', type: 'primary' });
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
