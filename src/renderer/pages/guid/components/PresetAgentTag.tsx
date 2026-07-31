/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { IconClose } from '@arco-design/web-react/icon';
import { Bot } from 'lucide-react';
import React from 'react';
import { resolveExtensionAssetUrl } from '@/renderer/utils/platform';
import type { AcpBackendConfig, AvailableAgent } from '../types';
import { CUSTOM_AVATAR_IMAGE_MAP } from '../utils/constants';

type PresetAgentTagProps = {
  agentInfo: AvailableAgent;
  customAgents: AcpBackendConfig[];
  localeKey: string;
  onClose: () => void;
};

const PresetAgentTag: React.FC<PresetAgentTagProps> = ({ agentInfo, customAgents, localeKey, onClose }) => {
  const avatarValue = agentInfo.avatar?.trim();
  const mappedAvatar = avatarValue ? CUSTOM_AVATAR_IMAGE_MAP[avatarValue] : undefined;
  const resolvedAvatar = avatarValue ? resolveExtensionAssetUrl(avatarValue) : undefined;
  const avatarImage = mappedAvatar || resolvedAvatar;
  const isImageAvatar = Boolean(avatarImage && (/\.(svg|png|jpe?g|webp|gif)$/i.test(avatarImage) || /^(https?:|aion-asset:\/\/|file:\/\/|data:)/i.test(avatarImage)));
  const agent = customAgents.find((a) => a.id === agentInfo.customAgentId);
  const name = agent?.nameI18n?.[localeKey] || agent?.name || agentInfo.name;

  return (
    <div className='flex max-w-full min-w-0 cursor-pointer select-none items-center gap-1.5 bg-secondary py-1 pr-1.5 pl-2.5 transition-colors hover:bg-accent rd-4' onClick={() => {}}>
      {isImageAvatar ? <img src={avatarImage} alt='' width={16} height={16} style={{ objectFit: 'contain', flexShrink: 0 }} /> : avatarValue ? <span style={{ fontSize: 14, lineHeight: '16px', flexShrink: 0 }}>{avatarValue}</span> : <Bot size={16} style={{ flexShrink: 0 }} />}
      <span className='max-w-200px overflow-hidden text-ellipsis whitespace-nowrap text-14px text-foreground'>{name}</span>
      <div
        className='f-center ml-0.5 size-4 shrink-0 transition-colors hover:bg-fill-deep rd-full'
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        <IconClose className='text-foreground-tertiary' style={{ fontSize: 12 }} />
      </div>
    </div>
  );
};

export default PresetAgentTag;
