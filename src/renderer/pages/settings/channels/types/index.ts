import type { ReactNode } from 'react';
import type { IProvider, TProviderWithModel } from '@/common/storage';
import type { GeminiModeOption } from '@/renderer/hooks/useModeModeList';

export type ChannelStatus = 'active' | 'coming_soon';

export interface ChannelConfig {
  id: string;
  title: string;
  description?: string;
  status: ChannelStatus;
  enabled: boolean;
  disabled?: boolean;
  isConnected?: boolean;
  botUsername?: string;
  defaultModel?: string;
  /** Icon URL for the channel (resolved for current runtime) */
  icon?: string;
  /** Whether this channel comes from an extension (shows blue 'ext' badge) */
  isExtension?: boolean;
  content: ReactNode;
}

export interface GeminiModelSelection {
  currentModel?: TProviderWithModel;
  providers: IProvider[];
  geminiModeLookup: Map<string, GeminiModeOption>;
  formatModelLabel: (provider?: { platform?: string }, modelName?: string) => string;
  getDisplayModelName: (modelName?: string) => string;
  getAvailableModels: (provider: IProvider) => string[];
  handleSelectModel: (provider: IProvider, modelName: string) => Promise<void>;
}

/**
 * API response entry for a single config entry within a config item.
 */
export interface TenantConfigEntry {
  id: number;
  config_key: string;
  config_desc: string | null;
  name: string;
  required: number;
}

/**
 * API response for a config item group.
 */
export interface TenantConfigItem {
  id: number;
  name: string;
  entries: TenantConfigEntry[];
  icon: string | null;
  icon_url: string;
  pinyin: string | null;
  scope?: string;
}

/**
 * Internal state for a single config item's entry values.
 * Maps config_key -> current string value.
 */
export type TenantConfigValues = Record<string, string>;
