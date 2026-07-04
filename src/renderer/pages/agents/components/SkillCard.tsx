/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Checkbox } from '@arco-design/web-react';
import { Lightning, Shield } from '@icon-park/react';
import type { IInstalledSkillInfo } from '@/common/ipcBridge';
import { getInstalledSkillDisplay, normalizeSkillVersion } from '@/renderer/utils/skillDisplay';

interface SkillCardProps {
  skill: IInstalledSkillInfo;
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
}

// SkillCard (for drawer skill selection)
const SkillCard: React.FC<SkillCardProps> = ({ skill, checked, onToggle, disabled }) => {
  const { displayName, description, icon, emoji } = getInstalledSkillDisplay(skill);
  const displayVersion = normalizeSkillVersion(skill.version);

  return (
    <div className={`bg-fill-1 rd-12px border p-12px flex items-start gap-12px relative ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
      <Checkbox checked={checked} onChange={onToggle} disabled={disabled} className={`mt-2px ${disabled ? '' : 'cursor-pointer'}`} />
      <div className='w-48px h-48px flex-shrink-0 rd-8px overflow-hidden bg-fill-2'>
        {icon ? (
          <img src={icon} alt={displayName} className='w-full h-full object-cover' />
        ) : emoji ? (
          <div className='w-full h-full f-center text-22px'>{emoji}</div>
        ) : (
          <div className='w-full h-full f-center bg-primary-light'>
            <Lightning size='22' className='text-primary' />
          </div>
        )}
      </div>
      <div className='flex-1 min-w-0'>
        <div className='flex items-center gap-6px'>
          <span className='font-medium text-13px text-foreground truncate'>{displayName}</span>
          {!skill.isBuiltin && displayVersion && <span className='px-5px py-0px bg-control text-secondary text-10px rd-3px whitespace-nowrap flex-shrink-0 leading-18px'>v{displayVersion}</span>}
          {skill.isBuiltin && <Shield size='14' className='text-primary flex-shrink-0' />}
        </div>
        {description && <div className='text-11px text-secondary mt-3px line-clamp-2 leading-relaxed'>{description}</div>}
      </div>
    </div>
  );
};

export default SkillCard;
