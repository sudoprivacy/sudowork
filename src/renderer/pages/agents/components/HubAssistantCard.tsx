/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Progress, Tooltip } from '@arco-design/web-react';
import { Bot, Copy, Download, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { IAssistantHubSkill } from '@/common/ipcBridge';

const HubAssistantCard: React.FC<HubAssistantCardProps> = ({ assistant, isInstalled, installing, installProgress, onInstall, onUpdate, onDuplicate, onClick, hasUpdate, updating, latestVersion }) => {
  const { t } = useTranslation();

  const displayName = assistant.display_name || assistant.name;
  const resolvedAvatar = assistant.avatar?.trim();
  const emojiRegex = /^(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:\u200D(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F))*$/u;
  const hasEmojiAvatar = Boolean(resolvedAvatar && emojiRegex.test(resolvedAvatar));

  // Check if assistant has a valid download URL (null/undefined means no installable package)
  const hasDownloadUrl = Boolean(assistant._sourceUrl);

  return (
    <div className='card group flex items-start gap-12px relative overflow-hidden' onClick={onClick}>
      {/* Icon */}
      <div className='w-48px flex-shrink-0 flex flex-col items-center'>
        <div className='w-48px h-48px rd-8px overflow-hidden bg-fill-2'>
          {resolvedAvatar ? (
            hasEmojiAvatar ? (
              <div className='w-full h-full f-center text-22px'>{resolvedAvatar}</div>
            ) : (
              <img src={resolvedAvatar} alt={displayName} className='w-full h-full object-cover' />
            )
          ) : assistant.emoji ? (
            <div className='w-full h-full f-center text-22px'>{assistant.emoji}</div>
          ) : (
            <div className='w-full h-full f-center'>
              <Bot size={22} className='text-primary' />
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className='flex-1 min-w-0'>
        <div className='flex items-center gap-6px pr-100px min-w-0'>
          <span className='min-w-0 font-medium text-13px text-foreground truncate'>{displayName}</span>
          {latestVersion && <span className='px-5px py-0px bg-control text-t-secondary text-10px rd-3px whitespace-nowrap flex-shrink-0 leading-18px'>v{latestVersion}</span>}
        </div>
        <div className='text-11px text-secondary mt-3px line-clamp-2 leading-relaxed'>{assistant.description}</div>
        {assistant.skills && assistant.skills.length > 0 && (
          <div className='mt-4px flex items-center gap-4px'>
            <Zap size={12} className='text-primary flex-shrink-0' />
            <span className='text-10px text-tertiary'>{t('settings.assistant.relatedSkills', { count: assistant.skills.length, defaultValue: `${assistant.skills.length} 个关联技能` })}</span>
          </div>
        )}
      </div>

      {/* Actions - top right */}
      <div className='absolute top-10px right-10px flex items-center gap-6px' onClick={(e) => e.stopPropagation()}>
        {/* Duplicate button - only for installed assistants */}
        {isInstalled && (
          <>
            {!hasUpdate && !updating && (
              <span className='store-action-badge' style={{ backgroundColor: 'rgba(var(--ui-accent-orange-rgb), 0.10)', color: 'var(--ui-accent-orange)' }}>
                {t('settings.assistant.installed', '已安装')}
              </span>
            )}
            <Tooltip content={t('settings.assistant.duplicate', '复制')}>
              <button type='button' className='store-action-icon' onClick={onDuplicate}>
                <Copy size={13} />
              </button>
            </Tooltip>
          </>
        )}
        {/* Install button or progress - only show if hasDownloadUrl */}
        {installing || updating ? (
          <div className='w-52px'>
            <Progress percent={installProgress} size='mini' />
          </div>
        ) : isInstalled && hasUpdate ? (
          <Tooltip content={t('settings.assistant.update', '更新')}>
            <button type='button' className='store-action-icon' onClick={onUpdate}>
              <Download size={13} />
            </button>
          </Tooltip>
        ) : !isInstalled && hasDownloadUrl ? (
          <Tooltip content={t('settings.assistant.install', '安装')}>
            <button type='button' className='store-action-icon' onClick={onInstall}>
              <Download size={13} />
            </button>
          </Tooltip>
        ) : null}
      </div>
    </div>
  );
};

type HubAssistantCardProps = {
  assistant: IAssistantHubSkill;
  isInstalled: boolean;
  installing: boolean;
  installProgress: number;
  onInstall: (_e: React.MouseEvent) => void;
  onUpdate?: (_e: React.MouseEvent) => void;
  onDuplicate: (_e: React.MouseEvent) => void;
  onClick: () => void;
  hasUpdate?: boolean;
  updating?: boolean;
  latestVersion?: string;
};

export default HubAssistantCard;
