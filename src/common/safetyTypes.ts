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

// ==================== Blacklist Types ====================

/** Pattern matching type for blacklist rules */
export type BlacklistMatchType = 'exact' | 'wildcard';

/** Single blacklist rule */
export interface BlacklistRule {
  /** Unique identifier */
  id: string;
  /** Whether this rule is active */
  enabled: boolean;
  /** Rule type: network (domain/IP) or file (path) */
  type: 'network' | 'file';
  /** Pattern to match (domain, IP, or file path) */
  pattern: string;
  /** How to interpret the pattern */
  matchType: BlacklistMatchType;
  /** Risk level when matched */
  riskLevel: RiskLevel;
  /** Optional description */
  description?: string;
  /** Creation timestamp */
  createdAt: number;
  /** Last update timestamp */
  updatedAt: number;
}

/** Blacklist configuration */
export interface BlacklistConfig {
  /** List of blacklist rules */
  rules: BlacklistRule[];
}

/** Default blacklist configuration */
export const DEFAULT_BLACKLIST_CONFIG: BlacklistConfig = {
  rules: [],
};
