/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Message, Typography } from '@arco-design/web-react';
import React, { useCallback, useEffect, useState } from 'react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import { useSettingsViewMode } from '../settingsViewContext';
import packageJson from '../../../../../package.json';
import { nexus as nexusIpc, claudeCli as claudeCliIpc, geminiCli as geminiCliIpc, libreOffice as libreOfficeIpc } from '@/common/ipcBridge';
import type { ICliStatus, ILibreOfficeStatus, ILibreOfficeInstallPhase } from '@/common/ipcBridge';

// ── types ────────────────────────────────────────────────────────────────────

type LoadState = 'idle' | 'loading' | 'installing';

interface ToolRow {
  key: string;
  displayName: string;
  command: string;
  badge: string;
  status: ICliStatus | null;
  nexusPort?: number;
  appVersion?: string;
  loadState: LoadState;
  installPhase?: ILibreOfficeInstallPhase;
  installPercent?: number;
  onRefresh: () => Promise<void>;
  onInstall?: () => Promise<void>;
}

// ── sub-components ───────────────────────────────────────────────────────────

const StatusDot: React.FC<{ ok: boolean }> = ({ ok }) => <span className={classNames('inline-block w-6px h-6px rd-full flex-shrink-0', ok ? 'bg-green-5' : 'bg-gray-4')} />;

const VersionBadge: React.FC<{ version?: string }> = ({ version }) => <span className='px-8px py-2px rd-full text-11px font-500 bg-fill-2 text-t-secondary font-mono whitespace-nowrap'>{version ?? '—'}</span>;

const ToolRowItem: React.FC<{ row: ToolRow }> = ({ row }) => {
  const isLoading = row.loadState !== 'idle';
  const installed = row.key === 'nexus' ? true : (row.status?.installed ?? false);
  const version = row.key === 'nexus' ? `v${row.appVersion}` : row.status?.version;

  let statusText: React.ReactNode;
  if (row.key === 'nexus') {
    if (row.nexusPort) {
      statusText = (
        <span className='flex items-center gap-6px text-12px text-t-secondary'>
          <StatusDot ok={true} />
          <span className='color-green-6 font-500'>运行中</span>
          <span className='font-mono bg-fill-2 px-6px py-1px rd-4px text-11px'>:{row.nexusPort}</span>
        </span>
      );
    } else {
      statusText = (
        <span className='flex items-center gap-6px text-12px text-t-secondary'>
          <StatusDot ok={false} />
          <span>未运行</span>
        </span>
      );
    }
  } else if (row.loadState === 'installing') {
    const phaseLabel: Record<string, string> = {
      downloading: `下载中 ${row.installPercent != null ? row.installPercent + '%' : ''}`,
      mounting: '挂载中…',
      copying: '安装中…',
      unmounting: '清理中…',
      cleanup: '清理中…',
    };
    statusText = <span className='text-12px text-t-tertiary'>{phaseLabel[row.installPhase ?? 'downloading'] ?? '安装中…'}</span>;
  } else if (row.status === null) {
    statusText = <span className='text-12px text-t-tertiary'>检查中…</span>;
  } else if (row.status.installed) {
    statusText = (
      <span className='flex items-center gap-6px text-12px'>
        <StatusDot ok={true} />
        <span className='color-green-6 font-500'>已安装</span>
        {row.status.source === 'managed' && <span className='text-11px text-t-tertiary bg-fill-2 px-5px py-1px rd-4px'>Sudowork</span>}
      </span>
    );
  } else {
    statusText = (
      <span className='flex items-center gap-6px text-12px'>
        <StatusDot ok={false} />
        <span className='text-t-secondary'>未安装</span>
      </span>
    );
  }

  return (
    <div className='flex items-center gap-12px py-14px px-16px rd-8px transition-all duration-150 hover:bg-fill-1'>
      {/* Left badge */}
      <div className={classNames('w-36px h-36px rd-8px flex items-center justify-center flex-shrink-0 text-10px font-700', row.key === 'nexus' ? 'bg-orange-1 color-orange-6' : row.key === 'claude' ? 'bg-orange-1 color-orange-6' : row.key === 'libreoffice' ? 'bg-green-1 color-green-6' : 'bg-blue-1 color-blue-6')}>{row.badge}</div>

      {/* Name + command */}
      <div className='flex flex-col gap-2px flex-1 min-w-0'>
        <span className='text-13px font-600 text-t-primary leading-none'>{row.displayName}</span>
        <code className='text-11px text-t-tertiary font-mono'>{row.command}</code>
      </div>

      {/* Version */}
      <VersionBadge version={version} />

      {/* Status */}
      <div className='w-120px flex-shrink-0 flex items-center'>{statusText}</div>

      {/* Action - fixed layout: install slot + refresh button always visible */}
      <div className='flex items-center gap-6px flex-shrink-0'>
        {/* Install slot - always occupies fixed width to keep layout stable */}
        <div className='w-52px flex justify-end'>
          {row.onInstall && !installed && (
            <Button type='primary' size='mini' loading={row.loadState === 'installing'} disabled={row.loadState === 'loading'} onClick={row.onInstall}>
              安装
            </Button>
          )}
        </div>
        {/* Refresh - always visible */}
        <Button type='text' size='mini' disabled={isLoading} onClick={row.onRefresh} style={{ fontSize: 11, color: 'var(--color-text-3)' }}>
          刷新
        </Button>
      </div>
    </div>
  );
};

// ── main component ────────────────────────────────────────────────────────────

const AboutModalContent: React.FC = () => {
  const viewMode = useSettingsViewMode();
  const isPageMode = viewMode === 'page';
  const { t } = useTranslation();

  const [claudeStatus, setClaudeStatus] = useState<ICliStatus | null>(null);
  const [claudeLoad, setClaudeLoad] = useState<LoadState>('idle');

  const [geminiStatus, setGeminiStatus] = useState<ICliStatus | null>(null);
  const [geminiLoad, setGeminiLoad] = useState<LoadState>('idle');

  const [nexusPort, setNexusPort] = useState<number | undefined>(undefined);

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
    if (res?.success && res.data?.running) setNexusPort(res.data.port);
    else setNexusPort(undefined);
  }, []);

  // Load all on mount; also restore install state if an install is already in progress
  useEffect(() => {
    void refreshClaude();
    void refreshGemini();
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
    const unsubLoProgress = libreOfficeIpc.installProgress.on(({ phase, percent }) => {
      setLibreOfficePhase(phase);
      if (percent != null) setLibreOfficePercent((prev) => (prev != null ? Math.max(prev, percent) : percent));
    });
    const unsubLoResult = libreOfficeIpc.installResult.on(() => void refreshLibreOffice());
    return () => {
      unsubClaude();
      unsubGemini();
      unsubLoProgress();
      unsubLoResult();
    };
  }, [refreshClaude, refreshGemini]);

  const toolRows: ToolRow[] = [
    {
      key: 'claude',
      displayName: 'Claude Code',
      command: 'claude',
      badge: 'CC',
      status: claudeStatus,
      loadState: claudeLoad,
      onRefresh: refreshClaude,
      onInstall: installClaude,
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
  ];

  const nexusRow: ToolRow = {
    key: 'nexus',
    displayName: 'Nexus Server',
    command: '内置服务',
    badge: 'NX',
    status: { installed: true, source: 'managed' },
    nexusPort,
    appVersion: packageJson.version,
    loadState: 'idle',
    onRefresh: refreshNexus,
  };

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

          {/* External tools card */}
          <div className='rd-12px border border-solid border-bd-2 overflow-hidden mb-12px'>
            <div className='px-16px py-10px bg-fill-1 border-b border-solid border-bd-2'>
              <span className='text-12px font-600 text-t-secondary uppercase tracking-wider'>外部工具</span>
            </div>
            <div className='px-4px py-4px'>
              {toolRows.map((row, i) => (
                <div key={row.key} className={i > 0 ? 'border-t border-solid border-bd-1' : ''}>
                  <ToolRowItem row={row} />
                </div>
              ))}
            </div>
          </div>

          {/* Built-in services card */}
          <div className='rd-12px border border-solid border-bd-2 overflow-hidden mb-24px'>
            <div className='px-16px py-10px bg-fill-1 border-b border-solid border-bd-2'>
              <span className='text-12px font-600 text-t-secondary uppercase tracking-wider'>内置服务</span>
            </div>
            <div className='px-4px py-4px'>
              <ToolRowItem row={nexusRow} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AboutModalContent;
