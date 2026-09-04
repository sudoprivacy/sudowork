/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * System-config type surface (interface doc 1.4) — pure types, no runtime, so the
 * main process, renderer, and shared renderer package read one definition without
 * the fetch/decrypt runtime that produces the values.
 */

export type RechargeMode = 'pay' | 'approve' | 'disabled';

export interface ICreditApplicationConfig {
  min_points: number;
  max_points: number;
  allow_duplicate_pending: boolean;
}

export interface SystemConfig {
  login_method?: number;
  third_party_auth?: ThirdPartyAuthConfig;
  log_report?: { enabled: number; baseurl?: string };
  version_update?: { enabled: number; cos_domain?: string };
  product_improvement?: { enabled: number; encryption_required?: boolean };
  sudorouter_baseurl?: string;
  skillhub_baseurl?: string;
  scode_auto_model?: string;
  recharge_mode?: RechargeMode;
  credit_application?: ICreditApplicationConfig;
}

export interface ThirdPartyAuthProvider {
  id: string;
  name: string;
  type: 'cas';
  cas_url: string;
  login_path?: string;
  validate_path?: string;
  logout_path?: string;
  logout_service_url?: string;
  service_param?: string;
  service_encode_mode?: 'component' | 'raw';
  callback_mode?: 'direct_app' | 'server_callback';
  server_callback_url?: string;
  app_callback_url?: string;
}

export interface ThirdPartyAuthConfig {
  enabled?: boolean;
  default_provider?: string;
  providers?: ThirdPartyAuthProvider[];
}
