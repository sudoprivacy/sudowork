/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ICliStatus, ILibreOfficeInstallPhase, IPopplerInstallPhase, NexusInstallPhase } from '@sudowork/host-bridge/ipcBridge';
import type { LocalKbInstallPhase } from '@/common/types/localKnowledgeBase';

export type LoadState = 'idle' | 'loading' | 'installing';

export interface ToolRow {
  key: string;
  displayName: string;
  command: string;
  badge: string;
  status: ICliStatus | null;
  statusResolved?: boolean;
  nexusPort?: number;
  nexusRunning?: boolean;
  nexusInstalled?: boolean;
  loadState: LoadState;
  installPhase?: ILibreOfficeInstallPhase | NexusInstallPhase | LocalKbInstallPhase | IPopplerInstallPhase | string;
  installPercent?: number;
  onRefresh: () => Promise<void>;
  onInstall?: () => Promise<void>;
  onUninstall?: () => Promise<void>;
  onStart?: () => Promise<void>;
}

export interface RuntimeAction {
  key: 'install' | 'reinstall' | 'refresh' | 'uninstall' | 'start';
  label: string;
  type: 'primary' | 'secondary' | 'outline';
  status?: 'warning';
  onClick: () => Promise<void>;
}

export type RuntimeResolvedStatus = 'checking' | 'installing' | 'notInstalled' | 'installed' | 'running';
