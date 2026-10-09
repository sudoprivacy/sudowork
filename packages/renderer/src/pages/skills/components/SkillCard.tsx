/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Button, Progress, Tooltip } from '@arco-design/web-react';
import { Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ISkillHubSkill } from '@sudowork/host-bridge/ipcBridge';
import { handleSkillIconError } from '@renderer/utils/skillDisplay';

export default function SkillCard({ skill, isInstalled, hasVersion, installing, installProgress, onInstall, onClick, hasUpdate, onUpdate, updating, latestVersion }: ISkillCardProps) {
  const { t } = useTranslation();
  return (
    <div className='card group flex items-start gap-3 relative overflow-hidden' onClick={onClick}>
      {/* Icon */}
      <div className='w-12 flex-shrink-0 flex flex-col items-center'>
        <div className='size-12 rd-8px overflow-hidden'>{skill.icon ? <img src={skill.icon} alt={skill.display_name} className='w-full h-full object-cover' onError={handleSkillIconError} /> : <div className='w-full h-full f-center text-22px'>{skill.emoji || '📦'}</div>}</div>
      </div>

      {/* Content */}
      <div className='flex-1 min-w-0'>
        <div className='flex items-center gap-2 pr-14.5 min-w-0'>
          <span className='font-medium text-13px text-foreground truncate'>{skill.display_name}</span>
          {latestVersion && <span className='px-[5px] py-0 bg-control text-secondary text-10px rd-3px whitespace-nowrap flex-shrink-0 leading-18px'>v{latestVersion}</span>}
        </div>
        <div className='text-11px text-secondary mt-[3px] line-clamp-2 leading-relaxed'>{skill.description}</div>
      </div>

      {/* Action - top right */}
      <div className='absolute top-1.5 right-2.5 flex items-center' onClick={(e) => e.stopPropagation()}>
        {installing || updating ? (
          <div className='w-13'>
            <Progress percent={installProgress} size='mini' />
          </div>
        ) : isInstalled && hasUpdate ? (
          <Tooltip content={t('settings.skill.update', '更新')}>
            <Button icon={<Download size={13} />} onClick={onUpdate} className='!size-7' />
          </Tooltip>
        ) : isInstalled ? (
          <span className='store-action-badge' style={{ backgroundColor: 'rgba(var(--ui-accent-orange-rgb), 0.10)', color: 'var(--ui-accent-orange)' }}>
            {t('settings.skill.installed', '已安装')}
          </span>
        ) : !isInstalled && hasVersion ? (
          <Tooltip content={t('settings.skill.install', '安装')}>
            <Button icon={<Download size={13} />} onClick={onInstall} className='!size-7' />
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
  onInstall: () => void;
  onClick: () => void;
  hasUpdate?: boolean;
  onUpdate?: () => void;
  updating?: boolean;
  /** Latest version info for personal mode skill store display */
  latestVersion?: string;
}
