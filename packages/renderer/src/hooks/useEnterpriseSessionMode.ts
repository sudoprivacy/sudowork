/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useCallback, useEffect } from 'react';
import { ConfigStorage } from '@sudowork/common/storage';
import * as ipcBridge from '@sudowork/host-bridge/ipcBridge';
import { addEventListener, emitter } from '@renderer/utils/emitter';
import { getRendererSessionMode, setRendererSessionMode } from '@renderer/pages/guid/hooks/useGuidAgentSelection';

type EnterpriseSessionMode = 'remote' | 'local';

type EnterpriseSessionModeOptions = {
  localModeAvailable?: boolean;
  remoteModeAvailable?: boolean;
};

function resolveAllowedSessionMode(mode: EnterpriseSessionMode, options?: EnterpriseSessionModeOptions): EnterpriseSessionMode {
  const localModeAvailable = options?.localModeAvailable !== false;
  const remoteModeAvailable = options?.remoteModeAvailable !== false;

  if (mode === 'local' && localModeAvailable) return 'local';
  if (mode === 'remote' && remoteModeAvailable) return 'remote';
  if (remoteModeAvailable) return 'remote';
  return 'local';
}

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
export function useEnterpriseSessionMode(options?: EnterpriseSessionModeOptions) {
  const localModeAvailable = options?.localModeAvailable;
  const remoteModeAvailable = options?.remoteModeAvailable;

  const [sessionMode, setSessionModeState] = useState<EnterpriseSessionMode>(() => {
    return resolveAllowedSessionMode(getRendererSessionMode(), { localModeAvailable, remoteModeAvailable });
  });

  const setSessionMode = useCallback(
    async (mode: EnterpriseSessionMode) => {
      const nextMode = resolveAllowedSessionMode(mode, { localModeAvailable, remoteModeAvailable });

      // 1. Save to local storage
      await ConfigStorage.set('guid.sessionMode', nextMode);
      setSessionModeState(nextMode);
      setRendererSessionMode(nextMode);

      // 2. Notify main process
      try {
        await ipcBridge.eeclaw.setSessionMode.invoke({ mode: nextMode });
      } catch (error) {
        console.error('[useEnterpriseSessionMode] Failed to notify main process:', error);
      }

      // 3. Trigger refresh events
      emitter.emit('sessionMode.changed', nextMode);
      emitter.emit('chat.history.refresh');
    },
    [localModeAvailable, remoteModeAvailable]
  );

  useEffect(() => {
    const nextMode = resolveAllowedSessionMode(sessionMode, { localModeAvailable, remoteModeAvailable });
    if (nextMode !== sessionMode) {
      void setSessionMode(nextMode);
    }
  }, [localModeAvailable, remoteModeAvailable, sessionMode, setSessionMode]);

  // Listen for session mode changes from other parts of the app
  useEffect(() => {
    const handleSessionModeChanged = (mode: EnterpriseSessionMode) => {
      const nextMode = resolveAllowedSessionMode(mode, { localModeAvailable, remoteModeAvailable });
      if (nextMode !== mode) {
        void setSessionMode(nextMode);
        return;
      }
      if (nextMode !== sessionMode) {
        setSessionModeState(nextMode);
      }
    };

    return addEventListener('sessionMode.changed', handleSessionModeChanged);
  }, [localModeAvailable, remoteModeAvailable, sessionMode, setSessionMode]);

  return { sessionMode, setSessionMode };
}
