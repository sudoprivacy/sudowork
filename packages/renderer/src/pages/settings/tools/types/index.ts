/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

export type McpImportMode = 'json' | 'oneclick';

export interface IDetectedAgent {
  backend: string;
  name: string;
}

export interface IImageGenerationModelOption {
  label: string;
  value: string;
}

export interface IMcpOAuthStatus {
  isAuthenticated: boolean;
  needsLogin: boolean;
  isChecking: boolean;
  error?: string;
}

export interface IMcpOperationResult {
  agent: string;
  success: boolean;
  error?: string;
}

export interface IMcpOperationResponse {
  success: boolean;
  data?: {
    results: IMcpOperationResult[];
  };
  msg?: string;
}

export interface IValidationResult {
  isValid: boolean;
  errorMessage?: string;
}
