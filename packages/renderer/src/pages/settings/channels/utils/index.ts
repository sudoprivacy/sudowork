/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { BUILD_SUDOWORK_SERVER_BASE_URL } from '@sudowork/common/sudoworkServer';
import ChannelDingTalkLogo from '@renderer/assets/channel-logos/dingtalk.svg';
import ChannelLarkLogo from '@renderer/assets/channel-logos/lark.svg';
import ChannelTelegramLogo from '@renderer/assets/channel-logos/telegram.svg';
import ChannelWeChatLogo from '@renderer/assets/channel-logos/wechat.svg';
import configItemDefaultIcon from '@renderer/assets/config-item-default.svg';
import type { TenantConfigItem, TenantConfigValues } from '../types';

export const CHANNEL_LOGOS = [
  { src: ChannelWeChatLogo, alt: 'WeChat' },
  { src: ChannelTelegramLogo, alt: 'Telegram' },
  { src: ChannelLarkLogo, alt: 'Lark' },
  { src: ChannelDingTalkLogo, alt: 'DingTalk' },
] as const;

export const BUILTIN_CHANNEL_TYPES = new Set(['telegram', 'lark', 'dingtalk', 'wechat', 'wecom']);

export const DINGTALK_DEV_DOCS_URL = 'https://sudowork.sudoprivacy.com/guides/dingtalk.html';
export const LARK_DEV_DOCS_URL = 'https://sudowork.sudoprivacy.com/guides/feishu.html';
export const WECOM_DEV_DOCS_URL = 'https://sudowork.sudoprivacy.com/guides/wecom.html';
export const WECHAT_GUIDE_URL = 'https://sudowork.sudoprivacy.com/guides/weixin-clawbot.html';

export function resolveConfigItemIconUrl(iconUrl: string | null, baseUrl?: string): string {
  if (!iconUrl) return configItemDefaultIcon;
  if (iconUrl.startsWith('data:') || iconUrl.startsWith('http://') || iconUrl.startsWith('https://')) {
    return iconUrl;
  }
  const resolvedBase = (baseUrl ?? BUILD_SUDOWORK_SERVER_BASE_URL).replace(/\/+$/, '');
  return `${resolvedBase}${iconUrl.startsWith('/') ? iconUrl : `/${iconUrl}`}`;
}

export function resolveEnterpriseConfigItemIconUrl(iconUrl: string | null, baseUrl?: string): string {
  if (!iconUrl) return configItemDefaultIcon;
  if (iconUrl.startsWith('data:') || iconUrl.startsWith('http://') || iconUrl.startsWith('https://')) {
    return iconUrl;
  }
  if (baseUrl) {
    return `${baseUrl.replace(/\/+$/, '')}${iconUrl.startsWith('/') ? iconUrl : `/${iconUrl}`}`;
  }
  return configItemDefaultIcon;
}

export function shouldBlockEnableUntilConfigured(configItem: TenantConfigItem, values: TenantConfigValues): boolean {
  if (configItem.pinyin !== 'shareone') return false;
  return configItem.entries.some((entry) => entry.required === 1 && !values[entry.config_key]?.trim());
}
