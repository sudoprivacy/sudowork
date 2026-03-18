/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { useCallback, useEffect, useRef, useState } from 'react';

interface UseLibreOfficeAvailabilityReturn {
  /** LibreOffice 是否可用 / Whether LibreOffice is available */
  isAvailable: boolean | null;
  /** 是否正在加载 / Whether loading */
  isLoading: boolean;
  /** 手动触发检测 / Manually trigger check */
  check: () => Promise<void>;
  /** 错误信息 / Error message */
  error: string | null;
}

/**
 * Hook to check LibreOffice availability
 * Caches the result to avoid repeated IPC calls
 *
 * @returns LibreOffice availability status and check function
 */
export function useLibreOfficeAvailability(): UseLibreOfficeAvailabilityReturn {
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Use ref to cache the result across component re-renders
  // Also cache across multiple hook instances via module-level cache
  const isAvailableRef = useRef<boolean | null>(null);

  const check = useCallback(async () => {
    // If already checked in this session, return cached value
    if (isAvailableRef.current !== null) {
      setIsAvailable(isAvailableRef.current);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await ipcBridge.document.libreOffice.isAvailable.invoke();
      isAvailableRef.current = result;
      setIsAvailable(result);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to check LibreOffice availability';
      setError(errorMessage);
      setIsAvailable(false);
      isAvailableRef.current = false;
      console.error('[useLibreOfficeAvailability] Failed to check LibreOffice:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Auto-check on mount
  useEffect(() => {
    void check();
  }, [check]);

  return {
    isAvailable,
    isLoading,
    check,
    error,
  };
}
