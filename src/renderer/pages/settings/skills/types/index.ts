/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ISkillHubDetail } from '@/common/ipcBridge';

export interface IBridgeResponse<D = unknown> {
  success: boolean;
  data?: D;
  msg?: string;
}

export interface SkillLatestVersion {
  version: string;
  sourceUrl: string;
  checksum: string;
  /** Timestamp when this version info was fetched (for cache expiration) */
  fetchedAt: number;
}

export type SkillDetailResponse = { success: boolean; data?: ISkillHubDetail; msg?: string };

export type SkillStoreTab = 'store' | 'exclusive' | 'installed';
export type LocalSkillImportSource = 'zip' | 'directory';
export type LocalSkillImportDialogOptions = {
  defaultPath?: string;
  properties?: Array<'openFile' | 'openDirectory'>;
  filters?: Array<{ name: string; extensions: string[] }>;
};

export interface CoreFeature {
  title: string;
  desc: string;
}
