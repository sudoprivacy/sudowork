/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Safety Service Types
 */

import type { RiskLevel, SafetyStatus, EventFileData, ActionFileData } from '@common/types/security';

export type { RiskLevel, SafetyStatus, EventFileData, ActionFileData };

/**
 * Safety check result from external API
 */
export interface SafetyCheckResult {
  status: SafetyStatus;
  raw?: unknown;
}

/**
 * Safety confirmation action
 */
export type SafetyConfirmationAction = 'allow' | 'deny';
