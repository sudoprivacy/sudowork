/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Spin } from '@arco-design/web-react';
import { ipcBridge } from '@/common';
import { resetAppModeCache } from '@/renderer/hooks/useAppMode';

const LOCAL_STORAGE_WHITELIST = new Set(['__aionui_theme', 'i18nextLng', 'update.includePrerelease', 'sudowork_tenant_config']);

type OverlayState = {
  visible: boolean;
  fatal: boolean;
  message: string;
};

function clearModeScopedLocalStorage(): void {
  const preserved = new Map<string, string>();
  for (const key of LOCAL_STORAGE_WHITELIST) {
    const value = localStorage.getItem(key);
    if (value !== null) {
      preserved.set(key, value);
    }
  }

  localStorage.clear();

  for (const [key, value] of preserved) {
    localStorage.setItem(key, value);
  }
}

const ModeSwitchOverlay: React.FC = () => {
  const [state, setState] = useState<OverlayState>({
    visible: false,
    fatal: false,
    message: '',
  });

  useEffect(() => {
    const offStart = ipcBridge.application.modeSwitchStart.on(({ switchId }) => {
      setState({
        visible: true,
        fatal: false,
        message: '正在切换模式...',
      });

      try {
        clearModeScopedLocalStorage();
      } catch (error) {
        console.error('[ModeSwitchOverlay] Failed to clear localStorage:', error);
      } finally {
        void ipcBridge.application.modeSwitchLocalStorageCleared.invoke({ switchId }).catch((error) => {
          console.error('[ModeSwitchOverlay] Failed to ack localStorage cleanup:', error);
        });
      }
    });

    const offDone = ipcBridge.application.modeSwitchDone.on(({ mode }) => {
      resetAppModeCache(mode);
      window.dispatchEvent(new CustomEvent('sudowork:mode-switch-done', { detail: { mode } }));
      setState({
        visible: false,
        fatal: false,
        message: '',
      });
    });

    const offFailed = ipcBridge.application.modeSwitchFailed.on(({ error }) => {
      window.dispatchEvent(new CustomEvent('sudowork:mode-switch-failed', { detail: { error } }));
      setState({
        visible: true,
        fatal: false,
        message: '切换失败，已恢复原模式',
      });
    });

    const offFatal = ipcBridge.application.modeSwitchFatal.on(() => {
      setState({
        visible: true,
        fatal: true,
        message: '切换失败，请重启应用',
      });
    });

    return () => {
      offStart();
      offDone();
      offFailed();
      offFatal();
    };
  }, []);

  if (!state.visible) {
    return null;
  }

  return (
    <div
      style={
        {
          position: 'fixed',
          inset: 0,
          zIndex: 10000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(15, 23, 42, 0.62)',
          color: '#fff',
          WebkitAppRegion: 'no-drag',
        } as React.CSSProperties
      }
    >
      <div
        style={{
          minWidth: 260,
          maxWidth: 360,
          padding: '28px 32px',
          borderRadius: 8,
          background: 'rgba(17, 24, 39, 0.96)',
          boxShadow: '0 24px 72px rgba(0, 0, 0, 0.32)',
          textAlign: 'center',
        }}
      >
        {!state.fatal && <Spin style={{ marginBottom: 16 }} />}
        <div style={{ fontSize: 16, fontWeight: 600, lineHeight: '24px' }}>{state.message}</div>
      </div>
    </div>
  );
};

export default ModeSwitchOverlay;
