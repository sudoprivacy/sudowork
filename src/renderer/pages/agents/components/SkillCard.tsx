import React from 'react';
import { Checkbox } from '@arco-design/web-react';
import { Shield, Zap } from 'lucide-react';
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
    <div className={`bg-base rd-12px border p-3 flex items-start gap-3 relative ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
      <Checkbox checked={checked} onChange={onToggle} disabled={disabled} className={`mt-0.5 ${disabled ? '' : 'cursor-pointer'}`} />
      <div className='size-12 flex-shrink-0 rd-8px overflow-hidden'>
        {icon ? (
          <img src={icon} alt={displayName} className='w-full h-full object-cover' />
        ) : emoji ? (
          <div className='w-full h-full f-center text-22px'>{emoji}</div>
        ) : (
          <div className='w-full h-full f-center'>
            <Zap size={22} className='text-primary' />
          </div>
        )}
      </div>
      <div className='flex-1 min-w-0'>
        <div className='flex items-center gap-1.5'>
          <span className='font-medium text-13px text-foreground truncate'>{displayName}</span>
          {!skill.isBuiltin && displayVersion && <span className='px-5px py-0 bg-control text-secondary text-10px rd-3px whitespace-nowrap flex-shrink-0 leading-18px'>v{displayVersion}</span>}
          {skill.isBuiltin && <Shield size={14} className='text-primary flex-shrink-0' />}
        </div>
        {description && <div className='text-11px text-secondary mt-1 line-clamp-2 leading-relaxed'>{description}</div>}
      </div>
    </div>
  );
};

export default SkillCard;
