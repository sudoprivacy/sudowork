/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { sudoclaw as sudoclawIpc } from '@/common/ipcBridge';
import { Badge, Card, Spin, Tag } from '@arco-design/web-react';
import { DataFile, History, Lightning, PlayOne } from '@icon-park/react';
import dayjs from 'dayjs';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import SudoClawToggle from './SudoClawToggle';
import type { SudoClawDashboardStatus, SudoClawSessionState } from './types';

/** Maps session state to a Tag color */
const sessionStateColor: Record<SudoClawSessionState, string> = {
  idle: 'gray',
  active: 'green',
  paused: 'orangered',
};

/**
 * SudoClaw dashboard page.
 *
 * Shows gateway / session status and provides quick access to the
 * memory viewer. Status information comes from the existing
 * `sudoclaw.getStatus` IPC provider; the dashboard-level metrics
 * (tickCount, sessionState) will be wired up once #214 and #217 land.
 */
const SudoClawPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [installed, setInstalled] = useState(false);
  const [gatewayRunning, setGatewayRunning] = useState(false);
  const [gatewayPort, setGatewayPort] = useState<number | undefined>();
  const [version, setVersion] = useState<string | undefined>();

  // Dashboard-level status — will be populated via IPC once #214/#217 merge
  const [dashboardStatus, setDashboardStatus] = useState<SudoClawDashboardStatus>({
    enabled: false,
    sessionState: 'idle',
    tickCount: 0,
    lastActivity: null,
  });

  /** Refresh status from the main process */
  const refresh = useCallback(async () => {
    try {
      const res = await sudoclawIpc.getStatus.invoke();
      if (res?.success && res.data) {
        setInstalled(res.data.installed);
        setGatewayRunning(!!res.data.gatewayRunning);
        setGatewayPort(res.data.gatewayPort);
        setVersion(res.data.version);

        // Derive enabled state from gateway status for now
        setDashboardStatus((prev) => ({
          ...prev,
          enabled: !!res.data!.gatewayRunning,
          sessionState: res.data!.hasActiveSession ? 'active' : 'idle',
        }));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Handle toggle — start or stop the gateway */
  const handleToggle = useCallback(
    async (enabled: boolean) => {
      try {
        const res = enabled ? await sudoclawIpc.startGateway.invoke() : await sudoclawIpc.stopGateway.invoke();
        if (res?.success) {
          // Wait briefly for the gateway state to settle, then refresh
          await new Promise((r) => setTimeout(r, 1500));
          await refresh();
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },
    [refresh]
  );

  if (loading) {
    return (
      <div className='flex items-center justify-center h-full'>
        <Spin size={32} />
      </div>
    );
  }

  if (!installed) {
    return (
      <div className='flex flex-col items-center justify-center h-full gap-16px'>
        <Lightning theme='outline' size='48' fill='var(--color-text-3)' />
        <span className='text-16px color-[var(--color-text-3)]'>{t('sudoclaw.status.notInstalled')}</span>
      </div>
    );
  }

  return (
    <div className='p-24px max-w-800px mx-auto flex flex-col gap-24px'>
      {/* Header */}
      <div className='flex items-center justify-between'>
        <h2 className='text-20px font-600 color-[var(--color-text-1)] m-0'>{t('sudoclaw.dashboard')}</h2>
        <SudoClawToggle enabled={dashboardStatus.enabled} onToggle={handleToggle} />
      </div>

      {/* Status cards */}
      <div className='grid grid-cols-2 gap-16px'>
        {/* Session state */}
        <Card size='small' className='!rounded-8px' hoverable>
          <div className='flex items-center gap-12px'>
            <PlayOne theme='outline' size='20' fill='var(--color-text-3)' />
            <div className='flex flex-col gap-4px'>
              <span className='text-12px color-[var(--color-text-3)]'>{t('sudoclaw.status.sessionState')}</span>
              <Tag color={sessionStateColor[dashboardStatus.sessionState]} size='small'>
                {t(`sudoclaw.session.${dashboardStatus.sessionState}`)}
              </Tag>
            </div>
          </div>
        </Card>

        {/* Tick count */}
        <Card size='small' className='!rounded-8px' hoverable>
          <div className='flex items-center gap-12px'>
            <Lightning theme='outline' size='20' fill='var(--color-text-3)' />
            <div className='flex flex-col gap-4px'>
              <span className='text-12px color-[var(--color-text-3)]'>{t('sudoclaw.status.tickCount')}</span>
              <span className='text-18px font-600 color-[var(--color-text-1)]'>{dashboardStatus.tickCount}</span>
            </div>
          </div>
        </Card>

        {/* Last activity */}
        <Card size='small' className='!rounded-8px' hoverable>
          <div className='flex items-center gap-12px'>
            <History theme='outline' size='20' fill='var(--color-text-3)' />
            <div className='flex flex-col gap-4px'>
              <span className='text-12px color-[var(--color-text-3)]'>{t('sudoclaw.status.lastActivity')}</span>
              <span className='text-14px color-[var(--color-text-1)]'>{dashboardStatus.lastActivity ? dayjs(dashboardStatus.lastActivity).format('YYYY-MM-DD HH:mm') : t('sudoclaw.status.noActivity')}</span>
            </div>
          </div>
        </Card>

        {/* Gateway info */}
        <Card size='small' className='!rounded-8px' hoverable>
          <div className='flex items-center gap-12px'>
            <Badge status={gatewayRunning ? 'success' : 'default'} />
            <div className='flex flex-col gap-4px'>
              <span className='text-12px color-[var(--color-text-3)]'>{t('sudoclaw.status.gatewayRunning')}</span>
              <span className='text-14px color-[var(--color-text-1)]'>{gatewayRunning ? `${t('sudoclaw.status.enabled')} :${gatewayPort ?? '—'}` : t('sudoclaw.status.disabled')}</span>
              {version && <span className='text-12px color-[var(--color-text-3)]'>v{version}</span>}
            </div>
          </div>
        </Card>
      </div>

      {/* Quick links */}
      <Card size='small' className='!rounded-8px cursor-pointer hover:shadow-md transition-shadow' onClick={() => navigate('/sudoclaw/memory')}>
        <div className='flex items-center gap-12px'>
          <DataFile theme='outline' size='24' fill='var(--color-text-3)' />
          <div className='flex flex-col'>
            <span className='text-14px font-500 color-[var(--color-text-1)]'>{t('sudoclaw.memoryViewer')}</span>
            <span className='text-12px color-[var(--color-text-3)]'>{t('sudoclaw.memory.browseByDate')}</span>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default SudoClawPage;
