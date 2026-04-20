/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import AppLoader from './components/AppLoader';
import { useAuth } from './context/AuthContext';
import Layout from './layout';
import Router from './router';
import Sider from './sider';

/**
 * Main — App entry component.
 *
 * Runtime initialization (CLI downloads) runs silently in the background.
 * Users see the login/register page immediately without waiting.
 * When the user authenticates and tries to enter the main app, the router's
 * ProtectedLayout checks init status and shows a blocking modal if runtimes
 * are not yet ready.
 */
const Main = () => {
  const { ready: authReady } = useAuth();

  if (!authReady) {
    return <AppLoader text='正在准备登录状态...' />;
  }

  return <Router layout={<Layout sider={<Sider />} />} />;
};

export default Main;
