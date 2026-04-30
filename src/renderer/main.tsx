/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import AppLoader from './components/AppLoader';
import InitLoading from './components/InitLoading';
import ProductImprovementDialog from './components/ProductImprovementDialog';
import ModeSetup from './pages/setup/ModeSetup';
import { useAuth } from './context/AuthContext';
import { useInit } from './context/InitContext';
import { useAppMode, isModeResolved } from './hooks/useAppMode';
import { ipcBridge } from '@/common';
import Layout from './layout';
import Router from './router';
import Sider from './sider';
import { ErrorBoundary } from './components/ErrorBoundary';

const Main = () => {
  const { ready: authReady } = useAuth();
  const { status, isReady: initReady, hasResolvedInitialStatus, isInitScreenSkipped } = useInit();
  const { needsSetup, isEnterprise } = useAppMode();

  // Product improvement opt-in dialog state (shown only on first install for new users)
  const [showOptInDialog, setShowOptInDialog] = useState(false);
  const [optInChecked, setOptInChecked] = useState(false);

  // Check if opt-in dialog should be shown when init is ready (only for new users)
  useEffect(() => {
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
  }, [initReady, optInChecked]);

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

  // Enterprise mode: skip InitLoading (no local services to wait for)
  if (isEnterprise) {
    return (
      <div className='size-full relative'>
        <Router layout={<Layout sider={<Sider />} />} />
        {!authReady && (
          <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', zIndex: 9999, pointerEvents: 'none' }}>
            <AppLoader />
          </div>
        )}
      </div>
    );
  }

  // Consumer mode: show InitLoading until services are ready.
  // No separate AppLoader for "正在准备运行环境" — it caused a flash
  // when isModeResolved() resolved before primeStatusForStartup() set displayMode.
  if (!initReady && !isInitScreenSkipped) {
    return <InitLoading variant={status.displayMode === 'startup' ? 'startup' : 'full'} />;
  }

  return (
    <div className='size-full relative'>
      <Router layout={<Layout sider={<Sider />} />} />
      {!authReady && (
        <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', zIndex: 9999, pointerEvents: 'none' }}>
          <AppLoader />
        </div>
      )}

      {/* Product Improvement Dialog - shown only on first install for new users */}
      <ProductImprovementDialog visible={showOptInDialog} onClose={handleOptInClose} />
    </div>
  );
};

const AppRoot = () => (
  <ErrorBoundary>
    <Main />
  </ErrorBoundary>
);

export default AppRoot;
