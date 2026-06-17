import React, { useEffect, useState } from 'react';
import { Modal, Input, Message } from '@arco-design/web-react';
import { Lock } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../../context/AuthContext';
import { validatePassword } from '@/renderer/utils/passwordValidation';

interface ChangePasswordModalProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * 修改密码弹窗（仅 login_method=1 时由 UserProfile 挂载）。
 * 自包含：必填 + 密码强度校验 → changePassword；成功提示并关闭，失败提示且保留弹窗。
 */
const ChangePasswordModal: React.FC<ChangePasswordModalProps> = ({ visible, onClose }) => {
  const { t } = useTranslation();
  const { changePassword } = useAuth();
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);

  // 每次打开重置输入，避免上一次残留
  useEffect(() => {
    if (visible) {
      setOldPassword('');
      setNewPassword('');
    }
  }, [visible]);

  const handleSubmit = async () => {
    if (!oldPassword) {
      Message.warning(t('settings.changePassword.oldPasswordRequired'));
      return;
    }
    if (!newPassword) {
      Message.warning(t('settings.changePassword.newPasswordRequired'));
      return;
    }
    const pwdError = validatePassword(newPassword);
    if (pwdError) {
      Message.error(t(pwdError));
      return;
    }
    setLoading(true);
    try {
      const result = await changePassword({ oldPassword, newPassword });
      if (result.success) {
        Message.success(t('settings.changePassword.success'));
        onClose();
      } else {
        // 失败保留弹窗，提示错误
        Message.error(result.message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal title={t('settings.changePassword.title')} visible={visible} onOk={handleSubmit} onCancel={onClose} okText={t('settings.changePassword.confirm')} cancelText={t('settings.changePassword.cancel')} confirmLoading={loading}>
      <div className='flex flex-col gap-16px'>
        <div className='flex flex-col gap-8px'>
          <div className='text-12px font-600 text-secondary ml-4px'>{t('settings.changePassword.oldPasswordLabel')}</div>
          <Input.Password size='large' prefix={<Lock className='text-tertiary' />} placeholder={t('settings.changePassword.oldPasswordPlaceholder')} value={oldPassword} onChange={setOldPassword} maxLength={20} className='!rd-12px h-40px' />
        </div>
        <div className='flex flex-col gap-8px'>
          <div className='text-12px font-600 text-secondary ml-4px'>{t('settings.changePassword.newPasswordLabel')}</div>
          <Input.Password size='large' prefix={<Lock className='text-tertiary' />} placeholder={t('settings.changePassword.newPasswordPlaceholder')} value={newPassword} onChange={setNewPassword} maxLength={20} className='!rd-12px h-40px' />
          <div className='text-12px text-tertiary ml-4px'>{t('settings.changePassword.ruleHint')}</div>
        </div>
      </div>
    </Modal>
  );
};

export default ChangePasswordModal;
