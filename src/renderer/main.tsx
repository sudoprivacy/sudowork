/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import AppLoader from './components/AppLoader';
import InitLoading from './components/InitLoading';
import { useAuth } from './context/AuthContext';
import { useInit } from './context/InitContext';
import Layout from './layout';
import Router from './router';
import Sider from './sider';

const Main = () => {
  const { ready: authReady } = useAuth();
  const { status, isReady: initReady, hasResolvedInitialStatus, isInitScreenSkipped } = useInit();

  if (!hasResolvedInitialStatus) {
    return <AppLoader text='正在获取初始化状态...' />;
  }

  if (!initReady && !isInitScreenSkipped) {
    if (status.phase === 'pending' && !status.displayMode) {
      return <AppLoader text='正在准备运行环境...' />;
    }
    return <InitLoading variant={status.displayMode === 'startup' ? 'startup' : 'full'} />;
  }

  if (!authReady) {
    return <AppLoader text='正在准备登录状态...' />;
  }

  return <Router layout={<Layout sider={<Sider />} />} />;
};

export default Main;
