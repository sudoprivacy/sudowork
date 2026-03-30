/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Safety File Service
 *
 * Handles file-based communication for safety hook service.
 * - Polls /safe/event/{uuid} for new event files
 * - Writes results to /safe/action/{uuid}
 */

import { ensureSecurityHookDirs, listEventFiles, writeActionFile, deleteEventFile, eventToSafetyStatus } from './SecurityHookFile';
import type { SafetyStatus, EventFileData, ActionFileData } from '@/common/safetyTypes';
import { mainLog, mainWarn } from '@process/utils/mainLogger';

export interface SafetyFileConfig {
  pollingIntervalMs: number;
}

export class SafetyFileService {
  private static config: SafetyFileConfig | null = null;
  protected static processedEvents = new Set<string>();
  private static initialized = false;

  /**
   * Initialize safety file service
   */
  static async init(config: SafetyFileConfig): Promise<void> {
    this.config = config;
    if (!this.initialized) {
      await ensureSecurityHookDirs();
      // Mark all existing events as processed (skip stale events from previous sessions)
      await this.markExistingEventsAsProcessed();
      this.initialized = true;
    }
  }

  /**
   * Reset the service state (called when hook is disabled)
   */
  static reset(): void {
    this.processedEvents.clear();
    this.initialized = false;
  }

  /**
   * Mark all existing events as processed to avoid re-processing stale events
   * after app restart
   */
  private static async markExistingEventsAsProcessed(): Promise<void> {
    try {
      const events = await listEventFiles();
      for (const event of events) {
        this.processedEvents.add(event.filename);
      }
      if (events.length > 0) {
        mainLog('SafetyFileService', `Marked ${events.length} existing events as processed (skipping stale events)`);
      }
    } catch (error) {
      mainWarn('SafetyFileService', 'Failed to mark existing events:', error);
    }
  }

  /**
   * Get current safety status by checking for new events
   */
  static async getCurrentStatus(): Promise<SafetyStatus> {
    const events = await listEventFiles();

    // Find first unprocessed event
    for (const event of events) {
      if (event.data && !this.processedEvents.has(event.filename)) {
        this.processedEvents.add(event.filename);
        return eventToSafetyStatus(event.filename, event.data);
      }
    }

    return { level: 'none' };
  }

  /**
   * Write user action result and delete the event file
   */
  static async writeUserResponse(eventUuid: string, allow: boolean, reason?: string): Promise<boolean> {
    const data: ActionFileData = {
      allow,
      reason,
    };

    const resultPath = await writeActionFile(eventUuid, data);
    if (resultPath) {
      // Delete event file immediately after writing action
      // hook.js will delete the action file after reading it
      await deleteEventFile(eventUuid);
      this.processedEvents.delete(eventUuid);
      return true;
    }
    return false;
  }

  /**
   * Mark an event as processed
   */
  static markAsProcessed(eventUuid: string): void {
    this.processedEvents.add(eventUuid);
  }
}
