/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Safety Hook Service Types
 *
 * Types for the safety hook service that monitors network and file operations.
 */

/** Risk level classifications */
export type RiskLevel = 'none' | 'low' | 'medium' | 'high' | 'critical';

/** Event type from counterparty */
export type EventType = 'network' | 'file';

/** Network event data structure */
export interface NetworkEventData {
  requestId: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

/** File event data structure */
export interface FileEventData {
  path: string;
  flags: string[];
}

/** Event data union type */
export type EventData = NetworkEventData | FileEventData;

/** Event file structure from counterparty */
export interface EventFileData {
  type: EventType;
  data: EventData;
}

/** Action file structure to counterparty */
export interface ActionFileData {
  allow?: boolean;
  reason?: string;
}

/** Safety status for UI display */
export interface SafetyStatus {
  level: RiskLevel;
  eventType?: EventType;
  eventUuid?: string;
  details?: {
    code: string;
    message: string;
    detectedAt: number;
    networkData?: NetworkEventData;
    fileData?: FileEventData;
    metadata?: Record<string, unknown>;
  };
}

/** Safety confirmation action type */
export type SafetyConfirmationAction = 'allow' | 'deny';
