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
 */

import type { SafetyStatus } from '@/common/safetyTypes';
import { ipcBridge } from '@/common';
import { SafetyFileService } from './SafetyFileService';
import { eventToSafetyStatus, listEventFilenames, readEventFile } from './SecurityHookFile';

export interface SafetyPollingConfig {
  pollingIntervalMs: number;
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

  private constructor() {}

  static getInstance(): SafetyPollingService {
    if (!SafetyPollingService.instance) {
      SafetyPollingService.instance = new SafetyPollingService();
    }
    return SafetyPollingService.instance;
  }

  /**
   * Start polling safety service
   */
  async start(config: SafetyPollingConfig): Promise<void> {
    if (this.interval) {
      this.config = config;
      this.enabled = true;
      return;
    }

    this.config = config;
    this.enabled = true;

    // Initialize file service (async for Nexus SDK)
    await SafetyFileService.init({
      pollingIntervalMs: config.pollingIntervalMs,
    });

    this.interval = setInterval(() => {
      void this.poll();
    }, config.pollingIntervalMs);

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
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      this.enabled = false;
      // Clear current event status when stopping
      this.currentStatus = { level: 'none' };
      this.currentEventUuid = null;
      this.currentEventFilename = null;
      this.notifyListeners(this.currentStatus);
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
    ipcBridge.safety.onStatusChange.emit(status);
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
            processedSet.add(filename);
          }
        }
      }
    } catch (error) {
      console.error('[SafetyPolling] Poll error:', error);
    }
  }
}
