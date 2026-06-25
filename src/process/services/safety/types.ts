/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Safety Service Types
 */

import type { IActionFileData, IEventFileData, ISafetyStatus, RiskLevel } from '@common/types/security';

export type { IActionFileData, IEventFileData, ISafetyStatus, RiskLevel };

/**
 * Safety check result from external API
 */
export interface SafetyCheckResult {
  status: ISafetyStatus;
  raw?: unknown;
}

/**
 * Safety confirmation action
 */
export type SafetyConfirmationAction = 'allow' | 'deny';
