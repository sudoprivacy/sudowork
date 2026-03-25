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
      this.initialized = true;
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
   * Write user action result
   */
  static async writeUserResponse(eventUuid: string, allow: boolean, reason?: string): Promise<boolean> {
    const data: ActionFileData = {
      allow,
      reason,
    };

    const resultPath = await writeActionFile(eventUuid, data);
    return resultPath !== null;
  }

  /**
   * Mark an event as processed
   */
  static markAsProcessed(eventUuid: string): void {
    this.processedEvents.add(eventUuid);
  }

  /**
   * Delete processed event file after response is written
   */
  static async deleteProcessedEvent(eventUuid: string): Promise<void> {
    // Delay deletion to give counterparty time to read the response (5 seconds)
    setTimeout(async () => {
      await deleteEventFile(eventUuid);
      this.processedEvents.delete(eventUuid);
    }, 5000);
  }
}
