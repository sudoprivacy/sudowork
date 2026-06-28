import React, { useCallback } from 'react';
import { Button, Modal } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { Shield } from '@icon-park/react';

/**
 * 产品体验改进计划弹窗组件
 */
export default function OptInDialog({ isOpen, onClose }: IOptInDialogProps) {
  const { t } = useTranslation();

  const handleConfirm = useCallback(() => {
    onClose(true);
  }, [onClose]);

  const handleCancel = useCallback(() => {
    onClose(false);
  }, [onClose]);

  const footer = (
    <div className='flex justify-end gap-3'>
      <Button onClick={handleCancel}>{t('settings.productImprovement.cancel', '暂不开启')}</Button>
      <Button type='primary' onClick={handleConfirm}>
        {t('settings.productImprovement.confirm', '确认开启')}
      </Button>
    </div>
  );

  return (
    <Modal title={t('settings.productImprovement.dialogTitle', '产品体验改进计划')} visible={isOpen} onCancel={handleCancel} footer={footer} style={{ width: 420 }}>
      <div className='flex flex-col gap-4'>
        {/* 说明内容 */}
        <div className='text-14px text-secondary leading-relaxed'>{t('settings.productImprovement.description', '帮助我们持续优化产品体验，为您带来更好的服务。')}</div>

        {/* 隐私保障 */}
        <div className='flex items-start gap-2.5 p-3 rd-10px bg-muted'>
          <Shield size={18} fill='var(--success)' className='flex-shrink-0 mt-px' />
          <div className='text-13px text-secondary leading-relaxed'>{t('settings.productImprovement.privacy', '开启后将匿名收集 SudoWork 性能指标，仅用于产品改进，不会收集您的对话内容或个人信息。您可以随时关闭此功能。')}</div>
        </div>
      </div>
    </Modal>
  );
}

interface IOptInDialogProps {
  /** 是否显示弹窗 */
  isOpen: boolean;
  /** 关闭弹窗回调 - confirmed 表示用户是否确认开启 */
  onClose: (confirmed: boolean) => void;
}
