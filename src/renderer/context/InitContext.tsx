/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { init, type InitStatus } from '@/common/ipcBridge';

interface InitContextValue {
  status: InitStatus;
  isReady: boolean;
  hasResolvedInitialStatus: boolean;
  isInitScreenSkipped: boolean;
  skipInitScreen: () => void;
  refetch: () => Promise<void>;
}

const InitContext = createContext<InitContextValue | undefined>(undefined);

export const InitProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  // Check if running in Electron environment
  // In Electron, navigator.userAgent typically contains "Electron"
  const hasElectronApi = typeof window !== 'undefined' && 'electronAPI' in window;
  const isElectron = typeof window !== 'undefined' && (hasElectronApi || /Electron/i.test(navigator.userAgent));

  const [status, setStatus] = useState<InitStatus>(isElectron ? { phase: 'pending', message: '准备初始化...', progress: 0 } : { phase: 'ready', message: '初始化完成', progress: 100 });
  const [hasResolvedInitialStatus, setHasResolvedInitialStatus] = useState(!isElectron);
  const [isInitScreenSkipped, setIsInitScreenSkipped] = useState(false);

  const refetch = useCallback(async () => {
    let retries = 0;
    const maxRetries = 10;
    const baseDelay = 500;

    const attempt = async () => {
      try {
        const result = await init.getStatus.invoke();
        if (result.success) {
          setStatus(result.data);
          setHasResolvedInitialStatus(true);
          return true;
        }
      } catch (err) {
        if (retries < maxRetries) {
          const delay = baseDelay * Math.pow(1.2, retries);
          retries++;
          // console.warn(`[InitContext] Bridge not ready, retrying in ${Math.round(delay)}ms... (${retries}/${maxRetries})`);
          setTimeout(() => {
            void attempt();
          }, delay);
          return false;
        }
        console.error('[InitContext] Failed to fetch status after retries:', err);
      }
      return false;
    };

    void attempt();
  }, []);

  useEffect(() => {
    // For Web environment, we don't need to poll or subscribe to backend init status
    // because the backend is already running on the server.
    if (!isElectron) return;

    // Fetch initial status
    void refetch();

    // Subscribe to status changes
    const unsubscribe = init.onStatusChange.on((newStatus: InitStatus) => {
      setStatus(newStatus);
      setHasResolvedInitialStatus(true);
    });

    return unsubscribe;
  }, [refetch, isElectron]);

  useEffect(() => {
    if (status.phase === 'ready' && isInitScreenSkipped) {
      setIsInitScreenSkipped(false);
    }
  }, [isInitScreenSkipped, status.phase]);

  const isReady = status.phase === 'ready';
  const skipInitScreen = useCallback(() => {
    setIsInitScreenSkipped(true);
  }, []);

  return <InitContext.Provider value={{ status, isReady, hasResolvedInitialStatus, isInitScreenSkipped, skipInitScreen, refetch }}>{children}</InitContext.Provider>;
};

export function useInit(): InitContextValue {
  const context = useContext(InitContext);
  if (!context) {
    throw new Error('useInit must be used within an InitProvider');
  }
  return context;
}
