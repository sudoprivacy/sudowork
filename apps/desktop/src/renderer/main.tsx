/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import AppLoader from '@renderer/components/AppLoader';
import InitLoading from '@renderer/components/InitLoading';
import OptInDialog from '@/renderer/pages/settings/system/components/OptInDialog';
import ModeSetup from '@renderer/pages/setup/ModeSetup';
import { useAuth } from '@renderer/context/AuthContext';
import { useInit } from '@renderer/context/InitContext';
import { useAppMode, isModeResolved } from '@renderer/hooks/useAppMode';
import Layout from '@renderer/layouts/layout';
import Router from '@renderer/router';
import { ErrorBoundary } from '@renderer/components/ErrorBoundary';
import { ipcBridge } from '@/common';
import { fetchSystemConfig, isProductImprovementEnabled, type SystemConfig } from '@/common/systemConfig';
import { dropSlashCommandCache } from '@renderer/hooks/useSlashCommands';

/**
 * Fetch systemConfig in the renderer AND push the snapshot to the main process so the
 * main-side cache stays aligned (the systemConfig module has one cache per process; a
 * renderer-only fetch would leave main-side readers — skillHub / sudorouter /
 * log-report — using a stale or empty cache).
 * Null result = fetch failure; do NOT propagate (would wipe whatever main-process
 * startup bootstrap previously cached).
 */
async function fetchSystemConfigAndSync(): Promise<SystemConfig | null> {
  const data = await fetchSystemConfig();
  if (data) {
    void ipcBridge.systemConfig.syncFromRenderer.invoke({ data }).catch(() => {});
  }
  return data;
}

const Main = () => {
  const { ready: authReady } = useAuth();
  const { status, isReady: initReady, hasResolvedInitialStatus, isInitScreenSkipped } = useInit();
  const { needsSetup, isEnterprise } = useAppMode();

  // Product improvement opt-in dialog state (shown only on first install for new users)
  const [isOptInDialogOpen, setIsOptInDialogOpen] = useState(false);
  const [isOptInChecked, setIsOptInChecked] = useState(false);

  // Check if opt-in dialog should be shown when init is ready (only for new users)
  useEffect(() => {
    if (isEnterprise) {
      setIsOptInDialogOpen(false);
      return;
    }

    if (initReady && !isOptInChecked) {
      // Fill the renderer system-config cache so the product_improvement switch
      // (server-driven) is accurate before deciding whether to show the opt-in dialog.
      Promise.all([ipcBridge.telemetry.getOptInShown.invoke(), fetchSystemConfigAndSync()])
        .then(([result]) => {
          // §4.5: hide the opt-in dialog when product_improvement is disabled server-side.
          if (result.success && !result.data && isProductImprovementEnabled()) {
            // Opt-in dialog hasn't been shown yet - this is a new user (first install)
            setIsOptInDialogOpen(true);
          }
          setIsOptInChecked(true);
        })
        .catch((error) => {
          console.error('[Main] Failed to check opt-in status:', error);
          setIsOptInChecked(true);
        });
    }
  }, [initReady, isEnterprise, isOptInChecked]);

  // Global cleanup on the consolidated conversation.reaped broadcast from main.
  // This covers every delete path (user-delete AND preset-assistant uninstall,
  // the latter never touching the renderer delete hook), so renderer-side caches
  // are dropped regardless of how the conversation was reaped. Map deletes are
  // idempotent, so racing with the invoke return is harmless.
  useEffect(() => {
    const unsubscribe = ipcBridge.conversation.reaped.on((payload) => {
      if (!payload?.id) return;
      dropSlashCommandCache(payload.id);
      void import('@/renderer/shared/dify/sessionBinding')
        .then(({ unbindAssistantSession }) => unbindAssistantSession(payload.id))
        .catch(() => {
          /* best-effort */
        });
    });
    return () => {
      unsubscribe();
    };
  }, []);

  // Handle opt-in dialog close
  const handleOptInClose = useCallback(async (confirmed: boolean) => {
    setIsOptInDialogOpen(false);

    // Save user's choice
    try {
      await ipcBridge.telemetry.setEnabled.invoke({ enabled: confirmed });
      await ipcBridge.telemetry.setOptInShown.invoke();

      // Mark renderer ready when user confirms or skips
      await ipcBridge.telemetry.markRendererReady.invoke();
    } catch (error) {
      console.error('[Main] Failed to save opt-in preference:', error);
    }
  }, []);

  if (!hasResolvedInitialStatus) {
    return <AppLoader text='正在获取初始化状态...' />;
  }

  // Wait for useAppMode async initialization to prevent first-frame flash
  // (e.g. new user seeing Router briefly before ModeSetup appears)
  if (!isModeResolved()) {
    return <AppLoader text='正在加载...' />;
  }

  // New user: show ModeSetup (first-time mode selection)
  if (needsSetup) {
    return <ModeSetup />;
  }

  // Show InitLoading until services are ready.
  // No separate AppLoader for "正在准备运行环境" — it caused a flash
  // when isModeResolved() resolved before primeStatusForStartup() set displayMode.
  if (!initReady && !isInitScreenSkipped) {
    return <InitLoading variant={status.displayMode === 'startup' ? 'startup' : 'full'} />;
  }

  return (
    <div className='size-full relative'>
      <Router layout={<Layout />} />
      {!authReady && (
        <div className='fixed inset-0 f-center bg-transparent z-9999 pointer-events-none'>
          <AppLoader />
        </div>
      )}

      {/* Product Improvement Dialog - shown only on first install for non-enterprise users */}
      {!isEnterprise && <OptInDialog isOpen={isOptInDialogOpen} onClose={handleOptInClose} />}
    </div>
  );
};

const AppRoot = () => (
  <ErrorBoundary>
    <Main />
  </ErrorBoundary>
);

export default AppRoot;
