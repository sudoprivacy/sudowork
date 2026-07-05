import { Avatar, Modal } from '@arco-design/web-react';
import { Bot } from 'lucide-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { IAssistantHubSkill } from '@/common/ipcBridge';
import type { AssistantListItem } from '../types';
import { resolveAvatarImageSrc } from '../utils';

const EMOJI_RE = /^(?:\p{Emoji_Presentation}|\p{Emoji}️)(?:‍(?:\p{Emoji_Presentation}|\p{Emoji}️))*$/u;

function AvatarPreview({ name, description, children }: { name: string; description?: string; children: React.ReactNode }) {
  return (
    <div className='mt-3 p-3 bg-fill-2 rounded-lg flex items-center gap-3'>
      <Avatar.Group size={32}>
        <Avatar className='border-none' shape='square' style={{ backgroundColor: 'var(--color-fill-2)', border: 'none' }}>
          {children}
        </Avatar>
      </Avatar.Group>
      <div>
        <div className='font-medium'>{name}</div>
        {description && <div className='text-12px text-secondary line-clamp-2'>{description}</div>}
      </div>
    </div>
  );
}

export default function DuplicateConfirmModal({ visible, duplicateAssistant, duplicateInstalledAssistant, localeKey, onCancel, onConfirm }: IDuplicateConfirmModalProps) {
  const { t } = useTranslation();

  const displayName = duplicateAssistant ? duplicateAssistant.display_name || duplicateAssistant.name : duplicateInstalledAssistant?.nameI18n?.[localeKey] || duplicateInstalledAssistant?.name;

  return (
    <Modal title={t('settings.duplicateAssistantTitle', '复制智能体')} visible={visible} onCancel={onCancel} onOk={onConfirm} okText={t('common.confirm', '确认')} cancelText={t('common.cancel', '取消')} className='w-[90vw] md:w-[400px]' wrapStyle={{ zIndex: 10000 }} maskStyle={{ zIndex: 9999 }}>
      <p>{t('settings.duplicateAssistantConfirm', 'Confirm duplicate this agent to the custom list? After duplication, you can edit it in "My Agents".')}</p>

      {duplicateAssistant && (
        <AvatarPreview name={duplicateAssistant.display_name || duplicateAssistant.name} description={duplicateAssistant.description}>
          {(() => {
            const resolvedAvatar = duplicateAssistant.avatar?.trim();
            const hasEmoji = Boolean(resolvedAvatar && EMOJI_RE.test(resolvedAvatar));
            if (resolvedAvatar && !hasEmoji) return <img src={resolvedAvatar} alt='' width={19} height={19} style={{ objectFit: 'contain' }} />;
            if (hasEmoji) return <span style={{ fontSize: 19 }}>{resolvedAvatar}</span>;
            return <Bot size={16} />;
          })()}
        </AvatarPreview>
      )}

      {duplicateInstalledAssistant && (
        <AvatarPreview name={duplicateInstalledAssistant.nameI18n?.[localeKey] || duplicateInstalledAssistant.name} description={duplicateInstalledAssistant.descriptionI18n?.[localeKey] || duplicateInstalledAssistant.description}>
          {(() => {
            const resolvedAvatar = duplicateInstalledAssistant.avatar?.trim();
            const avatarImg = resolveAvatarImageSrc(resolvedAvatar);
            const hasEmoji = Boolean(resolvedAvatar && EMOJI_RE.test(resolvedAvatar));
            if (avatarImg) return <img src={avatarImg} alt='' width={19} height={19} style={{ objectFit: 'contain' }} />;
            if (hasEmoji) return <span style={{ fontSize: 19 }}>{resolvedAvatar}</span>;
            return <Bot size={16} />;
          })()}
        </AvatarPreview>
      )}

      {displayName && (
        <div className='mt-3 p-3 rounded-lg'>
          <div className='text-12px text-primary'>
            {t('settings.duplicateAssistantNameHint', {
              name: displayName,
              defaultValue: `复制后的智能体名称: 自定义-${displayName}`,
            })}
          </div>
        </div>
      )}
    </Modal>
  );
}

interface IDuplicateConfirmModalProps {
  visible: boolean;
  duplicateAssistant: IAssistantHubSkill | null;
  duplicateInstalledAssistant: AssistantListItem | null;
  localeKey: string;
  onCancel: () => void;
  onConfirm: () => void;
}
