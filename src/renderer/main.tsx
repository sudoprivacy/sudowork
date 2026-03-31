/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import Layout from './layout';
import Router from './router';
import Sider from './sider';
import { useAuth } from './context/AuthContext';
import { useInit } from './context/InitContext';
import InitLoading from './components/InitLoading';

const Main = () => {
  const { ready: authReady } = useAuth();
  const { status, isReady: initReady, hasResolvedInitialStatus } = useInit();

  if (!hasResolvedInitialStatus) {
    return null;
  }

  // Show loading while runtime is initializing
  if (!initReady) {
    const isCoreStartupOnly =
      status.phase === 'installing' &&
      !status.retry &&
      !status.error &&
      (status.message === '正在启动核心服务...' ||
        status.message === '正在校验组件状态...');

    if (isCoreStartupOnly) {
      return <InitLoading variant="startup" />;
    }
    return <InitLoading />;
  }

  if (!authReady) {
    return null;
  }

  return <Router layout={<Layout sider={<Sider />} />} />;
};

export default Main;
