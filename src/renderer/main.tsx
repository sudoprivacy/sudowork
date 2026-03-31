/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
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
    return null;
  }

  if (!initReady && !isInitScreenSkipped) {
    return <InitLoading variant={status.displayMode === 'startup' ? 'startup' : 'full'} />;
  }

  if (!authReady) {
    return null;
  }

  return <Router layout={<Layout sider={<Sider />} />} />;
};

export default Main;
