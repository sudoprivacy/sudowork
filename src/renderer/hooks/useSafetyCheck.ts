/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { SafetyStatus } from '@/common/safetyTypes';
import { useEffect, useState, useCallback } from 'react';

export interface UseSafetyCheckReturn {
  /** Current safety status */
  status: SafetyStatus;
  /** Whether there's an active event (level !== 'none') */
  hasEvent: boolean;
  /** Whether hook is loading initial status */
  isLoading: boolean;
  /** Whether an error occurred */
  error: string | null;
  /** Confirm the event and allow to continue */
  confirm: () => Promise<void>;
  /** Cancel the confirmation (deny) */
  cancel: () => Promise<void>;
}

/**
 * Hook for safety check functionality.
 * Polls main process for safety status and provides confirmation actions.
 */
export function useSafetyCheck(): UseSafetyCheckReturn {
  const [status, setStatus] = useState<SafetyStatus>({ level: 'none' });
  const [hasEvent, setHasEvent] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load initial status
  useEffect(() => {
    let mounted = true;

    const loadStatus = async () => {
      try {
        const result = await ipcBridge.safety.getStatus.invoke();
        if (mounted) {
          if (result.success) {
            setStatus(result.data);
            setHasEvent(result.data?.level !== 'none');
          } else {
            setError(result.msg || 'Failed to load safety status');
          }
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to load safety status');
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    void loadStatus();

    return () => {
      mounted = true;
    };
  }, []);

  // Listen for status changes from main process
  useEffect(() => {
    const unsubscribe = ipcBridge.safety.onStatusChange.on((newStatus) => {
      console.log('[useSafetyCheck] Received status change from main process:', newStatus.level);
      setStatus(newStatus);
      setHasEvent(newStatus.level !== 'none');
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // Confirm action - allow the operation
  const confirm = useCallback(async () => {
    try {
      await ipcBridge.safety.confirm.invoke({
        allow: true,
      });
      // Clear the event status locally after confirmation
      setStatus({ level: 'none' });
      setHasEvent(false);
    } catch (err) {
      console.error('[useSafetyCheck] Confirm failed:', err);
      throw err;
    }
  }, []);

  // Cancel action - user denies the operation
  const cancel = useCallback(async () => {
    try {
      // Write deny response to /safe/action/{uuid}
      await ipcBridge.safety.confirm.invoke({
        allow: false,
        reason: 'User denied the operation',
      });
      // Clear the event status locally after denial
      setStatus({ level: 'none' });
      setHasEvent(false);
    } catch (err) {
      console.error('[useSafetyCheck] Cancel (deny) failed:', err);
    }
  }, []);

  return {
    status,
    hasEvent,
    isLoading,
    error,
    confirm,
    cancel,
  };
}
