import React from 'react';
import { Button, Spin, Popconfirm, Switch, Tooltip } from '@arco-design/web-react';
import { Trash2, Shield, Zap, Download } from 'lucide-react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import { getInstalledSkillDisplay, normalizeSkillVersion, handleSkillIconError } from '@/renderer/utils/skillDisplay';
import type { IInstalledSkillInfo } from '@/common/ipcBridge';

export default function InstalledSkillCard({ skill, onUninstall, uninstalling, onToggleEnabled, togglingEnabled, onClick, hasUpdate, onUpdate, updating, enterprisePublishButton, hideUninstall }: IInstalledSkillCardProps) {
  const { displayName, description, icon, emoji } = getInstalledSkillDisplay(skill);
  const displayVersion = normalizeSkillVersion(skill.version);
  const canUninstall = !skill.isBuiltin && !hideUninstall;
  const canToggleEnabled = !!skill.meta && !skill.isBuiltin;
  const hasDetail = !!skill.meta;
  const isEnabled = skill.enabled;
  const { t } = useTranslation();

  return (
    <div className={classNames('item-card group flex items-start gap-3 relative overflow-hidden', !isEnabled && 'opacity-65', !hasDetail && 'cursor-default')} onClick={hasDetail ? onClick : undefined}>
      {/* Icon */}
      <div className='w-12 flex-shrink-0'>
        <div className='size-12 rd-8px overflow-hidden'>
          {icon ? (
            <img src={icon} alt={displayName} className='w-full h-full object-cover' onError={handleSkillIconError} />
          ) : emoji ? (
            <div className='w-full h-full f-center text-22px'>{emoji}</div>
          ) : (
            <div className='w-full h-full f-center'>
              <Zap size={22} className='text-primary' />
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className='flex-1 min-w-0'>
        <div className='flex items-center gap-2 pr-14.5 min-w-0'>
          <span className='min-w-0 font-medium text-13px text-foreground truncate'>{displayName}</span>
          {!skill.isBuiltin && displayVersion && <span className='px-[5px] py-0 bg-control text-secondary text-10px rd-3px whitespace-nowrap flex-shrink-0 leading-18px'>v{displayVersion}</span>}
        </div>
        <div className='mt-[3px] min-h-7.5'>{description ? <div className='text-11px text-secondary line-clamp-2 leading-15px'>{description}</div> : <div className='text-11px text-tertiary italic line-clamp-2 leading-15px'>{skill.name}</div>}</div>
      </div>

      {/* Actions - top right */}
      <div className='absolute top-1.5 right-2.5 flex items-center gap-3' onClick={(e) => e.stopPropagation()}>
        {hasUpdate && (
          <Tooltip content={t('settings.skill.updateAvailable', '可更新')}>
            <Button icon={<Download size={13} />} loading={updating} onClick={() => onUpdate?.()} className='!size-7' />
          </Tooltip>
        )}
        {enterprisePublishButton}
        {canToggleEnabled && <Switch size='small' checked={isEnabled} loading={togglingEnabled} onChange={(checked) => onToggleEnabled?.(checked)} />}
        {skill.isBuiltin ? (
          <Tooltip content={t('settings.skill.builtinSkill', '内置技能')}>
            <Button icon={<Shield size={15} />} disabled className='!size-7' />
          </Tooltip>
        ) : !canUninstall ? (
          <Tooltip content={t('settings.skill.builtinSkillCannotUninstall', '内置技能无法卸载')}>
            <Button icon={<Shield size={14} />} disabled className='!size-7' />
          </Tooltip>
        ) : uninstalling ? (
          <Spin size={14} />
        ) : (
          <Popconfirm title={t('settings.skill.uninstallConfirm', '确认卸载该技能？')} onOk={onUninstall} okText={t('common.uninstall', '卸载')} cancelText={t('common.cancel', '取消')} okButtonProps={{ status: 'danger' }}>
            <Tooltip content={t('common.delete', '删除')}>
              <Button status='danger' icon={<Trash2 size={15} />} className='!size-7' />
            </Tooltip>
          </Popconfirm>
        )}
      </div>
    </div>
  );
}

interface IInstalledSkillCardProps {
  skill: IInstalledSkillInfo;
  onUninstall: () => void;
  uninstalling: boolean;
  onToggleEnabled?: (enabled: boolean) => void;
  togglingEnabled: boolean;
  onClick?: () => void;
  hasUpdate?: boolean;
  onUpdate?: () => void;
  updating?: boolean;
  /** Enterprise mode: publish button element */
  enterprisePublishButton?: React.ReactNode;
  /** Enterprise mode: whether to hide uninstall button (only custom skills can be uninstalled) */
  hideUninstall?: boolean;
}
