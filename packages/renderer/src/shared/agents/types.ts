/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AcpBackend, PresetAgentType } from '@sudowork/common/acpTypes';

/**
 * Available agent entry returned by the backend.
 */
export type AvailableAgent = {
  backend: AcpBackend;
  name: string;
  cliPath?: string;
  customAgentId?: string;
  isPreset?: boolean;
  context?: string;
  avatar?: string;
  presetAgentType?: PresetAgentType | string;
  supportedTransports?: string[];
  isExtension?: boolean;
  extensionName?: string;
};
