/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SudoClawToggle — Persistent mode switch + status indicator
 *
 * Renders a toggle switch to enable/disable SudoClaw persistent mode,
 * along with a status dot (green = running, orange = requires_action).
 * Designed to be embedded in the sidebar or conversation settings.
 */

import { Message, Switch, Tooltip } from '@arco-design/web-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { sudoclaw as sudoclawIpc } from '@/common/ipcBridge';
import type { ISudoClawPersistentStatus, SudoClawSessionState } from '@/common/ipcBridge';

// ─── Status dot colors ───────────────────────────────────────────────

const STATE_DOT_COLORS: Record<SudoClawSessionState, string | null> = {
  idle: null, // no dot
  running: '#52c41a', // green
  sleeping: '#52c41a', // green (still healthy)
  requires_action: '#fa8c16', // orange
  error: '#f5222d', // red
};

const STATE_LABELS: Record<SudoClawSessionState, string> = {
  idle: 'sudoclaw.persistent.state.idle',
  running: 'sudoclaw.persistent.state.running',
  sleeping: 'sudoclaw.persistent.state.sleeping',
  requires_action: 'sudoclaw.persistent.state.requiresAction',
  error: 'sudoclaw.persistent.state.error',
};

// ─── Status Dot Component ────────────────────────────────────────────

interface StatusDotProps {
  state: SudoClawSessionState;
  size?: number;
}

const StatusDot: React.FC<StatusDotProps> = ({ state, size = 8 }) => {
  const color = STATE_DOT_COLORS[state];
  if (!color) return null;

  const isAnimated = state === 'running';

  return (
    <span
      className='inline-block rd-50% shrink-0'
      style={{
        width: size,
        height: size,
        backgroundColor: color,
        animation: isAnimated ? 'sudoclaw-pulse 2s ease-in-out infinite' : undefined,
      }}
    />
  );
};

// ─── Main Toggle Component ───────────────────────────────────────────

interface SudoClawToggleProps {
  /** Compact mode — only shows dot + switch, no labels */
  compact?: boolean;
  className?: string;
}

const SudoClawToggle: React.FC<SudoClawToggleProps> = ({ compact = false, className }) => {
  const { t } = useTranslation();
  const [status, setStatus] = useState<ISudoClawPersistentStatus | null>(null);
  const [loading, setLoading] = useState(false);

  // Fetch initial status
  const refreshStatus = useCallback(async () => {
    try {
      const res = await sudoclawIpc.persistentStatus.invoke();
      if (res?.success && res.data) {
        setStatus(res.data);
      }
    } catch {
      // Silently ignore — status will remain null
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  // Subscribe to real-time status changes
  useEffect(() => {
    const unsubscribe = sudoclawIpc.persistentStatusChanged.on((newStatus) => {
      setStatus(newStatus);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  // Handle toggle
  const handleToggle = useCallback(
    async (checked: boolean) => {
      setLoading(true);
      try {
        if (checked) {
          const res = await sudoclawIpc.persistentEnable.invoke();
          if (res?.success) {
            Message.success(t('sudoclaw.persistent.enabled', { defaultValue: 'SudoClaw persistent mode enabled' }));
          } else {
            Message.error(res?.msg || t('sudoclaw.persistent.enableFailed', { defaultValue: 'Failed to enable persistent mode' }));
          }
        } else {
          const res = await sudoclawIpc.persistentDisable.invoke();
          if (res?.success) {
            Message.success(t('sudoclaw.persistent.disabled', { defaultValue: 'SudoClaw persistent mode disabled' }));
          } else {
            Message.error(res?.msg || t('sudoclaw.persistent.disableFailed', { defaultValue: 'Failed to disable persistent mode' }));
          }
        }
        // Refresh status after toggle
        await refreshStatus();
      } catch (err) {
        Message.error(err instanceof Error ? err.message : t('sudoclaw.persistent.operationFailed', { defaultValue: 'Operation failed' }));
      } finally {
        setLoading(false);
      }
    },
    [refreshStatus, t]
  );

  const isEnabled = status?.enabled ?? false;
  const sessionState = status?.sessionState ?? 'idle';

  // Build tooltip content
  const tooltipContent = status
    ? [
        t(STATE_LABELS[sessionState], { defaultValue: sessionState }),
        status.tickCount > 0 ? `${t('sudoclaw.persistent.ticks', { defaultValue: 'Ticks' })}: ${status.tickCount}` : null,
        status.sleepUntil ? `${t('sudoclaw.persistent.sleepUntil', { defaultValue: 'Sleep until' })}: ${new Date(status.sleepUntil).toLocaleTimeString()}` : null,
        status.pendingQuestion ? `⚠ ${status.pendingQuestion}` : null,
      ]
        .filter(Boolean)
        .join('\n')
    : t('sudoclaw.persistent.label', { defaultValue: 'SudoClaw Persistent Mode' });

  if (compact) {
    return (
      <Tooltip content={tooltipContent} position='right' mini>
        <div className={`flex items-center gap-6px ${className || ''}`}>
          <StatusDot state={sessionState} />
          <Switch size='small' checked={isEnabled || loading} loading={loading} onChange={handleToggle} />
        </div>
      </Tooltip>
    );
  }

  return (
    <div className={`flex items-center justify-between gap-12px py-12px ${className || ''}`}>
      <div className='min-w-0 flex-1'>
        <div className='flex items-center gap-8px'>
          <StatusDot state={sessionState} />
          <span className='text-14px text-t-primary'>{t('sudoclaw.persistent.label', { defaultValue: 'SudoClaw Persistent Mode' })}</span>
        </div>
        {status?.pendingQuestion && <div className='text-12px text-warning mt-2px truncate'>⚠ {status.pendingQuestion}</div>}
        {status?.error && <div className='text-12px text-danger mt-2px truncate'>{status.error}</div>}
      </div>
      <div className='flex items-center shrink-0'>
        <Switch checked={isEnabled || loading} loading={loading} onChange={handleToggle} />
      </div>
    </div>
  );
};

export default SudoClawToggle;
