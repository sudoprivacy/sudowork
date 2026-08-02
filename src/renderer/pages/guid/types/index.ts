/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AcpBackend, AcpBackendAll, AcpBackendConfig, AcpModelInfo, PresetAgentType } from '@/types/acpTypes';

/**
 * Available agent entry returned by the backend.
 * backend is AcpBackendAll which includes 'remote-agent' (enterprise mode).
 */
export type AvailableAgent = {
  backend: AcpBackendAll;
  name: string;
  cliPath?: string;
  customAgentId?: string;
  isPreset?: boolean;
  context?: string;
  avatar?: string;
  // Allow extension-contributed adapter IDs (e.g. 'ext-buddy') in addition to built-in PresetAgentType values
  presetAgentType?: PresetAgentType | string;
  isExtension?: boolean;
  extensionName?: string;
  /** Enterprise-specific metadata for remote-agent */
  enterpriseMetadata?: {
    mossServerUrl?: string;
    authMode?: 'api_key' | 'password' | 'access_token';
    runtimeType?: 'host' | 'docker';
  };
};

/**
 * Computed mention option for the @ mention dropdown.
 */
export type MentionOption = {
  key: string;
  label: string;
  tokens: Set<string>;
  avatar: string | undefined;
  avatarImage: string | undefined;
  logo: string | undefined;
  isExtension?: boolean;
};

/**
 * Effective agent type info used for UI display and send logic.
 * agentType and originalType are widened to string to support extension-contributed adapter IDs.
 */
export type EffectiveAgentInfo = {
  agentType: PresetAgentType | string;
  isFallback: boolean;
  originalType: PresetAgentType | string;
  isAvailable: boolean;
};

/**
 * A single prompt template entry.
 */
export type PromptTemplate = {
  /** i18n key for the display label */
  labelKey: string;
  /** i18n key for the prompt content to fill into the input */
  contentKey: string;
  /** Optional emoji icon */
  icon?: string;
};

/**
 * Re-export commonly used ACP types for convenience.
 */
export type { AcpBackend, AcpBackendConfig, AcpModelInfo, PresetAgentType };
