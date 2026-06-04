/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import { ipcBridge } from '@/common';
import { getCachedAppMode, refreshEnterpriseCache, setCachedAppMode } from '@/common/enterpriseDebugConfig';
import initStorage, { ProcessConfig, reinitFileHandles } from '@process/initStorage';
import { closeDatabase } from '@process/database';
import { resetConversationProvider } from '@process/providers';
import { resetMainLoggerPath, mainLog, mainWarn, mainError } from '@process/utils/mainLogger';
import { cronService } from '@process/services/cron/CronService';
import { ensureDataRootInitialized, persistDataRootMode, readPersistedDataRootMode, type AppMode } from '@process/dataRoot';
import { startAllRuntimes, stopAllRuntimes } from './subprocessLifecycle';

const RENDERER_ACK_TIMEOUT_MS = 10_000;

type AckWaiter = {
  resolve: () => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

let initialized = false;
let switchPromise: Promise<void> | null = null;
const ackWaiters = new Map<string, AckWaiter>();

const createSwitchId = (): string => {
  return randomUUID();
};

const getStoredAppMode = (): AppMode | null => {
  const stored = ProcessConfig.getSync('system.appMode');
  return stored === 'c' || stored === 'e' ? stored : null;
};

const getCurrentAppMode = (): AppMode => {
  return getCachedAppMode() ?? getStoredAppMode() ?? readPersistedDataRootMode() ?? 'c';
};

const getErrorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error);
};

function waitForRendererLocalStorageAck(switchId: string): Promise<void> {
  if (BrowserWindow.getAllWindows().length === 0) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      ackWaiters.delete(switchId);
      reject(new Error('Renderer did not acknowledge localStorage cleanup before mode switch'));
    }, RENDERER_ACK_TIMEOUT_MS);

    ackWaiters.set(switchId, {
      resolve: () => {
        clearTimeout(timeout);
        resolve();
      },
      reject,
      timeout,
    });
  });
}

function resolveRendererLocalStorageAck(switchId: string): void {
  const waiter = ackWaiters.get(switchId);
  if (!waiter) {
    mainWarn('ModeSwitch', `Received localStorage ack for unknown switch: ${switchId}`);
    return;
  }

  ackWaiters.delete(switchId);
  waiter.resolve();
}

async function persistModeForActiveRoot(mode: AppMode): Promise<void> {
  await ProcessConfig.set('system.appMode', mode);
}

async function activateRoot(mode: AppMode): Promise<void> {
  ensureDataRootInitialized(mode);
  setCachedAppMode(mode);
  persistDataRootMode(mode);
  resetMainLoggerPath();
  resetConversationProvider();
  reinitFileHandles();
  await initStorage();
  await persistModeForActiveRoot(mode);
  await refreshEnterpriseCache();
}

async function restartForMode(mode: AppMode): Promise<void> {
  closeDatabase();
  await activateRoot(mode);
  await startAllRuntimes();
  await cronService.reloadAll();
}

async function rollbackMode(previousMode: AppMode): Promise<void> {
  mainWarn('ModeSwitch', `Rolling back to app mode: ${previousMode}`);
  await cronService.stopAll().catch((error) => {
    mainWarn('ModeSwitch', 'Cron stop failed during rollback:', error);
  });
  await stopAllRuntimes().catch((error) => {
    mainWarn('ModeSwitch', 'Runtime stop failed during rollback:', error);
  });
  await restartForMode(previousMode);
}

async function runModeSwitch(newMode: AppMode): Promise<void> {
  const previousMode = getCurrentAppMode();
  const switchId = createSwitchId();
  let shouldRollback = false;

  mainLog('ModeSwitch', `Starting app mode switch: ${previousMode} -> ${newMode}`, { switchId });

  try {
    ensureDataRootInitialized(newMode);

    const ackPromise = waitForRendererLocalStorageAck(switchId);
    ipcBridge.application.modeSwitchStart.emit({ switchId, mode: newMode });
    await ackPromise;

    shouldRollback = true;
    await cronService.stopAll();
    await stopAllRuntimes();
    closeDatabase();

    await activateRoot(newMode);

    await startAllRuntimes();
    await cronService.reloadAll();

    ipcBridge.application.modeSwitchDone.emit({ switchId, mode: newMode });
    mainLog('ModeSwitch', `App mode switch completed: ${newMode}`, { switchId });
  } catch (error) {
    const message = getErrorMessage(error);
    mainError('ModeSwitch', `App mode switch failed: ${message}`, { switchId, mode: newMode });

    if (!shouldRollback) {
      ipcBridge.application.modeSwitchFailed.emit({ switchId, mode: previousMode, error: message });
      throw error;
    }

    try {
      await rollbackMode(previousMode);
      ipcBridge.application.modeSwitchFailed.emit({ switchId, mode: previousMode, error: message });
    } catch (rollbackError) {
      const rollbackMessage = getErrorMessage(rollbackError);
      mainError('ModeSwitch', `Mode switch rollback failed: ${rollbackMessage}`, { switchId, mode: previousMode });
      ipcBridge.application.modeSwitchFatal.emit({ switchId, mode: previousMode, error: rollbackMessage });
    }

    throw error;
  } finally {
    const waiter = ackWaiters.get(switchId);
    if (waiter) {
      clearTimeout(waiter.timeout);
      waiter.reject(new Error('Mode switch ended before renderer localStorage ack'));
      ackWaiters.delete(switchId);
    }
  }
}

export function initModeSwitchOrchestratorIpc(): void {
  if (initialized) {
    return;
  }

  ipcBridge.application.modeSwitchLocalStorageCleared.provider(async ({ switchId }) => {
    resolveRendererLocalStorageAck(switchId);
  });

  initialized = true;
}

export async function switchAppMode(newMode: AppMode): Promise<void> {
  if (switchPromise) {
    throw new Error('App mode switch already in progress');
  }

  switchPromise = runModeSwitch(newMode);
  try {
    await switchPromise;
  } finally {
    switchPromise = null;
  }
}
