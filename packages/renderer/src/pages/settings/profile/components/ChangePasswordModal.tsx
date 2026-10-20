/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Modal, Input, Message } from '@arco-design/web-react';
import { Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { validatePassword } from '@renderer/utils/passwordValidation';
import { useAuth } from '@renderer/context/AuthContext';

function ChangePasswordModal({ visible, onClose, isEnterprise = false }: IChangePasswordModalProps) {
  const { t } = useTranslation();
  const { changePassword, logout } = useAuth();
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setLoading] = useState(false);

  // 每次打开重置输入，避免上一次残留
  useEffect(() => {
    if (visible) {
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
    }
  }, [visible]);

  const onSubmit = async () => {
    if (isLoading) return;
    if (!oldPassword) {
      Message.warning(t('settings.changePassword.oldPasswordRequired', '请输入原始密码'));
      return;
    }
    if (!newPassword) {
      Message.warning(t('settings.changePassword.newPasswordRequired', '请输入新密码'));
      return;
    }
    const pwdError = validatePassword(newPassword);
    if (pwdError) {
      Message.error(t(pwdError));
      return;
    }
    if (newPassword !== confirmPassword) {
      Message.warning(t('settings.changePassword.mismatch'));
      return;
    }
    setLoading(true);
    try {
      const result = await changePassword({ oldPassword, newPassword });
      if (result.success) {
        Message.success(t('settings.changePassword.success', '密码修改成功'));
        onClose();
        if (isEnterprise) {
          await logout();
          Message.success(t('settings.changePassword.signInAgain'));
        }
      } else {
        // 失败保留弹窗，提示错误
        Message.error(result.message);
      }
    } catch {
      Message.error(t('settings.userProfile.updateFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={t('settings.changePassword.title', '修改密码')}
      visible={visible}
      onOk={onSubmit}
      onCancel={() => {
        if (!isLoading) onClose();
      }}
      okText={t('settings.changePassword.confirm', '确认修改')}
      cancelText={t('settings.changePassword.cancel', '取消')}
      confirmLoading={isLoading}
    >
      <div className='flex flex-col gap-4'>
        <div className='flex flex-col gap-2'>
          <div className='text-12px font-600 text-secondary ml-1'>{t('settings.changePassword.oldPasswordLabel', '原始密码')}</div>
          <Input.Password disabled={isLoading} size='large' prefix={<Lock size={16} />} placeholder={t('settings.changePassword.oldPasswordPlaceholder', '请输入原始密码')} value={oldPassword} onChange={setOldPassword} maxLength={20} className='!rd-12px h-10' />
        </div>
        <div className='flex flex-col gap-2'>
          <div className='text-12px font-600 text-secondary ml-1'>{t('settings.changePassword.newPasswordLabel', '新密码')}</div>
          <Input.Password disabled={isLoading} size='large' prefix={<Lock size={16} />} placeholder={t('settings.changePassword.newPasswordPlaceholder', '8-20 位，含大写、小写、数字')} value={newPassword} onChange={setNewPassword} maxLength={20} className='!rd-12px h-10' />
          <div className='text-12px text-secondary ml-1'>{t('settings.changePassword.ruleHint', '8-20 位，需同时包含大写字母、小写字母和数字。')}</div>
        </div>
        <Input.Password disabled={isLoading} aria-label={t('settings.changePassword.confirmPassword')} placeholder={t('settings.changePassword.confirmPassword')} value={confirmPassword} onChange={setConfirmPassword} maxLength={20} />
      </div>
    </Modal>
  );
}

interface IChangePasswordModalProps {
  visible: boolean;
  onClose: () => void;
  isEnterprise?: boolean;
}

export default ChangePasswordModal;
