/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useCallback, useEffect } from 'react';
import { ConfigStorage } from '@/common/storage';
import { ipcBridge } from '@/common';
import { addEventListener, emitter } from '@renderer/utils/emitter';
import { getRendererSessionMode, setRendererSessionMode } from '@/renderer/pages/guid/hooks/useGuidAgentSelection';

/**
 * Lightweight enterprise session mode hook
 * 轻量企业模式 session mode hook
 *
 * Responsibilities:
 * - Read guid.sessionMode
 * - Set guid.sessionMode
 * - Notify main process via ipcBridge.eeclaw.setSessionMode
 * - Trigger cron job refetch
 * - Trigger chat.history.refresh
 */
export function useEnterpriseSessionMode() {
  const [sessionMode, setSessionModeState] = useState<'remote' | 'local'>(() => {
    return getRendererSessionMode();
  });

  const setSessionMode = useCallback(async (mode: 'remote' | 'local') => {
    // 1. Save to local storage
    await ConfigStorage.set('guid.sessionMode', mode);
    setSessionModeState(mode);
    setRendererSessionMode(mode);

    // 2. Notify main process
    try {
      await ipcBridge.eeclaw.setSessionMode.invoke({ mode });
    } catch (error) {
      console.error('[useEnterpriseSessionMode] Failed to notify main process:', error);
    }

    // 3. Trigger refresh events
    emitter.emit('sessionMode.changed', mode);
    emitter.emit('chat.history.refresh');
  }, []);

  // Listen for session mode changes from other parts of the app
  useEffect(() => {
    const handleSessionModeChanged = (mode: 'remote' | 'local') => {
      if (mode !== sessionMode) {
        setSessionModeState(mode);
      }
    };

    return addEventListener('sessionMode.changed', handleSessionModeChanged);
  }, [sessionMode]);

  return { sessionMode, setSessionMode };
}
