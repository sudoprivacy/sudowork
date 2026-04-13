/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { CUSTOM_AVATAR_IMAGE_MAP } from '../constants';
import type { AcpBackendConfig } from '../types';
import { Plus, Robot } from '@icon-park/react';
import React from 'react';
import { resolveExtensionAssetUrl } from '@/renderer/utils/platform';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

type AssistantSelectionAreaProps = {
  customAgents: AcpBackendConfig[];
  localeKey: string;
  onSelectAssistant: (assistantId: string) => void;
};

/**
 * Renders the assistant selection grid (pill list) when no assistant is selected.
 * The selected assistant view (header, description, prompts) is now handled
 * directly in GuidPage for proper layout ordering.
 */
const AssistantSelectionArea: React.FC<AssistantSelectionAreaProps> = ({ customAgents, localeKey, onSelectAssistant }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  // Only render if there are preset agents
  if (!customAgents || !customAgents.some((a) => a.isPreset)) return null;

  const allowedPresetIds = ['builtin-ui-ux-pro-max', 'builtin-planning-with-files', 'builtin-beautiful-mermaid', 'builtin-moltbook', 'builtin-copilot', 'builtin-doctor', 'builtin-jiansheku'];
  const nobuildin = customAgents.filter((a) => a.isPreset).filter((_) => !_.id.startsWith('builtin-'));
  const filteredAgents = customAgents
    .filter((a) => a.isPreset)
    .filter((_) => allowedPresetIds.includes(_.id))
    .concat(nobuildin);

  // Assistant List View
  return (
    <div className='mt-16px w-full'>
      <div className='flex flex-wrap gap-8px justify-center'>
        {filteredAgents
          .filter((a) => a.isPreset && a.enabled !== false)
          .sort((a, b) => {
            if (a.id === 'cowork') return -1;
            if (b.id === 'cowork') return 1;
            return 0;
          })
          .map((assistant) => {
            const avatarValue = assistant.avatar?.trim();
            const mappedAvatar = avatarValue ? CUSTOM_AVATAR_IMAGE_MAP[avatarValue] : undefined;
            const resolvedAvatar = avatarValue ? resolveExtensionAssetUrl(avatarValue) : undefined;
            const avatarImage = mappedAvatar || resolvedAvatar;
            const isImageAvatar = Boolean(avatarImage && (/\.(svg|png|jpe?g|webp|gif)$/i.test(avatarImage) || /^(https?:|aion-asset:\/\/|file:\/\/|data:)/i.test(avatarImage)));
            return (
              <div key={assistant.id} className='h-28px group flex items-center gap-8px px-16px rd-100px cursor-pointer transition-all b-1 b-solid bg-fill-0 hover:bg-fill-1 select-none' style={{ borderWidth: '1px', borderColor: 'var(--bg-3)' }} onClick={() => onSelectAssistant(`custom:${assistant.id}`)}>
                {isImageAvatar ? <img src={avatarImage} alt='' width={16} height={16} style={{ objectFit: 'contain' }} /> : avatarValue ? <span style={{ fontSize: 16, lineHeight: '18px' }}>{avatarValue}</span> : <Robot theme='outline' size={16} />}
                <span className='text-14px text-2 hover:text-1'>{assistant.nameI18n?.[localeKey] || assistant.name}</span>
              </div>
            );
          })}
        <div className='group flex items-center justify-center h-28px min-w-28px px-8px gap-4px rd-100px bg-fill-0 cursor-pointer whitespace-nowrap b-1 b-dashed select-none transition-colors duration-300 hover:bg-fill-2' style={{ borderWidth: '1px', borderColor: 'var(--bg-3)' }} onClick={() => navigate('/settings/agent')}>
          <Plus theme='outline' size={14} className='flex-shrink-0 line-height-0 text-[var(--color-text-3)] group-hover:text-[var(--color-text-2)] transition-colors duration-300' />
          <span className='text-14px text-2 group-hover:text-1 transition-colors duration-300'>{t('settings.createAssistant', { defaultValue: 'Add Assistant' })}</span>
        </div>
      </div>
    </div>
  );
};

export default AssistantSelectionArea;
