/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Message } from '@arco-design/web-react';
import React, { useCallback, useEffect, useState } from 'react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import { useSettingsViewMode } from '../settingsViewContext';
import packageJson from '../../../../../package.json';
import { nexus as nexusIpc, claudeCli as claudeCliIpc, libreOffice as libreOfficeIpc, sudoclaw as sudoclawIpc, nodeRuntime as nodeRuntimeIpc } from '@/common/ipcBridge';
import type { ICliStatus, ILibreOfficeInstallPhase, NexusInstallPhase } from '@/common/ipcBridge';

// ── types ────────────────────────────────────────────────────────────────────

type LoadState = 'idle' | 'loading' | 'installing';

interface ToolRow {
  key: string;
  displayName: string;
  command: string;
  badge: string;
  status: ICliStatus | null;
  nexusPort?: number;
  nexusRunning?: boolean;
  nexusInstalled?: boolean;
  appVersion?: string;
  loadState: LoadState;
  installPhase?: ILibreOfficeInstallPhase | NexusInstallPhase | string;
  installPercent?: number;
  sudoclawGatewayRunning?: boolean;
  onRefresh: () => Promise<void>;
  onInstall?: () => Promise<void>;
  onUninstall?: () => Promise<void>;
  onStart?: () => Promise<void>;
  onStop?: () => Promise<void>;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function getStatusInfo(record: ToolRow, t: (key: string, opts?: Record<string, unknown>) => string) {
  let dotColor = 'bg-gray-4'; // gray
  let statusText = t('settings.runtimeSettings.status.notInstalled');

  if (record.loadState === 'installing') {
    dotColor = 'bg-blue-5'; // blue
    const phase = record.installPhase ?? 'installing';
    const phaseKey = `settings.runtimeSettings.phase.${phase}`;
    const percent = record.installPercent != null ? `${record.installPercent}%` : '';
    statusText = t(phaseKey, { percent, defaultValue: t('settings.runtimeSettings.phase.installing') });
  } else if (record.key === 'nexus') {
    if (record.nexusRunning) {
      dotColor = 'bg-green-5';
      statusText = t('settings.runtimeSettings.status.running', { port: record.nexusPort });
    } else if (record.nexusInstalled) {
      dotColor = 'bg-gray-4';
      statusText = t('settings.runtimeSettings.status.notRunning');
    } else {
      dotColor = 'bg-gray-4';
      statusText = t('settings.runtimeSettings.status.notInstalled');
    }
  } else if (record.key === 'sudoclaw') {
    if (record.sudoclawGatewayRunning) {
      dotColor = 'bg-green-5';
      statusText = t('settings.runtimeSettings.status.running', { port: '' }).replace(' :', '');
    } else if (record.status?.installed) {
      dotColor = 'bg-gray-4';
      statusText = t('settings.runtimeSettings.status.notRunning');
    } else {
      dotColor = 'bg-gray-4';
      statusText = t('settings.runtimeSettings.status.notInstalled');
    }
  } else if (record.status === null) {
    dotColor = 'bg-gray-4';
    statusText = t('settings.runtimeSettings.status.checking');
  } else if (record.status.installed) {
    dotColor = 'bg-green-5';
    statusText = t('settings.runtimeSettings.status.installed');
  }

  return { dotColor, statusText };
}

function isInstalled(record: ToolRow): boolean {
  if (record.key === 'nexus') return !!record.nexusInstalled;
  return !!record.status?.installed;
}

// ── main component ────────────────────────────────────────────────────────────

const RuntimeModalContent: React.FC = () => {
  const { t } = useTranslation();
  const viewMode = useSettingsViewMode();
  const isPageMode = viewMode === 'page';

  const [nodeStatus, setNodeStatus] = useState<ICliStatus | null>(null);
  const [nodeLoad, setNodeLoad] = useState<LoadState>('idle');

  const [claudeStatus, setClaudeStatus] = useState<ICliStatus | null>(null);
  const [claudeLoad, setClaudeLoad] = useState<LoadState>('idle');
  const [claudePhase, setClaudePhase] = useState<'downloading' | 'extracting' | 'configuring' | undefined>(undefined);

  const [nexusPort, setNexusPort] = useState<number | undefined>(undefined);
  const [nexusRunning, setNexusRunning] = useState<boolean>(false);
  const [nexusInstalled, setNexusInstalled] = useState<boolean>(false);
  const [nexusLoad, setNexusLoad] = useState<LoadState>('idle');
  const [nexusPhase, setNexusPhase] = useState<NexusInstallPhase | undefined>(undefined);
  const [nexusPercent, setNexusPercent] = useState<number | undefined>(undefined);

  const [libreOfficeStatus, setLibreOfficeStatus] = useState<ICliStatus | null>(null);
  const [libreOfficeLoad, setLibreOfficeLoad] = useState<LoadState>('idle');
  const [libreOfficePhase, setLibreOfficePhase] = useState<ILibreOfficeInstallPhase | undefined>(undefined);
  const [libreOfficePercent, setLibreOfficePercent] = useState<number | undefined>(undefined);

  const [sudoclawInstalled, setSudoclawInstalled] = useState<boolean>(false);
  const [sudoclawGatewayRunning, setSudoclawGatewayRunning] = useState<boolean>(false);
  const [sudoclawLoad, setSudoclawLoad] = useState<LoadState>('idle');
  const [sudoclawPhase, setSudoclawPhase] = useState<'extracting' | 'installing' | 'configuring' | undefined>(undefined);

  const refreshNode = useCallback(async () => {
    setNodeLoad('loading');
    try {
      const res = await nodeRuntimeIpc.checkInstalled.invoke();
      if (res?.success && res.data) {
        setNodeStatus(res.data);
      } else {
        setNodeStatus({ installed: false, source: 'managed' });
      }
    } catch {
      setNodeStatus({ installed: false, source: 'managed' });
    } finally {
      setNodeLoad('idle');
    }
  }, []);

  const installNode = useCallback(async () => {
    setNodeLoad('installing');
    try {
      const res = await nodeRuntimeIpc.install.invoke();
      if (res?.success) {
        Message.success(t('settings.runtimeSettings.installSuccess', { name: 'Node.js' }));
        await refreshNode();
      } else {
        Message.error(res?.msg || t('settings.runtimeSettings.installFailed', { name: 'Node.js' }));
      }
    } catch (e) {
      Message.error(e instanceof Error ? e.message : t('settings.runtimeSettings.installFailed', { name: 'Node.js' }));
    } finally {
      setNodeLoad('idle');
    }
  }, [refreshNode, t]);

  const uninstallNode = useCallback(async () => {
    setNodeLoad('loading');
    try {
      const res = await nodeRuntimeIpc.uninstall.invoke();
      if (res?.success) {
        Message.success(t('settings.runtimeSettings.uninstallSuccess', { name: 'Node.js' }));
        await refreshNode();
      } else {
        Message.error(res?.msg || t('settings.runtimeSettings.uninstallFailed', { name: 'Node.js' }));
      }
    } catch (e) {
      Message.error(e instanceof Error ? e.message : t('settings.runtimeSettings.uninstallFailed', { name: 'Node.js' }));
    } finally {
      setNodeLoad('idle');
    }
  }, [refreshNode, t]);

  const refreshClaude = useCallback(async () => {
    setClaudeLoad('loading');
    try {
      const res = await claudeCliIpc.checkInstalled.invoke();
      if (res?.success && res.data) setClaudeStatus(res.data);
    } finally {
      setClaudeLoad('idle');
    }
  }, []);

  const installClaude = useCallback(async () => {
    setClaudeLoad('installing');
    setClaudePhase(undefined);
    try {
      const res = await claudeCliIpc.install.invoke();
      if (res?.success) {
        Message.success(t('settings.runtimeSettings.installSuccess', { name: 'Claude Code' }));
        await refreshClaude();
      } else {
        Message.error(res?.msg || t('settings.runtimeSettings.installFailed', { name: 'Claude Code' }));
      }
    } catch (e) {
      Message.error(e instanceof Error ? e.message : t('settings.runtimeSettings.installFailed', { name: 'Claude Code' }));
    } finally {
      setClaudeLoad('idle');
      setClaudePhase(undefined);
    }
  }, [refreshClaude, t]);

  const uninstallClaude = useCallback(async () => {
    setClaudeLoad('loading');
    try {
      const res = await claudeCliIpc.uninstall.invoke();
      if (res?.success) {
        Message.success(t('settings.runtimeSettings.uninstallSuccess', { name: 'Claude Code' }));
        await refreshClaude();
      } else {
        Message.error(res?.msg || t('settings.runtimeSettings.uninstallFailed', { name: 'Claude Code' }));
      }
    } catch (e) {
      Message.error(e instanceof Error ? e.message : t('settings.runtimeSettings.uninstallFailed', { name: 'Claude Code' }));
    } finally {
      setClaudeLoad('idle');
    }
  }, [refreshClaude, t]);

  const refreshLibreOffice = useCallback(async () => {
    setLibreOfficeLoad('loading');
    try {
      const res = await libreOfficeIpc.checkInstalled.invoke();
      if (res?.success && res.data) setLibreOfficeStatus(res.data);
    } finally {
      setLibreOfficeLoad('idle');
    }
  }, []);

  const installLibreOffice = useCallback(async () => {
    setLibreOfficeLoad('installing');
    try {
      const res = await libreOfficeIpc.install.invoke();
      if (res?.success) {
        await refreshLibreOffice();
        Message.success(t('settings.runtimeSettings.installSuccess', { name: 'LibreOffice' }));
      } else {
        Message.error(res?.msg || t('settings.runtimeSettings.installFailed', { name: 'LibreOffice' }));
      }
    } catch (e) {
      Message.error(e instanceof Error ? e.message : t('settings.runtimeSettings.installFailed', { name: 'LibreOffice' }));
    } finally {
      setLibreOfficeLoad('idle');
      setLibreOfficePhase(undefined);
      setLibreOfficePercent(undefined);
    }
  }, [refreshLibreOffice, t]);

  const uninstallLibreOffice = useCallback(async () => {
    setLibreOfficeLoad('loading');
    try {
      const res = await libreOfficeIpc.uninstall.invoke();
      if (res?.success) {
        Message.success(t('settings.runtimeSettings.uninstallSuccess', { name: 'LibreOffice' }));
        await refreshLibreOffice();
      } else {
        Message.error(res?.msg || t('settings.runtimeSettings.uninstallFailed', { name: 'LibreOffice' }));
      }
    } catch (e) {
      Message.error(e instanceof Error ? e.message : t('settings.runtimeSettings.uninstallFailed', { name: 'LibreOffice' }));
    } finally {
      setLibreOfficeLoad('idle');
    }
  }, [refreshLibreOffice, t]);

  const refreshSudoclaw = useCallback(async () => {
    const res = await sudoclawIpc.getStatus.invoke();
    if (res?.success && res.data) {
      setSudoclawInstalled(res.data.installed);
      setSudoclawGatewayRunning(!!res.data.gatewayRunning);
    } else {
      setSudoclawInstalled(false);
      setSudoclawGatewayRunning(false);
    }
  }, []);

  const installSudoclaw = useCallback(async () => {
    setSudoclawLoad('installing');
    setSudoclawPhase(undefined);
    try {
      const res = await sudoclawIpc.install.invoke();
      if (res?.success) {
        await refreshSudoclaw();
        Message.success(t('settings.runtimeSettings.installSuccess', { name: 'Sudoclaw' }));
      } else {
        Message.error(res?.msg || t('settings.runtimeSettings.installFailed', { name: 'Sudoclaw' }));
      }
    } catch (e) {
      Message.error(e instanceof Error ? e.message : t('settings.runtimeSettings.installFailed', { name: 'Sudoclaw' }));
    } finally {
      setSudoclawLoad('idle');
      setSudoclawPhase(undefined);
    }
  }, [refreshSudoclaw, t]);

  const uninstallSudoclaw = useCallback(async () => {
    setSudoclawLoad('loading');
    try {
      const res = await sudoclawIpc.uninstall.invoke();
      if (res?.success) {
        Message.success(t('settings.runtimeSettings.uninstallSuccess', { name: 'Sudoclaw' }));
        await refreshSudoclaw();
      } else {
        Message.error(res?.msg || t('settings.runtimeSettings.uninstallFailed', { name: 'Sudoclaw' }));
      }
    } catch (e) {
      Message.error(e instanceof Error ? e.message : t('settings.runtimeSettings.uninstallFailed', { name: 'Sudoclaw' }));
    } finally {
      setSudoclawLoad('idle');
    }
  }, [refreshSudoclaw, t]);

  const startSudoclawGateway = useCallback(async () => {
    setSudoclawLoad('loading');
    try {
      const res = await sudoclawIpc.startGateway.invoke();
      if (res?.success) {
        Message.success(t('settings.runtimeSettings.startSuccess', { name: 'Sudoclaw' }));
        await new Promise((r) => setTimeout(r, 3000));
        await refreshSudoclaw();
      } else {
        Message.error(res?.msg || t('settings.runtimeSettings.startFailed', { name: 'Sudoclaw' }));
      }
    } catch (e) {
      Message.error(e instanceof Error ? e.message : t('settings.runtimeSettings.startFailed', { name: 'Sudoclaw' }));
    } finally {
      setSudoclawLoad('idle');
    }
  }, [refreshSudoclaw, t]);

  const stopSudoclawGateway = useCallback(async () => {
    setSudoclawLoad('loading');
    try {
      const res = await sudoclawIpc.stopGateway.invoke();
      if (res?.success) {
        Message.success(t('settings.runtimeSettings.stopSuccess', { name: 'Sudoclaw' }));
        await new Promise((r) => setTimeout(r, 1000));
        await refreshSudoclaw();
      } else {
        Message.error(res?.msg || t('settings.runtimeSettings.stopFailed', { name: 'Sudoclaw' }));
      }
    } catch (e) {
      Message.error(e instanceof Error ? e.message : t('settings.runtimeSettings.stopFailed', { name: 'Sudoclaw' }));
    } finally {
      setSudoclawLoad('idle');
    }
  }, [refreshSudoclaw, t]);

  const refreshNexus = useCallback(async () => {
    const res = await nexusIpc.getStatus.invoke();
    if (res?.success && res.data) {
      setNexusRunning(res.data.running);
      setNexusPort(res.data.port);
      setNexusInstalled(res.data.installed);
    } else {
      setNexusRunning(false);
      setNexusPort(undefined);
      setNexusInstalled(false);
    }
  }, []);

  const installNexus = useCallback(async () => {
    setNexusLoad('installing');
    setNexusPhase(undefined);
    setNexusPercent(undefined);
    try {
      const res = await nexusIpc.install.invoke();
      if (res?.success) {
        await refreshNexus();
        Message.success(t('settings.runtimeSettings.installSuccess', { name: 'Nexus' }));
      } else {
        Message.error(res?.msg || t('settings.runtimeSettings.installFailed', { name: 'Nexus' }));
      }
    } catch (e) {
      Message.error(e instanceof Error ? e.message : t('settings.runtimeSettings.installFailed', { name: 'Nexus' }));
    } finally {
      setNexusLoad('idle');
      setNexusPhase(undefined);
      setNexusPercent(undefined);
    }
  }, [refreshNexus, t]);

  const uninstallNexus = useCallback(async () => {
    setNexusLoad('loading');
    try {
      const res = await nexusIpc.uninstall.invoke();
      if (res?.success) {
        Message.success(t('settings.runtimeSettings.uninstallSuccess', { name: 'Nexus' }));
        await refreshNexus();
      } else {
        Message.error(res?.msg || t('settings.runtimeSettings.uninstallFailed', { name: 'Nexus' }));
      }
    } catch (e) {
      Message.error(e instanceof Error ? e.message : t('settings.runtimeSettings.uninstallFailed', { name: 'Nexus' }));
    } finally {
      setNexusLoad('idle');
    }
  }, [refreshNexus, t]);

  const startNexus = useCallback(async () => {
    setNexusLoad('loading');
    try {
      const res = await nexusIpc.start.invoke();
      if (res?.success) {
        Message.success(t('settings.runtimeSettings.startSuccess', { name: 'Nexus' }));
        await new Promise((r) => setTimeout(r, 3000));
        await refreshNexus();
      } else {
        Message.error(res?.msg || t('settings.runtimeSettings.startFailed', { name: 'Nexus' }));
      }
    } catch (e) {
      Message.error(e instanceof Error ? e.message : t('settings.runtimeSettings.startFailed', { name: 'Nexus' }));
    } finally {
      setNexusLoad('idle');
    }
  }, [refreshNexus, t]);

  const stopNexus = useCallback(async () => {
    setNexusLoad('loading');
    try {
      const res = await nexusIpc.stop.invoke();
      if (res?.success) {
        Message.success(t('settings.runtimeSettings.stopSuccess', { name: 'Nexus' }));
        await new Promise((r) => setTimeout(r, 1000));
        await refreshNexus();
      } else {
        Message.error(res?.msg || t('settings.runtimeSettings.stopFailed', { name: 'Nexus' }));
      }
    } catch (e) {
      Message.error(e instanceof Error ? e.message : t('settings.runtimeSettings.stopFailed', { name: 'Nexus' }));
    } finally {
      setNexusLoad('idle');
    }
  }, [refreshNexus, t]);

  // Load all on mount; also restore install state if an install is already in progress
  useEffect(() => {
    void refreshNode();
    void refreshClaude();
    void refreshSudoclaw();
    void refreshNexus();
    void refreshLibreOffice();
    void libreOfficeIpc.getInstallState.invoke().then((res) => {
      if (res?.success && res.data?.installing) {
        setLibreOfficeLoad('installing');
        if (res.data.phase) setLibreOfficePhase(res.data.phase);
        if (res.data.percent != null) setLibreOfficePercent(res.data.percent);
      }
    });
  }, []);

  // Auto-refresh when main process finishes a background install (e.g. first-launch prompt)
  useEffect(() => {
    const unsubNode = nodeRuntimeIpc.installResult.on(() => void refreshNode());
    const unsubClaude = claudeCliIpc.installResult.on(() => {
      setClaudePhase(undefined);
      void refreshClaude();
    });
    const unsubClaudeProgress = claudeCliIpc.installProgress.on(({ phase }) => {
      setClaudePhase(phase);
    });
    const unsubSudoclawProgress = sudoclawIpc.installProgress.on(({ phase }) => {
      setSudoclawPhase(phase);
    });
    const unsubSudoclawResult = sudoclawIpc.installResult.on(() => {
      setSudoclawPhase(undefined);
      void refreshSudoclaw();
    });
    const unsubNexusProgress = nexusIpc.installProgress.on(({ phase, percent }) => {
      setNexusPhase(phase);
      if (percent != null) setNexusPercent(percent);
    });
    const unsubNexusResult = nexusIpc.installResult.on(() => void refreshNexus());
    const unsubLoProgress = libreOfficeIpc.installProgress.on(({ phase, percent }) => {
      setLibreOfficePhase(phase);
      if (percent != null) setLibreOfficePercent((prev) => (prev != null ? Math.max(prev, percent) : percent));
    });
    const unsubLoResult = libreOfficeIpc.installResult.on(() => void refreshLibreOffice());
    return () => {
      unsubNode();
      unsubClaude();
      unsubClaudeProgress();
      unsubSudoclawProgress();
      unsubSudoclawResult();
      unsubNexusProgress();
      unsubNexusResult();
      unsubLoProgress();
      unsubLoResult();
    };
  }, [refreshNode, refreshClaude, refreshNexus, refreshSudoclaw, refreshLibreOffice]);

  const tableData: ToolRow[] = [
    {
      key: 'node',
      displayName: 'Node.js',
      command: 'node',
      badge: 'NJ',
      status: nodeStatus,
      loadState: nodeLoad,
      onRefresh: refreshNode,
      onInstall: installNode,
      onUninstall: uninstallNode,
    },
    {
      key: 'claude',
      displayName: 'Claude Code',
      command: 'claude',
      badge: 'CC',
      status: claudeStatus,
      loadState: claudeLoad,
      installPhase: claudePhase,
      onRefresh: refreshClaude,
      onInstall: installClaude,
      onUninstall: uninstallClaude,
    },
    {
      key: 'libreoffice',
      displayName: 'LibreOffice',
      command: 'libreoffice',
      badge: 'LO',
      status: libreOfficeStatus,
      loadState: libreOfficeLoad,
      installPhase: libreOfficePhase,
      installPercent: libreOfficePercent,
      onRefresh: refreshLibreOffice,
      onInstall: installLibreOffice,
      onUninstall: uninstallLibreOffice,
    },
    {
      key: 'sudoclaw',
      displayName: 'Sudoclaw (OpenClaw)',
      command: 'openclaw',
      badge: 'OC',
      status: sudoclawInstalled ? { installed: true, source: 'managed', version: packageJson.version } : null,
      sudoclawGatewayRunning,
      loadState: sudoclawLoad,
      installPhase: sudoclawPhase,
      onRefresh: refreshSudoclaw,
      onInstall: installSudoclaw,
      onUninstall: uninstallSudoclaw,
      onStart: startSudoclawGateway,
      onStop: stopSudoclawGateway,
    },
    {
      key: 'nexus',
      displayName: 'Nexus Server',
      command: 'nexusd',
      badge: 'NX',
      status: nexusInstalled ? { installed: true, source: 'managed', version: packageJson.version } : null,
      nexusPort,
      nexusRunning,
      nexusInstalled,
      appVersion: packageJson.version,
      loadState: nexusLoad,
      installPhase: nexusPhase,
      installPercent: nexusPercent,
      onRefresh: refreshNexus,
      onInstall: installNexus,
      onUninstall: uninstallNexus,
      onStart: startNexus,
      onStop: stopNexus,
    },
  ];

  const badgeColors: Record<string, string> = {
    node: 'bg-cyan-1 color-cyan-6',
    claude: 'bg-orange-1 color-orange-6',
    libreoffice: 'bg-green-1 color-green-6',
    sudoclaw: 'bg-purple-1 color-purple-6',
    nexus: 'bg-orange-1 color-orange-6',
  };

  return (
    <div className='flex flex-col h-full w-full'>
      <div className={classNames('flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-24px', isPageMode && 'px-0 overflow-visible')}>
        <div className='flex flex-col max-w-540px mx-auto gap-12px'>
          {/* Section header */}
          <div className='mb-4px'>
            <h3 className='text-15px font-600 text-t-primary m-0 leading-snug'>{t('settings.runtimeSettings.title')}</h3>
            <p className='text-12px text-t-secondary m-0 mt-4px'>{t('settings.runtimeSettings.description')}</p>
          </div>

          {/* Card list */}
          {tableData.map((record) => {
            const { dotColor, statusText } = getStatusInfo(record, t);
            const version = record.key === 'nexus' ? `v${record.appVersion}` : record.status?.version;
            const loading = record.loadState !== 'idle';
            const installed = isInstalled(record);
            const source = record.status?.source;
            const sourceLabel = source && source !== 'none'
              ? t(`settings.runtimeSettings.source.${source}`, { defaultValue: source })
              : undefined;
            // Can only uninstall managed; system (e.g. Homebrew) can't be uninstalled from here
            const canUninstall = source === 'managed';

            return (
              <div
                key={record.key}
                className='rd-12px bg-fill-1 hover:bg-fill-2 px-16px py-12px flex items-center gap-12px transition-colors'
              >
                {/* Badge */}
                <div
                  className={classNames(
                    'w-40px h-40px rd-10px flex items-center justify-center flex-shrink-0 text-11px font-700',
                    badgeColors[record.key] || 'bg-blue-1 color-blue-6',
                  )}
                >
                  {record.badge}
                </div>

                {/* Info */}
                <div className='flex flex-col gap-2px flex-1 min-w-0'>
                  <span className='text-13px font-600 text-t-primary leading-none'>{record.displayName}</span>
                  <div className='flex items-center gap-6px'>
                    <span className={classNames('w-6px h-6px rd-full flex-shrink-0', dotColor)} />
                    <span className='text-11px font-500 text-t-secondary'>{statusText}</span>
                    {version && (
                      <span className='px-6px py-1px rd-20px text-10px font-500 bg-fill-2 text-t-secondary font-mono whitespace-nowrap'>
                        {version}
                      </span>
                    )}
                    {/* Source badge */}
                    {sourceLabel && installed && (
                      <span className='px-6px py-1px rd-20px text-10px font-500 bg-blue-1 color-blue-6 whitespace-nowrap'>
                        {sourceLabel}
                      </span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className='flex items-center gap-6px flex-shrink-0'>
                  {/* Start/Stop buttons — for sudoclaw and nexus when installed */}
                  {record.onStart && record.onStop && (() => {
                    const isRunning = (record.key === 'sudoclaw' && record.sudoclawGatewayRunning) || (record.key === 'nexus' && record.nexusRunning);
                    return isRunning ? (
                      <Button type='outline' size='mini' status='warning' disabled={loading} onClick={record.onStop} style={{ fontSize: 11 }}>
                        {t('settings.runtimeSettings.button.stop')}
                      </Button>
                    ) : installed ? (
                      <Button type='outline' size='mini' disabled={loading} onClick={record.onStart} style={{ fontSize: 11 }}>
                        {t('settings.runtimeSettings.button.start')}
                      </Button>
                    ) : null;
                  })()}

                  {record.onUninstall ? (
                    /* Install / Uninstall — managed can be uninstalled; system shows Install */
                    canUninstall ? (
                      <Button type='outline' size='mini' status='warning' disabled={loading} onClick={record.onUninstall} style={{ fontSize: 11 }}>
                        {t('settings.runtimeSettings.button.uninstall')}
                      </Button>
                    ) : (
                      <Button type='primary' size='mini' disabled={loading} onClick={record.onInstall} style={{ fontSize: 11 }}>
                        {t('settings.runtimeSettings.button.install')}
                      </Button>
                    )
                  ) : (
                    <>
                      {/* Install / Reinstall */}
                      {!installed ? (
                        <Button type='primary' size='mini' disabled={loading} onClick={record.onInstall} style={{ fontSize: 11 }}>
                          {t('settings.runtimeSettings.button.install')}
                        </Button>
                      ) : (
                        <Button type='outline' size='mini' disabled={loading} onClick={record.onInstall} style={{ fontSize: 11 }}>
                          {t('settings.runtimeSettings.button.reinstall')}
                        </Button>
                      )}

                      {/* Refresh */}
                      <Button type='outline' size='mini' disabled={loading} onClick={record.onRefresh} style={{ fontSize: 11 }}>
                        {t('settings.runtimeSettings.button.refresh')}
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default RuntimeModalContent;
