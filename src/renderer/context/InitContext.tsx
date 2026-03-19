/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { init, type InitStatus } from '@/common/ipcBridge';

interface InitContextValue {
  status: InitStatus;
  isReady: boolean;
  refetch: () => Promise<void>;
}

const InitContext = createContext<InitContextValue | undefined>(undefined);

export const InitProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [status, setStatus] = useState<InitStatus>({ phase: 'pending', message: '准备初始化...' });

  const refetch = useCallback(async () => {
    try {
      const result = await init.getStatus.invoke();
      if (result.success) {
        setStatus(result.data);
      }
    } catch (err) {
      console.error('[InitContext] Failed to fetch status:', err);
    }
  }, []);

  useEffect(() => {
    // Fetch initial status
    void refetch();

    // Subscribe to status changes
    const unsubscribe = init.onStatusChange.on((newStatus: InitStatus) => {
      setStatus(newStatus);
    });

    return unsubscribe;
  }, [refetch]);

  const isReady = status.phase === 'ready';

  return <InitContext.Provider value={{ status, isReady, refetch }}>{children}</InitContext.Provider>;
};

export function useInit(): InitContextValue {
  const context = useContext(InitContext);
  if (!context) {
    throw new Error('useInit must be used within an InitProvider');
  }
  return context;
}
