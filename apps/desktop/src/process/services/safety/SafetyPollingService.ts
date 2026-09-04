/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Safety Polling Service
 *
 * Manages safety hook state and polls for events.
 * Nexus is the SINGLE SOURCE OF TRUTH for all state.
 *
 * State file: /safe/config/enabled
 * Event files: /safe/event/{uuid}
 * Action files: /safe/action/{uuid}
 */

import type { ISafetyStatus } from '@common/types/security';
import { ipcBridge } from '@/common';
import { mainLog, mainWarn, mainError } from '@process/utils/mainLogger';
import { writeEnabledState, ensureEnabledState, ensureSecurityHookDirs, listEventFilenames, readEventFile, writeActionFile, deleteEventFile, actionExists, readHookConfig, eventToSafetyStatus } from './SecurityHookFile';
import { initBlacklist } from './SafetyBlacklistService';

export interface SafetyPollingConfig {
  pollingIntervalMs: number;
}

/**
 * Check if safety hook is enabled globally.
 * This is a convenience function that reads from the singleton instance.
 */
export function isSafetyHookEnabled(): boolean {
  return SafetyPollingService.getInstance().isEnabled();
}

export class SafetyPollingService {
  private static instance: SafetyPollingService;

  private interval: NodeJS.Timeout | null = null;
  private config: SafetyPollingConfig | null = null;
  private currentStatus: ISafetyStatus = { level: 'none' };
  private eventListeners: Set<(status: ISafetyStatus) => void> = new Set();
  private currentEventUuid: string | null = null;
  private currentEventFilename: string | null = null;
  private enabled: boolean = true;
  private initialized: boolean = false;

  /** Cached blacklist config for efficiency */
  private cachedBlacklistEnabled: boolean | null = null;

  /** Set of processed event filenames (to avoid re-processing) */
  private processedEvents: Set<string> = new Set();

  private constructor() {}

  static getInstance(): SafetyPollingService {
    if (!SafetyPollingService.instance) {
      SafetyPollingService.instance = new SafetyPollingService();
    }
    return SafetyPollingService.instance;
  }

  /**
   * Initialize safety hook state from Nexus
   * Called once at app startup
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const state = await ensureEnabledState();
      this.enabled = state.enabled;
      mainLog('SafetyPolling', `Initialized from Nexus: enabled=${state.enabled}, fastPass=${state.fastPass}`);
    } catch (err) {
      mainWarn('SafetyPolling', 'Failed to initialize from Nexus, using default:', err);
      this.enabled = true;
    }

    // Initialize blacklist
    try {
      await initBlacklist();
    } catch (err) {
      mainWarn('SafetyPolling', 'Failed to init blacklist:', err);
    }

    this.initialized = true;
  }

  /**
   * Persist enabled state to Nexus
   */
  private async persistEnabledState(enabled: boolean, fastPass: boolean = false): Promise<void> {
    try {
      await writeEnabledState(enabled, fastPass);
      mainLog('SafetyPolling', `Persisted state: enabled=${enabled}, fastPass=${fastPass}`);
    } catch (err) {
      mainError('SafetyPolling', 'Failed to persist state:', err);
    }
  }

  /**
   * Start polling safety service
   * @param persist - true: 用户手动开启，写入 Nexus; false: 应用启动，只读取状态
   */
  async start(config: SafetyPollingConfig, persist: boolean = false): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    // 应用启动时，如果 Nexus 中已禁用则跳过
    if (!persist && !this.enabled) {
      mainLog('SafetyPolling', 'Service disabled in Nexus, skipping startup');
      return;
    }

    if (this.interval) {
      this.config = config;
      return;
    }

    this.config = config;

    // 用户手动开启时，更新状态并写入 Nexus
    if (persist) {
      this.enabled = true;
      await this.persistEnabledState(true, false);
    }

    await this.startPolling(config);
  }

  /**
   * Start the polling loop
   */
  private async startPolling(config: SafetyPollingConfig): Promise<void> {
    // Ensure directories exist
    await ensureSecurityHookDirs();

    // Mark existing events as processed (skip stale events from previous sessions)
    await this.markExistingEventsAsProcessed();

    this.interval = setInterval(() => {
      void this.poll();
    }, config.pollingIntervalMs);

    mainLog('SafetyPolling', 'Polling started, interval:', config.pollingIntervalMs);

    void this.poll();
  }

  /**
   * Mark all existing events as processed to avoid re-processing stale events
   */
  private async markExistingEventsAsProcessed(): Promise<void> {
    try {
      const filenames = await listEventFilenames();
      for (const filename of filenames) {
        this.processedEvents.add(filename);
      }
      if (filenames.length > 0) {
        mainLog('SafetyPolling', `Marked ${filenames.length} existing events as processed`);
      }
    } catch (error) {
      mainWarn('SafetyPolling', 'Failed to mark existing events:', error);
    }
  }

  /**
   * Check if service is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Stop polling and disable safety hook
   * @param persist - Whether to persist the disabled state (default: true)
   */
  async stop(persist: boolean = true): Promise<void> {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.enabled = false;

    if (persist) {
      // Write fastPass=true to immediately allow all requests
      await this.persistEnabledState(false, true);
    }

    // Clear state
    this.currentStatus = { level: 'none' };
    this.currentEventUuid = null;
    this.currentEventFilename = null;
    this.notifyListeners(this.currentStatus);
    this.processedEvents.clear();
    this.cachedBlacklistEnabled = null;

    // Cleanup pending events
    this.cleanupPendingEvents().catch((err) => {
      mainWarn('SafetyPolling', 'Failed to cleanup pending events:', err);
    });
  }

  /**
   * Cleanup pending events when hook is disabled
   */
  private async cleanupPendingEvents(): Promise<void> {
    try {
      const filenames = await listEventFilenames();
      if (filenames.length === 0) {
        return;
      }

      mainLog('SafetyPolling', `Cleaning up ${filenames.length} pending events`);

      for (const filename of filenames) {
        const hasAction = await actionExists(filename);
        if (!hasAction) {
          await writeActionFile(filename, { allow: true, reason: 'Safety hook disabled' });
        }
        await deleteEventFile(filename);
      }

      mainLog('SafetyPolling', `Cleaned up ${filenames.length} pending events`);
    } catch (err) {
      mainWarn('SafetyPolling', 'Cleanup pending events failed:', err);
    }
  }

  /**
   * Get current safety status
   */
  getStatus(): ISafetyStatus {
    return this.currentStatus;
  }

  /**
   * Get current event UUID
   */
  getCurrentEventUuid(): string | null {
    return this.currentEventUuid;
  }

  /**
   * Check if there's an active event
   */
  hasEvent(): boolean {
    return this.currentStatus.level !== 'none';
  }

  /**
   * Handle user confirmation
   */
  async handleUserConfirmation(allow: boolean, reason?: string): Promise<boolean> {
    if (!this.currentEventUuid) {
      mainWarn('SafetyPolling', 'No event to confirm');
      return false;
    }

    const eventUuid = this.currentEventUuid;
    const success = await this.writeUserResponse(eventUuid, allow, reason);

    if (success) {
      this.currentStatus = { level: 'none' };
      this.currentEventUuid = null;
      this.currentEventFilename = null;
      this.notifyListeners(this.currentStatus);
    }

    return success;
  }

  /**
   * Write user response to action file and delete event
   */
  private async writeUserResponse(eventUuid: string, allow: boolean, reason?: string): Promise<boolean> {
    const success = await writeActionFile(eventUuid, { allow, reason });
    if (success) {
      await deleteEventFile(eventUuid);
      this.processedEvents.delete(eventUuid);
    }
    return success;
  }

  /**
   * Subscribe to status changes
   */
  onStatusChange(listener: (status: ISafetyStatus) => void): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  /**
   * Notify all listeners of status change
   */
  private notifyListeners(status: ISafetyStatus): void {
    this.eventListeners.forEach((listener) => {
      try {
        listener(status);
      } catch (error) {
        mainError('SafetyPolling', 'Error in listener:', error);
      }
    });

    try {
      ipcBridge.safety.onStatusChange.emit(status);
    } catch (err) {
      mainError('SafetyPolling', 'IPC emit failed:', err);
    }
  }

  /**
   * Check if blacklist has active rules (with caching)
   */
  private async hasActiveBlacklistRules(): Promise<boolean> {
    // Return cached value if available
    if (this.cachedBlacklistEnabled !== null) {
      return this.cachedBlacklistEnabled;
    }

    try {
      const hookConfig = await readHookConfig();
      if (!hookConfig || !hookConfig.blacklist) {
        this.cachedBlacklistEnabled = false;
        return false;
      }
      const blacklist = hookConfig.blacklist as { rules?: { enabled?: boolean }[] };
      const hasActive = blacklist?.rules?.some((rule: { enabled?: boolean }) => rule.enabled) ?? false;
      this.cachedBlacklistEnabled = hasActive;
      return hasActive;
    } catch {
      this.cachedBlacklistEnabled = false;
      return false;
    }
  }

  /**
   * Invalidate blacklist cache (call when blacklist is updated)
   */
  invalidateBlacklistCache(): void {
    this.cachedBlacklistEnabled = null;
  }

  /**
   * Poll event directory and update status
   */
  private async poll(): Promise<void> {
    if (!this.config || !this.enabled) {
      return;
    }

    const hasActiveRules = await this.hasActiveBlacklistRules();
    if (!hasActiveRules) {
      return;
    }

    try {
      const filenames = await listEventFilenames();

      // Clean up processed set for deleted files
      const currentFilesSet = new Set(filenames);
      for (const processedFile of this.processedEvents) {
        if (!currentFilesSet.has(processedFile)) {
          this.processedEvents.delete(processedFile);
        }
      }

      // Find first unprocessed event
      for (const filename of filenames) {
        if (!this.processedEvents.has(filename)) {
          const data = await readEventFile(filename);

          if (data) {
            this.currentStatus = eventToSafetyStatus(filename, data);
            this.currentEventUuid = filename;
            this.currentEventFilename = filename;

            this.processedEvents.add(filename);
            this.notifyListeners(this.currentStatus);
            break;
          } else {
            mainWarn('SafetyPolling', 'Failed to read event file:', filename);
            this.processedEvents.add(filename);
          }
        }
      }
    } catch (error) {
      mainError('SafetyPolling', 'Poll error:', error);
    }
  }
}
