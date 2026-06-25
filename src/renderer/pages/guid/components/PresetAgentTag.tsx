/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { IconClose } from '@arco-design/web-react/icon';
import { Robot } from '@icon-park/react';
import React from 'react';
import { resolveExtensionAssetUrl } from '@/renderer/utils/platform';
import type { AcpBackendConfig, AvailableAgent } from '../types';
import { CUSTOM_AVATAR_IMAGE_MAP } from '../constants';

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
    <div className='flex items-center gap-1.5 bg-fill-2 py-1 pr-1.5 pl-2.5 rd-4 cursor-pointer select-none transition-colors max-w-full min-w-0 hover:bg-fill-3' onClick={() => {}}>
      {isImageAvatar ? <img src={avatarImage} alt='' width={16} height={16} style={{ objectFit: 'contain', flexShrink: 0 }} /> : avatarValue ? <span style={{ fontSize: 14, lineHeight: '16px', flexShrink: 0 }}>{avatarValue}</span> : <Robot theme='outline' size={16} style={{ flexShrink: 0 }} />}
      <span className='max-w-200px text-14px text-1 whitespace-nowrap overflow-hidden text-ellipsis'>{name}</span>
      <div
        className='f-center size-4 rd-full ml-0.5 transition-colors shrink-0 hover:bg-fill-4'
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        <IconClose style={{ fontSize: 12, color: 'var(--color-text-3)' }} />
      </div>
    </div>
  );
};

export default PresetAgentTag;
