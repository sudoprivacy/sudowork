/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Message, Typography, Modal, Table } from '@arco-design/web-react';
import React, { useCallback, useEffect, useState } from 'react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import { useSettingsViewMode } from '../settingsViewContext';
import packageJson from '../../../../../package.json';
import { nexus as nexusIpc, claudeCli as claudeCliIpc, geminiCli as geminiCliIpc, openclawCli as openclawCliIpc, libreOffice as libreOfficeIpc } from '@/common/ipcBridge';
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
  onInstallFromLocal?: () => Promise<void>;
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

  const [geminiStatus, setGeminiStatus] = useState<ICliStatus | null>(null);
  const [geminiLoad, setGeminiLoad] = useState<LoadState>('idle');

  const [openclawStatus, setOpenclawStatus] = useState<ICliStatus | null>(null);
  const [openclawLoad, setOpenclawLoad] = useState<LoadState>('idle');

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
    try {
      const res = await claudeCliIpc.install.invoke();
      if (res?.success) await refreshClaude();
    } finally {
      setClaudeLoad('idle');
    }
  }, [refreshClaude]);

  const refreshGemini = useCallback(async () => {
    setGeminiLoad('loading');
    try {
      const res = await geminiCliIpc.checkInstalled.invoke();
      if (res?.success && res.data) setGeminiStatus(res.data);
    } finally {
      setGeminiLoad('idle');
    }
  }, []);

  const installGemini = useCallback(async () => {
    setGeminiLoad('installing');
    try {
      const res = await geminiCliIpc.install.invoke();
      if (res?.success) await refreshGemini();
    } finally {
      setGeminiLoad('idle');
    }
  }, [refreshGemini]);

  const refreshOpenClaw = useCallback(async () => {
    setOpenclawLoad('loading');
    try {
      const res = await openclawCliIpc.checkInstalled.invoke();
      if (res?.success && res.data) setOpenclawStatus(res.data);
    } finally {
      setOpenclawLoad('idle');
    }
  }, []);

  const installOpenClaw = useCallback(async () => {
    setOpenclawLoad('installing');
    try {
      const res = await openclawCliIpc.install.invoke();
      if (res?.success) await refreshOpenClaw();
    } finally {
      setOpenclawLoad('idle');
    }
  }, [refreshOpenClaw]);

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

  const installClaudeFromLocal = useCallback(async () => {
    try {
      // 调用主进程IPC来从预打包资源安装claude
      const installRes = await claudeCliIpc.install.invoke();
      if (installRes?.success) {
        Message.success('Claude Code 安装成功');
        await refreshClaude();
      } else {
        Message.error(installRes?.msg || 'Claude Code 安装失败');
      }
    } catch (e) {
      Message.error(e instanceof Error ? e.message : 'Claude Code 安装失败');
    }
  }, [refreshClaude]);

  const installGeminiFromLocal = useCallback(async () => {
    try {
      // 调用主进程IPC来从预打包资源安装gemini
      const installRes = await geminiCliIpc.install.invoke();
      if (installRes?.success) {
        Message.success('Gemini CLI 安装成功');
        await refreshGemini();
      } else {
        Message.error(installRes?.msg || 'Gemini CLI 安装失败');
      }
    } catch (e) {
      Message.error(e instanceof Error ? e.message : 'Gemini CLI 安装失败');
    }
  }, [refreshGemini]);

  const installOpenClawFromLocal = useCallback(async () => {
    try {
      const installRes = await openclawCliIpc.install.invoke();
      if (installRes?.success) {
        Message.success('OpenClaw 安装成功');
        await refreshOpenClaw();
      } else {
        Message.error(installRes?.msg || 'OpenClaw 安装失败');
      }
    } catch (e) {
      Message.error(e instanceof Error ? e.message : 'OpenClaw 安装失败');
    }
  }, [refreshOpenClaw]);

  const installNexusFromLocal = useCallback(async () => {
    try {
      // 使用现有的 dialog IPC 桥接打开文件选择对话框
      const res = await import('@/common/ipcBridge').then((m) =>
        m.dialog.showOpen.invoke({
          filters: [{ name: 'Nexus Archive', extensions: ['tar.gz', 'tgz'] }],
          properties: ['openFile'],
        })
      );

      if (res?.success && res.data && !res.data.canceled && res.data.filePaths.length > 0) {
        const filePath = res.data.filePaths[0];

        // 调用IPC方法从本地文件安装
        const installRes = await nexusIpc.installFromLocalFile.invoke({ filePath });
        if (installRes?.success) {
          Message.success('Nexus 从本地文件安装成功');
          await refreshNexus();
        } else {
          Message.error(installRes?.msg || 'Nexus 从本地文件安装失败');
        }
      }
    } catch (e) {
      Message.error(e instanceof Error ? e.message : 'Nexus 从本地文件安装失败');
    }
  }, [refreshNexus]);

  const installLibreOfficeFromLocal = useCallback(async () => {
    try {
      // 使用现有的 dialog IPC 桥接打开文件选择对话框
      const res = await import('@/common/ipcBridge').then((m) =>
        m.dialog.showOpen.invoke({
          filters: [{ name: 'LibreOffice Installer', extensions: process.platform === 'win32' ? ['msi'] : process.platform === 'darwin' ? ['dmg'] : ['tar.gz'] }],
          properties: ['openFile'],
        })
      );

      if (res?.success && res.data && !res.data.canceled && res.data.filePaths.length > 0) {
        const filePath = res.data.filePaths[0];

        // 调用IPC方法从本地文件安装
        const installRes = await libreOfficeIpc.installFromLocalFile.invoke({ filePath });
        if (installRes?.success) {
          Message.success('LibreOffice 从本地文件安装成功');
          await refreshLibreOffice();
        } else {
          Message.error(installRes?.msg || 'LibreOffice 从本地文件安装失败');
        }
      }
    } catch (e) {
      Message.error(e instanceof Error ? e.message : 'LibreOffice 从本地文件安装失败');
    }
  }, [refreshLibreOffice]);

  // Load all on mount; also restore install state if an install is already in progress
  useEffect(() => {
    void refreshClaude();
    void refreshGemini();
    void refreshOpenClaw();
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
    const unsubClaude = claudeCliIpc.installResult.on(() => void refreshClaude());
    const unsubGemini = geminiCliIpc.installResult.on(() => void refreshGemini());
    const unsubOpenClaw = openclawCliIpc.installResult.on(() => void refreshOpenClaw());
    const unsubNexusProgress = nexusIpc.installProgress.on(({ phase, percent }) => {
      setNexusPhase(phase);
      if (percent != null) setNexusPercent(percent); // 直接更新，retry 时允许从 0% 重新开始
    });
    const unsubNexusResult = nexusIpc.installResult.on(() => void refreshNexus());
    const unsubLoProgress = libreOfficeIpc.installProgress.on(({ phase, percent }) => {
      setLibreOfficePhase(phase);
      if (percent != null) setLibreOfficePercent((prev) => (prev != null ? Math.max(prev, percent) : percent));
    });
    const unsubLoResult = libreOfficeIpc.installResult.on(() => void refreshLibreOffice());
    return () => {
      unsubClaude();
      unsubGemini();
      unsubOpenClaw();
      unsubNexusProgress();
      unsubNexusResult();
      unsubLoProgress();
      unsubLoResult();
    };
  }, [refreshClaude, refreshGemini, refreshOpenClaw, refreshNexus]);

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
            extracting: '解压中…',
            cleanup: '清理中…',
            // Nexus phases
            checking: '检查中…',
            unpacking: '解包中…',
            starting: '启动中…',
            ready: '就绪',
            error: '出错',
          };
          statusText = phaseLabel[record.installPhase ?? 'downloading'] ?? '安装中…';
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

        const badgeColor = record.key === 'nexus' ? 'bg-orange-1 color-orange-6' : record.key === 'claude' ? 'bg-orange-1 color-orange-6' : record.key === 'openclaw' ? 'bg-cyan-1 color-cyan-6' : record.key === 'libreoffice' ? 'bg-green-1 color-green-6' : 'bg-blue-1 color-blue-6';

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
            {/* 对 claude、gemini、openclaw 禁用在线安装按钮，只保留本地安装功能（从应用内预打包资源安装） */}
            <Button type='text' size='mini' disabled={record.key === 'claude' || record.key === 'gemini' || record.key === 'openclaw' || isLoading} onClick={record.onInstall} style={{ fontSize: 11, color: record.key === 'claude' || record.key === 'gemini' || record.key === 'openclaw' ? 'var(--color-text-4)' : 'var(--color-text-3)' }}>
              在线安装
            </Button>
            <Button type='text' size='mini' disabled={isLoading} onClick={record.onInstallFromLocal} style={{ fontSize: 11, color: 'var(--color-text-3)' }}>
              本地安装
            </Button>
            <Button type='text' size='mini' disabled={isLoading} onClick={record.onRefresh} style={{ fontSize: 11, color: 'var(--color-text-3)' }}>
              刷新
            </Button>
          </div>
        );
      },
      width: 180,
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
      onRefresh: refreshClaude,
      onInstall: installClaude,
      onInstallFromLocal: installClaudeFromLocal,
    },
    {
      key: 'gemini',
      displayName: 'Gemini CLI',
      command: 'gemini',
      badge: 'GC',
      status: geminiStatus,
      loadState: geminiLoad,
      onRefresh: refreshGemini,
      onInstall: installGemini,
      onInstallFromLocal: installGeminiFromLocal,
    },
    {
      key: 'openclaw',
      displayName: 'OpenClaw',
      command: 'openclaw',
      badge: 'OC',
      status: openclawStatus,
      loadState: openclawLoad,
      onRefresh: refreshOpenClaw,
      onInstall: installOpenClaw,
      onInstallFromLocal: installOpenClawFromLocal,
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
      onInstallFromLocal: installLibreOfficeFromLocal,
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
      onInstallFromLocal: installNexusFromLocal,
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
