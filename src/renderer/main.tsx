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
  const { isReady: initReady } = useInit();

  // Show loading while runtime is initializing
  if (!initReady) {
    return <InitLoading />;
  }

  if (!authReady) {
    return null;
  }

  return <Router layout={<Layout sider={<Sider />} />} />;
};

export default Main;
