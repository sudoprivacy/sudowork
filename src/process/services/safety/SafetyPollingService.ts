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
import { eventToSafetyStatus, listEventFilenames, readEventFile, writeEnabledState, actionExists, writeActionFile, deleteEventFile, getNexusClient, CONFIG_DIR } from './SecurityHookFile';
import { initBlacklist, BLACKLIST_CONFIG_PATH } from './SafetyBlacklistService';
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
   * @param enabled - Whether safety hook is enabled
   * @param fastPass - If true, hook.js will immediately allow all requests
   */
  private async persistEnabledState(enabled: boolean, fastPass: boolean = false): Promise<void> {
    try {
      await ProcessConfig.set(SAFETY_HOOK_ENABLED_KEY, enabled);
      // Sync to Nexus filesystem for Agent CLI processes
      await writeEnabledState(enabled, fastPass);
    } catch (err) {
      console.warn('[SafetyPolling] Failed to persist enabled state:', err);
    }
  }

  /**
   * Start polling safety service (called by user action)
   * Forces enabled=true and starts polling
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

    await this.startPolling(config);
  }

  /**
   * Startup safety service on app launch
   * Only starts polling if previously enabled by user
   */
  async startup(config: SafetyPollingConfig): Promise<void> {
    // Initialize from storage to get persisted enabled state
    if (!this.initialized) {
      await this.initialize();
    }

    // Only start polling if user enabled it before
    if (!this.enabled) {
      console.log('[SafetyPolling] Service disabled by user, skipping startup');
      return;
    }

    if (this.interval) {
      this.config = config;
      return;
    }

    this.config = config;
    await this.startPolling(config);
  }

  /**
   * Internal method to start the polling loop
   */
  private async startPolling(config: SafetyPollingConfig): Promise<void> {
    // Initialize file service (will mark existing events as processed)
    try {
      await SafetyFileService.init({
        pollingIntervalMs: config.pollingIntervalMs,
      });
      console.log('[SafetyPolling] SafetyFileService initialized, processedEvents size:', SafetyFileService['processedEvents'].size);
    } catch (err) {
      console.error(`[SafetyPolling] Failed to init SafetyFileService:`, err);
      throw err;
    }

    this.interval = setInterval(() => {
      void this.poll();
    }, config.pollingIntervalMs);

    console.log('[SafetyPolling] Polling started, interval:', config.pollingIntervalMs);

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
   * @param persist - Whether to persist the disabled state (default: true)
   */
  async stop(persist: boolean = true): Promise<void> {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.enabled = false;
    setSafetyHookEnabled(false);
    if (persist) {
      // Use fastPass=true to immediately allow all requests in hook.js
      await this.persistEnabledState(false, true);
    }
    // Clear current event status when stopping
    this.currentStatus = { level: 'none' };
    this.currentEventUuid = null;
    this.currentEventFilename = null;
    this.notifyListeners(this.currentStatus);
    // Reset SafetyFileService so it can re-initialize on next start
    // This ensures events during disabled period are marked as processed
    SafetyFileService.reset();

    // Async cleanup: write allow action for pending events, then delete them
    this.cleanupPendingEvents().catch((err) => {
      console.warn('[SafetyPolling] Failed to cleanup pending events:', err);
    });
  }

  /**
   * Async cleanup pending events when hook is disabled.
   * Writes allow action for each pending event, then deletes event files.
   * This ensures requests waiting for confirmation are released immediately.
   */
  private async cleanupPendingEvents(): Promise<void> {
    try {
      const eventFilenames = await listEventFilenames();
      if (eventFilenames.length === 0) {
        return;
      }

      console.log(`[SafetyPolling] Cleaning up ${eventFilenames.length} pending events`);

      for (const filename of eventFilenames) {
        // Check if action already exists (user may have just confirmed)
        const hasAction = await actionExists(filename);
        if (!hasAction) {
          // Write allow action - hook.js will detect it immediately
          await writeActionFile(filename, { allow: true, reason: 'Safety hook disabled' });
        }
        // Delete event file (sudowork is responsible for deleting events)
        await deleteEventFile(filename);
      }

      console.log(`[SafetyPolling] Cleaned up ${eventFilenames.length} pending events`);
    } catch (err) {
      console.warn('[SafetyPolling] Cleanup pending events failed:', err);
    }
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
   * Check if blacklist has active rules by reading directly from Nexus
   * This ensures consistency with hook.js which also reads from Nexus
   */
  private async hasActiveBlacklistRules(): Promise<boolean> {
    try {
      const client = getNexusClient();
      const content = await client.read(BLACKLIST_CONFIG_PATH);
      if (!Buffer.isBuffer(content) || content.length === 0) {
        return false;
      }
      const configStr = content.toString('utf-8');
      const config = JSON.parse(configStr) as { rules?: { enabled?: boolean }[] };
      return config?.rules?.some((rule: { enabled?: boolean }) => rule.enabled) ?? false;
    } catch (error) {
      // If blacklist file doesn't exist or parse fails, assume no rules
      return false;
    }
  }

  /**
   * Poll event directory and update status
   * Only polls if safety hook is enabled AND blacklist has active rules
   */
  private async poll(): Promise<void> {
    if (!this.config) {
      return;
    }

    // Skip polling if safety hook is disabled
    if (!this.enabled) {
      return;
    }

    // Skip polling if blacklist is empty (no rules to match)
    const hasActiveRules = await this.hasActiveBlacklistRules();
    if (!hasActiveRules) {
      return;
    }

    try {
      const filenames = await listEventFilenames();

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
          const data = await readEventFile(filename);

          if (data) {
            this.currentStatus = eventToSafetyStatus(filename, data);
            this.currentEventUuid = filename;
            this.currentEventFilename = filename;

            processedSet.add(filename);
            this.notifyListeners(this.currentStatus);
            break;
          } else {
            // If read failed, mark as processed to ignore it in next polls
            console.warn('[SafetyPolling] Failed to read event file:', filename);
            processedSet.add(filename);
          }
        }
      }
    } catch (error) {
      console.error('[SafetyPolling] Poll error:', error);
    }
  }
}
