/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import AppLoader from '@renderer/components/AppLoader';
import InitLoading from '@renderer/components/InitLoading';
import ProductImprovementDialog from '@renderer/components/ProductImprovementDialog';
import ModeSetup from '@renderer/pages/setup/ModeSetup';
import { useAuth } from '@renderer/context/AuthContext';
import { useInit } from '@renderer/context/InitContext';
import { useAppMode, isModeResolved } from '@renderer/hooks/useAppMode';
import Layout from '@renderer/layouts/layout';
import Router from '@renderer/router';
import { ErrorBoundary } from '@renderer/components/ErrorBoundary';
import { ipcBridge } from '@/common';

const Main = () => {
  const { ready: authReady } = useAuth();
  const { status, isReady: initReady, hasResolvedInitialStatus, isInitScreenSkipped } = useInit();
  const { needsSetup, isEnterprise } = useAppMode();

  // Product improvement opt-in dialog state (shown only on first install for new users)
  const [showOptInDialog, setShowOptInDialog] = useState(false);
  const [optInChecked, setOptInChecked] = useState(false);

  // Check if opt-in dialog should be shown when init is ready (only for new users)
  useEffect(() => {
    if (isEnterprise) {
      setShowOptInDialog(false);
      return;
    }

    if (initReady && !optInChecked) {
      ipcBridge.telemetry.getOptInShown
        .invoke()
        .then((result) => {
          if (result.success && !result.data) {
            // Opt-in dialog hasn't been shown yet - this is a new user (first install)
            setShowOptInDialog(true);
          }
          setOptInChecked(true);
        })
        .catch((error) => {
          console.error('[Main] Failed to check opt-in status:', error);
          setOptInChecked(true);
        });
    }
  }, [initReady, isEnterprise, optInChecked]);

  // Handle opt-in dialog close
  const handleOptInClose = useCallback(async (confirmed: boolean) => {
    setShowOptInDialog(false);

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
      {!isEnterprise && <ProductImprovementDialog visible={showOptInDialog} onClose={handleOptInClose} />}
    </div>
  );
};

const AppRoot = () => (
  <ErrorBoundary>
    <Main />
  </ErrorBoundary>
);

export default AppRoot;
