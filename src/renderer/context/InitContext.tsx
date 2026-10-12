/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { init, type InitStatus } from '@/common/ipcBridge';
import { markAppModeBridgeReady } from '@/renderer/hooks/useAppMode';

const STATUS_REQUEST_TIMEOUT_MS = 5000;
const STATUS_RETRY_DELAY_MS = 500;
const MAX_STATUS_REQUEST_ATTEMPTS = 3;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error(`Initialization status request timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise.then(
      (value) => {
        window.clearTimeout(timeoutId);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timeoutId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    );
  });
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, delayMs));
}

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
  const statusRequestGenerationRef = useRef(0);

  const onStatusResolved = useCallback((newStatus: InitStatus) => {
    statusRequestGenerationRef.current += 1;
    markAppModeBridgeReady();
    setStatus(newStatus);
    setHasResolvedInitialStatus(true);
  }, []);

  const refetch = useCallback(async () => {
    const requestGeneration = statusRequestGenerationRef.current + 1;
    statusRequestGenerationRef.current = requestGeneration;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_STATUS_REQUEST_ATTEMPTS; attempt += 1) {
      try {
        const result = await withTimeout(init.getStatus.invoke(), STATUS_REQUEST_TIMEOUT_MS);
        if (statusRequestGenerationRef.current !== requestGeneration) return;

        if (result.success) {
          markAppModeBridgeReady();
          setStatus(result.data);
          setHasResolvedInitialStatus(true);
          return;
        }
        lastError = new Error(result.msg || 'Initialization status request was unsuccessful');
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }

      if (attempt < MAX_STATUS_REQUEST_ATTEMPTS) {
        await wait(STATUS_RETRY_DELAY_MS);
        if (statusRequestGenerationRef.current !== requestGeneration) return;
      }
    }

    if (statusRequestGenerationRef.current === requestGeneration) {
      console.error('[InitContext] Failed to fetch status after retries:', lastError);
    }
  }, []);

  useEffect(() => {
    // For Web environment, we don't need to poll or subscribe to backend init status
    // because the backend is already running on the server.
    if (!isElectron) {
      markAppModeBridgeReady();
      return;
    }

    // Fetch initial status
    void refetch();

    // Subscribe to status changes
    const unsubscribe = init.onStatusChange.on((newStatus: InitStatus) => {
      onStatusResolved(newStatus);
    });

    return () => {
      statusRequestGenerationRef.current += 1;
      unsubscribe();
    };
  }, [isElectron, onStatusResolved, refetch]);

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
