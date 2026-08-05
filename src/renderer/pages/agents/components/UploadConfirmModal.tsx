/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Avatar, Modal } from '@arco-design/web-react';
import { Bot } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import React from 'react';
import type { AssistantListItem } from '../types';
import { isEmoji, resolveAvatarImageSrc } from '../utils';

export default function UploadConfirmModal({ isVisible, isUploading, assistant, localeKey, onCancel, onConfirm }: IUploadConfirmModalProps) {
  const { t } = useTranslation();

  return (
    <Modal
      title={t('settings.uploadAssistantTitle', '上传智能体')}
      visible={isVisible}
      onCancel={onCancel}
      onOk={onConfirm}
      okText={t('common.confirm', '确认')}
      cancelText={t('common.cancel', '取消')}
      confirmLoading={isUploading}
      className='w-[90vw] md:w-[400px]'
      wrapStyle={{ zIndex: 10000 }}
      maskStyle={{ zIndex: 9999 }}
    >
      <p className='mt-0'>{t('settings.uploadAssistantConfirm', 'Confirm upload this agent to the agent store? Other users in the same tenant will be able to download and use it after upload.')}</p>
      {/* Agent preview */}
      {assistant && (
        <div className='mt-3 p-3 bg-control rounded-xl flex items-center gap-3'>
          <Avatar.Group size={32}>
            <Avatar className='!border-none bg-transparent' shape='square'>
              {(() => {
                const resolvedAvatar = assistant.avatar?.trim();
                const avatarImg = resolveAvatarImageSrc(resolvedAvatar);
                const hasEmoji = Boolean(resolvedAvatar && isEmoji(resolvedAvatar));
                if (avatarImg) return <img src={avatarImg} alt='' width={19} height={19} style={{ objectFit: 'contain' }} />;
                if (hasEmoji) return <span style={{ fontSize: 19 }}>{resolvedAvatar}</span>;
                return <Bot size={16} />;
              })()}
            </Avatar>
          </Avatar.Group>
          <div>
            <div className='font-medium'>{assistant.nameI18n?.[localeKey] || assistant.name}</div>
            <div className='text-12px text-secondary line-clamp-2'>{assistant.descriptionI18n?.[localeKey] || assistant.description}</div>
          </div>
        </div>
      )}
    </Modal>
  );
}

interface IUploadConfirmModalProps {
  isVisible: boolean;
  isUploading: boolean;
  assistant: AssistantListItem | null;
  localeKey: string;
  onCancel: () => void;
  onConfirm: () => void;
}
