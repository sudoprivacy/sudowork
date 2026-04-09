/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Message } from '@arco-design/web-react';
import React, { useCallback, useEffect, useState } from 'react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import AionScrollArea from '@/renderer/components/base/AionScrollArea';
import { useSettingsViewMode } from '../settingsViewContext';
import { nexus as nexusIpc, claudeCli as claudeCliIpc, libreOffice as libreOfficeIpc, sudoclaw as sudoclawIpc, nodeRuntime as nodeRuntimeIpc, acpConversation } from '@/common/ipcBridge';
import { mutate } from 'swr';
import type { ICliStatus, ILibreOfficeInstallPhase, ISudoclawInstallPhase, NexusInstallPhase } from '@/common/ipcBridge';
import { getRuntimeActions, getStatusInfo, isInstalled, type LoadState, type ToolRow } from './runtimeStatus';

type RefreshOptions = {
  silent?: boolean;
};

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
  const [nexusStatusResolved, setNexusStatusResolved] = useState<boolean>(false);
  const [nexusLoad, setNexusLoad] = useState<LoadState>('idle');
  const [nexusPhase, setNexusPhase] = useState<NexusInstallPhase | undefined>(undefined);
  const [nexusPercent, setNexusPercent] = useState<number | undefined>(undefined);

  const [libreOfficeStatus, setLibreOfficeStatus] = useState<ICliStatus | null>(null);
  const [libreOfficeLoad, setLibreOfficeLoad] = useState<LoadState>('idle');
  const [libreOfficePhase, setLibreOfficePhase] = useState<ILibreOfficeInstallPhase | undefined>(undefined);
  const [libreOfficePercent, setLibreOfficePercent] = useState<number | undefined>(undefined);

  const [sudoclawInstalled, setSudoclawInstalled] = useState<boolean>(false);
  const [sudoclawVersion, setSudoclawVersion] = useState<string | undefined>(undefined);
  const [sudoclawGatewayPort, setSudoclawGatewayPort] = useState<number | undefined>(undefined);
  const [sudoclawGatewayRunning, setSudoclawGatewayRunning] = useState<boolean>(false);
  const [sudoclawStatusResolved, setSudoclawStatusResolved] = useState<boolean>(false);
  const [sudoclawLoad, setSudoclawLoad] = useState<LoadState>('idle');
  const [sudoclawPhase, setSudoclawPhase] = useState<ISudoclawInstallPhase | undefined>(undefined);

  const [nexusVersion, setNexusVersion] = useState<string | undefined>(undefined);

  const refreshNode = useCallback(async (options?: RefreshOptions) => {
    if (!options?.silent) {
      setNodeLoad('loading');
    }
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
      if (!options?.silent) {
        setNodeLoad('idle');
      }
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

  const refreshClaude = useCallback(async (options?: RefreshOptions) => {
    if (!options?.silent) {
      setClaudeLoad('loading');
    }
    try {
      const res = await claudeCliIpc.checkInstalled.invoke();
      if (res?.success && res.data) setClaudeStatus(res.data);
    } finally {
      if (!options?.silent) {
        setClaudeLoad('idle');
      }
    }
  }, []);

  /** Refresh the Guid homepage agent list (best-effort). */
  const refreshAvailableAgents = useCallback(async () => {
    try {
      await acpConversation.refreshCustomAgents.invoke();
      await mutate('acp.agents.available');
    } catch {
      /* silent – agent list refresh is best-effort */
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
        // Refresh the Guid homepage agent list so Claude Code appears immediately
        void refreshAvailableAgents();
      } else {
        Message.error(res?.msg || t('settings.runtimeSettings.installFailed', { name: 'Claude Code' }));
      }
    } catch (e) {
      Message.error(e instanceof Error ? e.message : t('settings.runtimeSettings.installFailed', { name: 'Claude Code' }));
    } finally {
      setClaudeLoad('idle');
      setClaudePhase(undefined);
    }
  }, [refreshClaude, refreshAvailableAgents, t]);

  const uninstallClaude = useCallback(async () => {
    setClaudeLoad('loading');
    try {
      const res = await claudeCliIpc.uninstall.invoke();
      if (res?.success) {
        Message.success(t('settings.runtimeSettings.uninstallSuccess', { name: 'Claude Code' }));
        await refreshClaude();
        // Refresh the Guid homepage agent list so Claude Code is removed immediately
        void refreshAvailableAgents();
      } else {
        Message.error(res?.msg || t('settings.runtimeSettings.uninstallFailed', { name: 'Claude Code' }));
      }
    } catch (e) {
      Message.error(e instanceof Error ? e.message : t('settings.runtimeSettings.uninstallFailed', { name: 'Claude Code' }));
    } finally {
      setClaudeLoad('idle');
    }
  }, [refreshClaude, refreshAvailableAgents, t]);

  const refreshLibreOffice = useCallback(async (options?: RefreshOptions) => {
    if (!options?.silent) {
      setLibreOfficeLoad('loading');
    }
    try {
      const res = await libreOfficeIpc.checkInstalled.invoke();
      if (res?.success && res.data) setLibreOfficeStatus(res.data);
    } finally {
      if (!options?.silent) {
        setLibreOfficeLoad('idle');
      }
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
    try {
      const res = await sudoclawIpc.getStatus.invoke();
      if (res?.success && res.data) {
        setSudoclawInstalled(res.data.installed);
        setSudoclawVersion(res.data.version);
        setSudoclawGatewayPort(res.data.gatewayPort);
        setSudoclawGatewayRunning(!!res.data.gatewayRunning);
      } else {
        setSudoclawInstalled(false);
        setSudoclawVersion(undefined);
        setSudoclawGatewayPort(undefined);
        setSudoclawGatewayRunning(false);
      }
    } finally {
      setSudoclawStatusResolved(true);
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

  const refreshNexus = useCallback(async () => {
    try {
      const res = await nexusIpc.getStatus.invoke();
      if (res?.success && res.data) {
        setNexusRunning(res.data.running);
        setNexusPort(res.data.port);
        setNexusInstalled(res.data.installed);
        setNexusVersion(res.data.version);
      } else {
        setNexusRunning(false);
        setNexusPort(undefined);
        setNexusInstalled(false);
        setNexusVersion(undefined);
      }
    } finally {
      setNexusStatusResolved(true);
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

  const refreshRuntimePage = useCallback(
    async (options?: RefreshOptions) => {
      await Promise.all([refreshNode(options), refreshClaude(options), refreshSudoclaw(), refreshNexus(), refreshLibreOffice(options)]);
    },
    [refreshClaude, refreshLibreOffice, refreshNexus, refreshNode, refreshSudoclaw]
  );

  // Load all on mount; also restore install state if an install is already in progress
  useEffect(() => {
    void refreshRuntimePage();
    void sudoclawIpc.getInstallState.invoke().then((res) => {
      if (res?.success && res.data?.installing) {
        setSudoclawLoad('installing');
        if (res.data.phase) setSudoclawPhase(res.data.phase);
      }
    });
    void libreOfficeIpc.getInstallState.invoke().then((res) => {
      if (res?.success && res.data?.installing) {
        setLibreOfficeLoad('installing');
        if (res.data.phase) setLibreOfficePhase(res.data.phase);
        if (res.data.percent != null) setLibreOfficePercent(res.data.percent);
      }
    });
  }, [refreshRuntimePage]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshRuntimePage({ silent: true });
    }, 3000);

    return () => {
      window.clearInterval(timer);
    };
  }, [refreshRuntimePage]);

  // Auto-refresh when main process finishes a background install (e.g. first-launch prompt)
  useEffect(() => {
    const unsubNode = nodeRuntimeIpc.installResult.on(() => void refreshNode());
    const unsubClaude = claudeCliIpc.installResult.on(() => {
      setClaudePhase(undefined);
      void refreshClaude();
      // Also refresh the Guid homepage agent list for background installs
      void refreshAvailableAgents();
    });
    const unsubClaudeProgress = claudeCliIpc.installProgress.on(({ phase }) => {
      setClaudePhase(phase);
    });
    const unsubSudoclawProgress = sudoclawIpc.installProgress.on(({ phase }) => {
      setSudoclawLoad('installing');
      setSudoclawPhase(phase);
    });
    const unsubSudoclawResult = sudoclawIpc.installResult.on(() => {
      setSudoclawLoad('idle');
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
  }, [refreshNode, refreshClaude, refreshAvailableAgents, refreshNexus, refreshSudoclaw, refreshLibreOffice]);

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
      displayName: 'Sudoclaw',
      command: 'openclaw',
      badge: 'SC',
      status: sudoclawInstalled ? { installed: true, source: 'managed', version: sudoclawVersion } : null,
      statusResolved: sudoclawStatusResolved,
      sudoclawGatewayPort,
      sudoclawGatewayRunning,
      loadState: sudoclawLoad,
      installPhase: sudoclawPhase,
      onRefresh: refreshSudoclaw,
      onInstall: installSudoclaw,
      onUninstall: uninstallSudoclaw,
      onStart: startSudoclawGateway,
    },
    {
      key: 'nexus',
      displayName: 'Nexus Server',
      command: 'nexusd',
      badge: 'NX',
      status: nexusInstalled ? { installed: true, source: 'managed', version: nexusVersion } : null,
      statusResolved: nexusStatusResolved,
      nexusPort,
      nexusRunning,
      nexusInstalled,
      loadState: nexusLoad,
      installPhase: nexusPhase,
      installPercent: nexusPercent,
      onRefresh: refreshNexus,
      onInstall: installNexus,
      onUninstall: uninstallNexus,
      onStart: startNexus,
    },
  ];

  const badgeColors: Record<string, string> = {
    node: 'bg-cyan-1 color-cyan-6 border border-cyan-3',
    claude: 'bg-orange-1 color-orange-6 border border-orange-3',
    libreoffice: 'bg-green-1 color-green-6 border border-green-3',
    sudoclaw: 'bg-purple-1 color-purple-6 border border-purple-3',
    nexus: 'bg-gold-1 color-gold-6 border border-gold-3',
  };

  return (
    <div className='flex flex-col h-full w-full'>
      <AionScrollArea className='flex-1 min-h-0 pb-16px' disableOverflow={isPageMode}>
        <div className={classNames('space-y-16px px-24px', isPageMode && 'px-0')}>
          <div className='max-w-820px mx-auto bg-2 rd-16px border border-border-2 px-16px md:px-24px lg:px-28px py-16px md:py-18px'>
            <div className='flex flex-col gap-4px'>
              <h3 className='text-17px md:text-18px font-600 text-t-primary m-0 leading-24px'>{t('settings.runtimeSettings.title')}</h3>
              <p className='text-13px md:text-14px text-t-secondary m-0 leading-22px'>{t('settings.runtimeSettings.description')}</p>
            </div>

            <div className='mt-16px flex flex-col divide-y divide-border-2'>
              {tableData.map((record) => {
                const { dotColor, statusText } = getStatusInfo(record, t);
                const version = record.status?.version;
                const loading = record.loadState !== 'idle';
                const installed = isInstalled(record);
                const source = record.status?.source;
                const sourceLabel = source && source !== 'none' ? t(`settings.runtimeSettings.source.${source}`, { defaultValue: source }) : undefined;
                const actions = getRuntimeActions(record, t);

                return (
                  <div key={record.key} className='py-16px first:pt-0 last:pb-0'>
                    <div className='flex flex-col gap-14px md:flex-row md:items-center md:justify-between md:gap-20px'>
                      <div className='flex items-start gap-12px min-w-0 flex-1'>
                        <div className={classNames('w-44px h-44px rd-12px flex items-center justify-center flex-shrink-0 text-11px md:text-12px font-700 shadow-sm', badgeColors[record.key] || 'bg-blue-1 color-blue-6 border border-blue-3')}>{record.badge}</div>

                        <div className='min-w-0 flex-1 space-y-8px'>
                          <div className='flex flex-col gap-8px lg:flex-row lg:items-center lg:gap-10px'>
                            <span className='text-15px md:text-16px font-600 text-t-primary leading-22px md:leading-24px'>{record.displayName}</span>
                            {record.key !== 'sudoclaw' && <span className='w-fit px-8px py-2px rd-999px text-11px md:text-12px font-mono bg-fill-1 text-t-secondary border border-border-2'>{record.command}</span>}
                          </div>

                          <div className='flex flex-wrap items-center gap-8px'>
                            <span className='inline-flex items-center gap-6px px-8px py-3px rd-999px bg-fill-1 text-12px md:text-13px text-t-secondary border border-border-2'>
                              <span className={classNames('w-6px h-6px rd-full flex-shrink-0', dotColor)} />
                              <span className='leading-none font-500'>{statusText}</span>
                            </span>
                            {version && <span className='px-8px py-3px rd-999px text-11px md:text-12px font-500 bg-fill-1 text-t-secondary border border-border-2 whitespace-nowrap'>{version}</span>}
                            {sourceLabel && installed && <span className='px-8px py-3px rd-999px text-11px md:text-12px font-500 bg-[var(--color-primary-light-1)] text-[var(--color-primary-6)] border border-[var(--color-primary-light-3)] whitespace-nowrap'>{sourceLabel}</span>}
                          </div>
                        </div>
                      </div>

                      <div className='flex flex-wrap items-center gap-8px md:justify-end md:max-w-280px'>
                        {actions.map((action) => (
                          <Button key={`${record.key}-${action.key}`} type={action.type === 'primary' ? 'primary' : 'outline'} size='small' status={action.status} disabled={loading} onClick={action.onClick} className={classNames('min-w-84px !rd-8px !text-12px md:!text-13px !font-500', action.type === 'secondary' && '!border-[var(--color-primary-light-3)] !text-[var(--color-primary-6)] !bg-[var(--color-primary-light-1)] hover:!bg-[var(--color-primary-light-2)]', action.type === 'outline' && action.status !== 'warning' && '!bg-transparent')}>
                            {action.label}
                          </Button>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </AionScrollArea>
    </div>
  );
};

export default RuntimeModalContent;
