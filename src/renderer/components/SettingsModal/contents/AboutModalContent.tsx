/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Message, Typography, Table } from '@arco-design/web-react';
import React, { useCallback, useEffect, useState } from 'react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import { useSettingsViewMode } from '../settingsViewContext';
import packageJson from '../../../../../package.json';
import { nexus as nexusIpc, claudeCli as claudeCliIpc, libreOffice as libreOfficeIpc, sudoclaw as sudoclawIpc } from '@/common/ipcBridge';
import type { ICliStatus, ILibreOfficeStatus, ILibreOfficeInstallPhase, NexusInstallPhase } from '@/common/ipcBridge';

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
  onRefresh: () => Promise<void>;
  onInstall?: () => Promise<void>;
}

// ── sub-components ───────────────────────────────────────────────────────────

const StatusDot: React.FC<{ ok: boolean }> = ({ ok }) => <span className={classNames('inline-block w-6px h-6px rd-full flex-shrink-0', ok ? 'bg-green-5' : 'bg-gray-4')} />;

const VersionBadge: React.FC<{ version?: string }> = ({ version }) => <span className='px-8px py-2px rd-full text-11px font-500 bg-fill-2 text-t-secondary font-mono whitespace-nowrap'>{version ?? '—'}</span>;

// ── main component ────────────────────────────────────────────────────────────

const AboutModalContent: React.FC = () => {
  const viewMode = useSettingsViewMode();
  const isPageMode = viewMode === 'page';
  const { t } = useTranslation();

  const [claudeStatus, setClaudeStatus] = useState<ICliStatus | null>(null);
  const [claudeLoad, setClaudeLoad] = useState<LoadState>('idle');
  const [claudePhase, setClaudePhase] = useState<'downloading' | 'extracting' | 'configuring' | undefined>(undefined);

  const [nexusPort, setNexusPort] = useState<number | undefined>(undefined);
  const [nexusRunning, setNexusRunning] = useState<boolean>(false);
  const [nexusInstalled, setNexusInstalled] = useState<boolean>(false);
  const [nexusLoad, setNexusLoad] = useState<LoadState>('idle');
  const [nexusPhase, setNexusPhase] = useState<NexusInstallPhase | undefined>(undefined);
  const [nexusPercent, setNexusPercent] = useState<number | undefined>(undefined);

  const [libreOfficeStatus, setLibreOfficeStatus] = useState<ILibreOfficeStatus | null>(null);
  const [libreOfficeLoad, setLibreOfficeLoad] = useState<LoadState>('idle');
  const [libreOfficePhase, setLibreOfficePhase] = useState<ILibreOfficeInstallPhase | undefined>(undefined);
  const [libreOfficePercent, setLibreOfficePercent] = useState<number | undefined>(undefined);

  const [sudoclawInstalled, setSudoclawInstalled] = useState<boolean>(false);
  const [sudoclawLoad, setSudoclawLoad] = useState<LoadState>('idle');
  const [sudoclawPhase, setSudoclawPhase] = useState<'extracting' | 'installing' | 'configuring' | undefined>(undefined);

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
        Message.success('Claude Code 安装成功');
        await refreshClaude();
      } else {
        Message.error(res?.msg || 'Claude Code 安装失败');
      }
    } catch (e) {
      Message.error(e instanceof Error ? e.message : 'Claude Code 安装失败');
    } finally {
      setClaudeLoad('idle');
      setClaudePhase(undefined);
    }
  }, [refreshClaude]);

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
        Message.success('LibreOffice 安装成功');
      } else {
        Message.error(res?.msg || 'LibreOffice 安装失败');
      }
    } catch (e) {
      Message.error(e instanceof Error ? e.message : 'LibreOffice 安装失败');
    } finally {
      setLibreOfficeLoad('idle');
      setLibreOfficePhase(undefined);
      setLibreOfficePercent(undefined);
    }
  }, [refreshLibreOffice]);

  const refreshSudoclaw = useCallback(async () => {
    const res = await sudoclawIpc.getStatus.invoke();
    if (res?.success && res.data) {
      setSudoclawInstalled(res.data.installed);
    } else {
      setSudoclawInstalled(false);
    }
  }, []);

  const installSudoclaw = useCallback(async () => {
    setSudoclawLoad('installing');
    setSudoclawPhase(undefined);
    try {
      const res = await sudoclawIpc.install.invoke();
      if (res?.success) {
        await refreshSudoclaw();
        Message.success('Sudoclaw 安装成功');
      } else {
        Message.error(res?.msg || 'Sudoclaw 安装失败');
      }
    } catch (e) {
      Message.error(e instanceof Error ? e.message : 'Sudoclaw 安装失败');
    } finally {
      setSudoclawLoad('idle');
      setSudoclawPhase(undefined);
    }
  }, [refreshSudoclaw]);

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
        Message.success('Nexus 安装成功');
      } else {
        Message.error(res?.msg || 'Nexus 安装失败');
      }
    } catch (e) {
      Message.error(e instanceof Error ? e.message : 'Nexus 安装失败');
    } finally {
      setNexusLoad('idle');
      setNexusPhase(undefined);
      setNexusPercent(undefined);
    }
  }, [refreshNexus]);

  // Load all on mount; also restore install state if an install is already in progress
  useEffect(() => {
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
      unsubClaude();
      unsubClaudeProgress();
      unsubSudoclawProgress();
      unsubSudoclawResult();
      unsubNexusProgress();
      unsubClaudeProgress();
      unsubNexusProgress();
      unsubNexusResult();
      unsubLoProgress();
      unsubLoResult();
    };
  }, [refreshClaude, refreshNexus]);

  const columns = [
    {
      title: '工具',
      dataIndex: 'displayName',
      key: 'displayName',
      render: (value: string, record: ToolRow) => {
        // 获取状态相关信息用于颜色显示
        let statusColor = 'text-t-secondary'; // 默认灰色
        let statusText = '未安装';

        if (record.loadState === 'installing') {
          statusColor = 'color-blue-6'; // 蓝色
          const phaseLabel: Record<string, string> = {
            // LibreOffice phases
            downloading: `下载中 ${record.installPercent != null ? record.installPercent + '%' : ''}`,
            mounting: '挂载中…',
            copying: '安装中…',
            unmounting: '清理中…',
            installing: '安装中…',
            cleanup: '清理中…',
            // Nexus phases
            checking: '检查中…',
            unpacking: '解包中…',
            starting: '启动中…',
            ready: '就绪',
            error: '出错',
            // CLI phases
            extracting: '解压中…',
            configuring: '配置中…',
          };
          statusText = phaseLabel[record.installPhase ?? 'installing'] ?? '安装中…';
        } else if (record.key === 'nexus') {
          if (record.nexusRunning) {
            statusColor = 'color-green-6'; // 绿色
            statusText = `运行中 :${record.nexusPort}`;
          } else if (record.nexusInstalled) {
            statusColor = 'text-t-secondary'; // 灰色
            statusText = '未运行';
          } else {
            statusColor = 'text-t-secondary'; // 灰色
            statusText = '未安装';
          }
        } else if (record.status === null) {
          statusText = '检查中…';
        } else if (record.status.installed) {
          statusColor = 'color-green-6'; // 绿色
          statusText = '已安装';
        } else {
          statusText = '未安装';
        }

        const version = record.key === 'nexus' ? `v${record.appVersion}` : record.status?.version;

        const badgeColor = record.key === 'nexus' ? 'bg-orange-1 color-orange-6' : record.key === 'claude' ? 'bg-orange-1 color-orange-6' : record.key === 'libreoffice' ? 'bg-green-1 color-green-6' : record.key === 'sudoclaw' ? 'bg-purple-1 color-purple-6' : 'bg-blue-1 color-blue-6';

        return (
          <div className='flex items-center gap-12px'>
            <div className={classNames('w-36px h-36px rd-8px flex items-center justify-center flex-shrink-0 text-10px font-700', badgeColor)}>{record.badge}</div>
            <div className='flex flex-col gap-2px flex-1 min-w-0'>
              <span className='text-13px font-600 text-t-primary leading-none'>{value}</span>
              <div className='flex items-center gap-6px'>
                <span className={`text-11px font-500 ${statusColor}`}>{statusText}</span>
                {version && <span className='px-6px py-1px rd-20px text-10px font-500 bg-fill-2 text-t-secondary font-mono whitespace-nowrap'>{version}</span>}
              </div>
            </div>
          </div>
        );
      },
      width: 280,
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: any, record: ToolRow) => {
        const isLoading = record.loadState !== 'idle';

        return (
          <div className='flex items-center justify-center gap-6px'>
            <Button type='text' size='mini' disabled={isLoading} onClick={record.onInstall} style={{ fontSize: 11, color: 'var(--color-text-3)' }}>
              安装
            </Button>
            <Button type='text' size='mini' disabled={isLoading} onClick={record.onRefresh} style={{ fontSize: 11, color: 'var(--color-text-3)' }}>
              刷新
            </Button>
          </div>
        );
      },
      width: 120,
      align: 'center' as const,
    },
  ];

  const tableData = [
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
    },
    {
      key: 'libreoffice',
      displayName: 'LibreOffice',
      command: '文档处理套件',
      badge: 'LO',
      status: libreOfficeStatus ? { installed: libreOfficeStatus.installed, source: 'system', version: libreOfficeStatus.version } : null,
      loadState: libreOfficeLoad,
      installPhase: libreOfficePhase,
      installPercent: libreOfficePercent,
      onRefresh: refreshLibreOffice,
      onInstall: installLibreOffice,
    },
    {
      key: 'sudoclaw',
      displayName: 'Sudoclaw (OpenClaw)',
      command: 'openclaw',
      badge: 'OC',
      status: sudoclawInstalled ? { installed: true, source: 'managed', version: packageJson.version } : null,
      loadState: sudoclawLoad,
      installPhase: sudoclawPhase,
      onRefresh: refreshSudoclaw,
      onInstall: installSudoclaw,
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
    },
  ];

  return (
    <div className='flex flex-col h-full w-full'>
      <div className={classNames('flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-24px', isPageMode && 'px-0 overflow-visible')}>
        <div className='flex flex-col max-w-540px mx-auto'>
          {/* App info */}
          <div className='flex flex-col items-center py-28px'>
            <div className='w-56px h-56px rd-16px bg-gradient-to-br from-orange-4 to-orange-6 flex items-center justify-center mb-12px shadow-md'>
              <span className='text-white text-20px font-800'>S</span>
            </div>
            <Typography.Title heading={4} className='text-18px font-700 text-t-primary mb-4px mt-0'>
              Sudowork
            </Typography.Title>
            <div className='text-12px text-t-tertiary mb-10px'>北京数牍科技有限公司</div>
            <span className='px-10px py-3px rd-20px text-12px bg-fill-2 text-t-secondary font-mono font-500'>v{packageJson.version}</span>
            <Button size='small' type='outline' className='mt-12px' onClick={() => window.dispatchEvent(new Event('aionui-open-update-modal'))}>
              {t('settings.checkForUpdates')}
            </Button>
          </div>

          {/* Tools table */}
          <Table columns={columns} data={tableData} pagination={false} showHeader={false} rowClassName={() => 'hover:bg-fill-1'} scroll={{ x: 'max-content' }} />
        </div>
      </div>
    </div>
  );
};

export default AboutModalContent;
