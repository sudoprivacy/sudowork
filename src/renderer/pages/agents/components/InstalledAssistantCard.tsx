import React from 'react';
import { Button, Popconfirm, Switch, Tooltip } from '@arco-design/web-react';
import { Bot, Copy, Download, Eye, SquarePen, Trash2, Upload, Zap } from 'lucide-react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import type { AssistantListItem } from '../types';
import { normalizeAssistantVersion, resolveAvatarImageSrc } from '../utils';

const InstalledAssistantCard: React.FC<InstalledAssistantCardProps> = (props) => {
  const { assistant, isExtension, localeKey } = props;
  const { onToggleEnabled, onDelete, onDuplicate, onUpdate, hasUpdate, updating, onUpload, onClick } = props;
  const { uploadStatus, enterprisePublishButton, hideDelete, allowToggle, allowDelete, enterpriseMode } = props;
  const { t } = useTranslation();
  const isCustom = enterpriseMode ? assistant._category === 'custom' || (!assistant._category && !assistant.isBuiltin && !isExtension && !assistant._isHubInstalled) : !assistant.isBuiltin && !isExtension && !assistant._isHubInstalled;
  const isReadonly = assistant.isBuiltin || isExtension || assistant._isHubInstalled || hideDelete || (enterpriseMode && !isCustom);
  const canToggle = !isExtension && (isCustom || allowToggle === true);
  const canDelete = !isExtension && !assistant.isBuiltin && !hideDelete && (!isReadonly || allowDelete === true);
  const isEnabled = isExtension ? true : assistant.enabled !== false;

  const resolvedAvatar = assistant.avatar?.trim();
  const emojiRegex = /^(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:\u200D(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F))*$/u;
  const hasEmojiAvatar = Boolean(resolvedAvatar && emojiRegex.test(resolvedAvatar));

  const avatarImage = resolveAvatarImageSrc(resolvedAvatar);
  const displayName = assistant.nameI18n?.[localeKey] || assistant.name;
  const description = assistant.descriptionI18n?.[localeKey] || assistant.description || '';
  const displayVersion = enterpriseMode ? '' : normalizeAssistantVersion(assistant._installedVersion);

  return (
    <div className={classNames('card group flex items-start gap-3 relative overflow-hidden', !isEnabled && 'opacity-65')} onClick={onClick}>
      {/* Avatar */}
      <div className='w-48px flex-shrink-0'>
        <div className='size-12 rd-8px overflow-hidden bg-control'>
          {avatarImage ? (
            <img src={avatarImage} alt={displayName} className='w-full h-full object-cover' />
          ) : hasEmojiAvatar ? (
            <div className='w-full h-full f-center text-22px'>{resolvedAvatar}</div>
          ) : (
            <div className='w-full h-full f-center'>
              <Bot size={22} className='text-primary' />
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className='flex-1 min-w-0'>
        <div className='h-5 flex items-center'>
          <span className='font-medium text-13px text-foreground truncate' title={displayName.length > 15 ? displayName : undefined}>
            {displayName.length > 15 ? `${displayName.slice(0, 15)}...` : displayName}
          </span>
          {displayVersion && !assistant.isBuiltin && <span className='ml-1.5 px-5px py-0 bg-control text-secondary text-10px rd-3px whitespace-nowrap flex-shrink-0 leading-18px'>v{displayVersion}</span>}
        </div>
        <div className='my-1'>{description ? <div className='text-11px text-secondary line-clamp-2 leading-15px'>{description}</div> : null}</div>
        {assistant.enabledSkills && assistant.enabledSkills.length > 0 && (
          <div className='flex items-center gap-1'>
            <Zap size={12} className='text-primary flex-shrink-0' />
            <span className='text-10px text-secondary'>{t('settings.assistant.relatedSkills', { count: assistant.enabledSkills.length, defaultValue: `${assistant.enabledSkills.length} 个关联技能` })}</span>
          </div>
        )}
      </div>

      {/* Top-right: edit/view + upload (custom only) + duplicate button + shield (builtin) or delete (custom) */}
      <div className='absolute top-2.5 right-2.5 flex items-center gap-3' onClick={(e) => e.stopPropagation()}>
        {/* Edit/View button - custom assistants show edit, readonly assistants show view */}
        {hasUpdate && (
          <Tooltip content={t('settings.assistant.updateAvailable', '可更新')}>
            <Button
              type='text'
              shape='circle'
              className='store-action-icon'
              loading={updating}
              icon={<Download size={13} />}
              onClick={(e) => {
                e.stopPropagation();
                onUpdate?.();
              }}
            />
          </Tooltip>
        )}
        <Tooltip content={isReadonly ? t('settings.assistant.view', '查看') : t('settings.assistant.edit', '编辑')}>
          <Button shape='circle' className='!size-7' icon={isReadonly ? <Eye size={13} /> : <SquarePen size={13} />} onClick={onClick} />
        </Tooltip>
        {/* Upload button - only for custom assistants */}
        {isCustom && onUpload && (
          <Tooltip content={t('settings.assistant.upload', '上传')}>
            <Button shape='circle' className='!size-7' icon={<Upload size={13} />} onClick={onUpload} />
          </Tooltip>
        )}
        {uploadStatus}
        {/* Duplicate button - available for all assistant types */}
        <Tooltip content={t('settings.assistant.duplicate', '复制')}>
          <Button shape='circle' className='!size-7' icon={<Copy size={13} />} onClick={onDuplicate} />
        </Tooltip>
        {enterprisePublishButton}
        {/* Delete button - only for custom assistants that are not readonly */}
        {canDelete && (
          <Popconfirm title={t('settings.deleteAssistantConfirmTitle', '删除该助手会一并删除已关联会话。如需保留，请导出会话进行备份。是否确认删除？')} onOk={onDelete} okText={t('common.delete', '删除')} cancelText={t('common.cancel', '取消')} okButtonProps={{ status: 'danger' }}>
            <Tooltip content={t('settings.assistant.delete', '删除')}>
              <Button shape='circle' status='danger' className='!size-7' icon={<Trash2 size={13} />} />
            </Tooltip>
          </Popconfirm>
        )}
        {canToggle && <Switch size='small' checked={isEnabled} onChange={(checked) => onToggleEnabled(checked)} className={isEnabled ? '!bg-primary !border-[var(--ui-accent-orange)]' : ''} />}
      </div>
    </div>
  );
};

type InstalledAssistantCardProps = {
  assistant: AssistantListItem;
  isExtension: boolean;
  localeKey: string;
  onToggleEnabled: (_enabled: boolean) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onUpdate?: () => void;
  hasUpdate?: boolean;
  updating?: boolean;
  onUpload?: () => void;
  uploadStatus?: React.ReactNode;
  onClick: () => void;
  /** Enterprise mode: publish button element */
  enterprisePublishButton?: React.ReactNode;
  /** Enterprise mode: whether to hide delete button (only custom assistants can be deleted) */
  hideDelete?: boolean;
  /** Whether to show enable/disable switch for read-only installed assistants. */
  allowToggle?: boolean;
  /** Whether to show delete button for read-only installed assistants. */
  allowDelete?: boolean;
  /** Enterprise mode: use directory category to distinguish custom/hub/tenant assistants. */
  enterpriseMode?: boolean;
};

export default InstalledAssistantCard;
