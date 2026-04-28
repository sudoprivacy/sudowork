/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import AppLoader from './components/AppLoader';
import InitLoading from './components/InitLoading';
import ProductImprovementDialog from './components/ProductImprovementDialog';
import { useAuth } from './context/AuthContext';
import { useInit } from './context/InitContext';
import { ipcBridge } from '@/common';
import Layout from './layout';
import Router from './router';
import Sider from './sider';

const Main = () => {
  const { ready: authReady } = useAuth();
  const { status, isReady: initReady, hasResolvedInitialStatus, isInitScreenSkipped } = useInit();

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

  if (!initReady && !isInitScreenSkipped) {
    if (status.phase === 'pending' && !status.displayMode) {
      return <AppLoader text='正在准备运行环境...' />;
    }
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

export default Main;
