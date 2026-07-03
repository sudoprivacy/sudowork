/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Progress, Tooltip } from '@arco-design/web-react';
import { Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { handleSkillIconError } from '@/renderer/utils/skillDisplay';
import type { ISkillHubSkill } from '@/common/ipcBridge';

export default function SkillCard({ skill, isInstalled, hasVersion, installing, installProgress, onInstall, onClick, hasUpdate, onUpdate, updating, latestVersion, loadingVersion }: ISkillCardProps) {
  const { t } = useTranslation();
  return (
    <div className='item-card group flex items-start gap-3 relative overflow-hidden' onClick={onClick}>
      {/* Icon */}
      <div className='w-48px flex-shrink-0 flex flex-col items-center'>
        <div className='w-48px h-48px rd-8px overflow-hidden'>{skill.icon ? <img src={skill.icon} alt={skill.display_name} className='w-full h-full object-cover' onError={handleSkillIconError} /> : <div className='w-full h-full f-center text-22px'>{skill.emoji || '📦'}</div>}</div>
      </div>

      {/* Content */}
      <div className='flex-1 min-w-0'>
        <div className='flex items-center gap-6px pr-58px min-w-0'>
          <span className='flex-1 min-w-0 font-medium text-13px text-foreground truncate'>{skill.display_name}</span>
          {loadingVersion && !latestVersion && <span className='px-5px py-0px bg-fill-3 text-tertiary text-10px rd-3px whitespace-nowrap flex-shrink-0 leading-18px animate-pulse'>...</span>}
          {latestVersion && <span className='px-5px py-0px bg-fill-3 text-secondary text-10px rd-3px whitespace-nowrap flex-shrink-0 leading-18px'>v{latestVersion}</span>}
        </div>
        <div className='text-11px text-secondary mt-3px line-clamp-2 leading-relaxed'>{skill.description}</div>
      </div>

      {/* Action - top right */}
      <div className='absolute top-10px right-10px flex items-center' onClick={(e) => e.stopPropagation()}>
        {installing || updating ? (
          <div className='w-52px'>
            <Progress percent={installProgress} size='mini' />
          </div>
        ) : isInstalled && hasUpdate ? (
          <Tooltip content={t('settings.skill.update', '更新')}>
            <button type='button' className='store-action-icon' onClick={onUpdate}>
              <Download size={13} />
            </button>
          </Tooltip>
        ) : isInstalled ? (
          <span className='store-action-badge' style={{ backgroundColor: 'rgba(var(--ui-accent-orange-rgb), 0.10)', color: 'var(--ui-accent-orange)' }}>
            {t('settings.skill.installed', '已安装')}
          </span>
        ) : !isInstalled && hasVersion ? (
          <Tooltip content={t('settings.skill.install', '安装')}>
            <button type='button' className='store-action-icon' onClick={onInstall}>
              <Download size={13} />
            </button>
          </Tooltip>
        ) : null}
      </div>
    </div>
  );
}

interface ISkillCardProps {
  skill: ISkillHubSkill;
  isInstalled: boolean;
  hasVersion: boolean;
  installing: boolean;
  installProgress: number;
  onInstall: (e: React.MouseEvent) => void;
  onClick: () => void;
  hasUpdate?: boolean;
  onUpdate?: (e: React.MouseEvent) => void;
  updating?: boolean;
  /** Latest version info for personal mode skill store display */
  latestVersion?: string;
  /** Whether version info is still loading (for personal mode) */
  loadingVersion?: boolean;
}
