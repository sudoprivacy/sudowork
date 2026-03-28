/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Safety Polling Service
 *
 * Polls /safe/event/{uuid} directory at regular intervals
 * and notifies renderer process when new event files are detected.
 * Also manages safety hook enabled state and syncs it via Nexus filesystem.
 */

import type { SafetyStatus } from '@/common/safetyTypes';
import { ipcBridge } from '@/common';
import { SafetyFileService } from './SafetyFileService';
import { eventToSafetyStatus, listEventFilenames, readEventFile, writeEnabledState } from './SecurityHookFile';
import { initBlacklist } from './SafetyBlacklistService';
import { ProcessConfig } from '@/process/initStorage';

/** Storage key for safety hook enabled state */
const SAFETY_HOOK_ENABLED_KEY = 'safetyHook.enabled';

/** Path in Nexus filesystem for enabled state sync */
const SAFETY_HOOK_ENABLED_PATH = '/safe/config/enabled';

export interface SafetyPollingConfig {
  pollingIntervalMs: number;
}

/** Global flag for safety hook enabled state (used by workers) */
let globalSafetyHookEnabled: boolean = true;

/** Listeners for enabled state changes */
const enabledChangeListeners: Set<(enabled: boolean) => void> = new Set();

/**
 * Check if safety hook is enabled globally.
 * Called by ForkTask to determine worker environment variable.
 */
export function isSafetyHookEnabled(): boolean {
  return globalSafetyHookEnabled;
}

/**
 * Set safety hook enabled state globally.
 * Called by SafetyPollingService when user toggles the switch.
 */
export function setSafetyHookEnabled(enabled: boolean): void {
  const previousValue = globalSafetyHookEnabled;
  globalSafetyHookEnabled = enabled;
  if (previousValue !== enabled) {
    // Notify all listeners
    enabledChangeListeners.forEach((listener) => {
      try {
        listener(enabled);
      } catch (error) {
        console.error('[SafetyPolling] Error in enabled change listener:', error);
      }
    });
  }
}

/**
 * Subscribe to enabled state changes.
 * Returns an unsubscribe function.
 */
export function onEnabledChange(listener: (enabled: boolean) => void): () => void {
  enabledChangeListeners.add(listener);
  return () => {
    enabledChangeListeners.delete(listener);
  };
}

export class SafetyPollingService {
  private static instance: SafetyPollingService;

  private interval: NodeJS.Timeout | null = null;
  private config: SafetyPollingConfig | null = null;
  private currentStatus: SafetyStatus = { level: 'none' };
  private eventListeners: Set<(status: SafetyStatus) => void> = new Set();
  private currentEventUuid: string | null = null;
  private currentEventFilename: string | null = null;
  private enabled: boolean = true; // Track whether service is enabled
  private initialized: boolean = false;

  private constructor() {}

  static getInstance(): SafetyPollingService {
    if (!SafetyPollingService.instance) {
      SafetyPollingService.instance = new SafetyPollingService();
    }
    return SafetyPollingService.instance;
  }

  /**
   * Initialize safety hook state from persistent storage
   * Called once at app startup
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const storedEnabled = await ProcessConfig.get(SAFETY_HOOK_ENABLED_KEY);
      this.enabled = storedEnabled !== false; // default to true if not set
      setSafetyHookEnabled(this.enabled); // Use setter to notify listeners
      // Sync to Nexus filesystem for Agent CLI processes
      await writeEnabledState(this.enabled);
      console.log(`[SafetyPolling] Initialized with enabled=${this.enabled}`);
    } catch (err) {
      console.warn('[SafetyPolling] Failed to load enabled state:', err);
      this.enabled = true;
      setSafetyHookEnabled(true);
      await writeEnabledState(true);
    }

    // Initialize blacklist and sync to Nexus
    try {
      await initBlacklist();
    } catch (err) {
      console.warn('[SafetyPolling] Failed to init blacklist:', err);
    }

    this.initialized = true;
  }

  /**
   * Persist enabled state to storage and sync to Nexus filesystem
   */
  private async persistEnabledState(enabled: boolean): Promise<void> {
    try {
      await ProcessConfig.set(SAFETY_HOOK_ENABLED_KEY, enabled);
      // Sync to Nexus filesystem for Agent CLI processes
      await writeEnabledState(enabled);
    } catch (err) {
      console.warn('[SafetyPolling] Failed to persist enabled state:', err);
    }
  }

  /**
   * Start polling safety service
   */
  async start(config: SafetyPollingConfig): Promise<void> {
    // Initialize from storage if not already done
    if (!this.initialized) {
      await this.initialize();
    }

    if (this.interval) {
      this.config = config;
      this.enabled = true;
      setSafetyHookEnabled(true);
      return;
    }

    this.config = config;
    this.enabled = true;
    setSafetyHookEnabled(true);
    await this.persistEnabledState(true);

    // Initialize file service (async for Nexus SDK)
    try {
      await SafetyFileService.init({
        pollingIntervalMs: config.pollingIntervalMs,
      });
    } catch (err) {
      console.error(`[SafetyPolling] Failed to init SafetyFileService:`, err);
      throw err;
    }

    this.interval = setInterval(() => {
      void this.poll();
    }, config.pollingIntervalMs);

    console.log(`[SafetyPolling] Polling started with ${config.pollingIntervalMs}ms interval`);

    // Initial poll
    void this.poll();
  }

  /**
   * Check if service is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Stop polling
   */
  async stop(): Promise<void> {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.enabled = false;
    setSafetyHookEnabled(false);
    await this.persistEnabledState(false);
    // Clear current event status when stopping
    this.currentStatus = { level: 'none' };
    this.currentEventUuid = null;
    this.currentEventFilename = null;
    this.notifyListeners(this.currentStatus);
  }

  /**
   * Get current safety status
   */
  getStatus(): SafetyStatus {
    return this.currentStatus;
  }

  /**
   * Get current event UUID
   */
  getCurrentEventUuid(): string | null {
    return this.currentEventUuid;
  }

  /**
   * Check if there's an active event (not 'none')
   */
  hasEvent(): boolean {
    return this.currentStatus.level !== 'none';
  }

  /**
   * Handle user confirmation
   */
  async handleUserConfirmation(allow: boolean, reason?: string): Promise<boolean> {
    if (!this.currentEventUuid) {
      console.warn('[SafetyPolling] No event to confirm');
      return false;
    }

    const eventUuid = this.currentEventUuid;
    const filename = this.currentEventFilename;

    // Write action to /safe/action/{uuid}
    const success = await SafetyFileService.writeUserResponse(eventUuid, allow, reason);

    if (success) {
      // Clear current status and event UUID
      this.currentStatus = { level: 'none' };
      this.currentEventUuid = null;
      this.currentEventFilename = null;
      this.notifyListeners(this.currentStatus);
    }

    return success;
  }

  /**
   * Subscribe to status changes
   */
  onStatusChange(listener: (status: SafetyStatus) => void): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  /**
   * Notify all listeners of status change
   */
  private notifyListeners(status: SafetyStatus): void {
    this.eventListeners.forEach((listener) => {
      try {
        listener(status);
      } catch (error) {
        console.error('[SafetyPolling] Error in listener:', error);
      }
    });

    // Emit IPC event to renderer directly via bridge
    try {
      ipcBridge.safety.onStatusChange.emit(status);
    } catch (err) {
      console.error('[SafetyPolling] IPC emit failed:', err);
    }
  }

  /**
   * Poll event directory and update status
   */
  private async poll(): Promise<void> {
    if (!this.config) {
      return;
    }

    try {
      const filenames = await listEventFilenames();
      console.log(`[SafetyPolling] Poll found ${filenames.length} events`);

      const processedSet = SafetyFileService['processedEvents'];

      // Sync memory Set with actual directory content
      const currentFilesSet = new Set(filenames);
      for (const processedFile of processedSet) {
        if (!currentFilesSet.has(processedFile)) {
          processedSet.delete(processedFile);
        }
      }

      // Find first unprocessed event
      for (const filename of filenames) {
        if (!processedSet.has(filename)) {
          console.log(`[SafetyPolling] Found unprocessed event: ${filename}`);
          const data = await readEventFile(filename);
          console.log(`[SafetyPolling] Event data:`, data ? JSON.stringify(data).substring(0, 200) : 'null');

          if (data) {
            this.currentStatus = eventToSafetyStatus(filename, data);
            this.currentEventUuid = filename;
            this.currentEventFilename = filename;

            processedSet.add(filename);
            console.log(`[SafetyPolling] Notifying listeners with status:`, JSON.stringify(this.currentStatus).substring(0, 200));
            this.notifyListeners(this.currentStatus);
            break;
          } else {
            // If read failed, mark as processed to ignore it in next polls
            console.log(`[SafetyPolling] Event data is null, marking as processed`);
            processedSet.add(filename);
          }
        }
      }
    } catch (error) {
      console.error('[SafetyPolling] Poll error:', error);
    }
  }
}
