import React, { useState } from 'react';
import { Avatar, Button, Message, Modal, Upload } from '@arco-design/web-react';
import { IconUser } from '@arco-design/web-react/icon';
import { useTranslation } from 'react-i18next';
import * as ipcBridge from '@sudowork/host-bridge/ipcBridge';
import { useAuth } from '@renderer/context/AuthContext';
import profileBoy from '@renderer/assets/profile_boy.jpg';
import profileGirl from '@renderer/assets/profile_girl.jpg';

function readImage(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('image_read_failed'));
    reader.readAsDataURL(blob);
  });
}

export default function EnterpriseAvatar() {
  const { t } = useTranslation();
  const { enterpriseProfile, refreshEnterpriseProfile } = useAuth();
  const [isOpen, setOpen] = useState(false);
  const [isSaving, setSaving] = useState(false);
  const [candidate, setCandidate] = useState<string | null>(null);

  const onSelect = async (blob: Blob) => {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(blob.type) || blob.size > 2 * 1024 * 1024) {
      Message.error(t('settings.accountAvatar.fileHint'));
      return;
    }
    try {
      setCandidate(await readImage(blob));
    } catch {
      Message.error(t('settings.userProfile.updateFailed'));
    }
  };
  const onPreset = async (src: string) => {
    try {
      await onSelect(await (await fetch(src)).blob());
    } catch {
      Message.error(t('settings.userProfile.updateFailed'));
    }
  };
  const onSave = async () => {
    if (isSaving) return;
    setSaving(true);
    try {
      const result = await ipcBridge.eeclaw.updateUserAvatar.invoke({ avatar: candidate });
      if (!result.success) throw new Error(result.msg);
      await refreshEnterpriseProfile();
      setOpen(false);
      Message.success(t('settings.accountAvatar.updated'));
    } catch {
      Message.error(t('settings.userProfile.updateFailed'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <div className='flex flex-col items-center gap-2'>
        <Avatar size={64}>{enterpriseProfile?.avatar ? <img src={enterpriseProfile.avatar} alt={t('settings.accountAvatar.title')} /> : <IconUser />}</Avatar>
        <Button
          size='mini'
          disabled={!enterpriseProfile}
          onClick={() => {
            setCandidate(enterpriseProfile?.avatar || null);
            setOpen(true);
          }}
        >
          {t('settings.accountAvatar.title')}
        </Button>
      </div>
      <Modal
        title={t('settings.accountAvatar.title')}
        visible={isOpen}
        onOk={onSave}
        confirmLoading={isSaving}
        onCancel={() => {
          if (!isSaving) setOpen(false);
        }}
        okText={t('common.save')}
        cancelText={t('common.cancel')}
      >
        <div className='flex flex-col gap-4 items-center'>
          <Avatar size={96}>{candidate ? <img src={candidate} alt={t('settings.accountAvatar.preview')} /> : <IconUser />}</Avatar>
          <div className='flex gap-4'>
            {[profileBoy, profileGirl].map((src, index) => (
              <Button key={src} disabled={isSaving} onClick={() => void onPreset(src)}>
                {t('settings.accountAvatar.preset', { number: index + 1 })}
              </Button>
            ))}
          </div>
          <Upload
            accept='image/png,image/jpeg,image/webp'
            disabled={isSaving}
            showUploadList={false}
            beforeUpload={async (file) => {
              await onSelect(file);
              return false;
            }}
          >
            <Button disabled={isSaving}>{t('settings.accountAvatar.upload')}</Button>
          </Upload>
          <Button disabled={isSaving} onClick={() => setCandidate(null)}>
            {t('settings.accountAvatar.reset')}
          </Button>
          <div className='text-secondary text-12px'>{t('settings.accountAvatar.fileHint')}</div>
        </div>
      </Modal>
    </>
  );
}
