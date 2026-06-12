/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ProductImprovementDialog - 产品体验改进计划弹窗
 *
 * 用户开启产品体验改进计划时显示
 */

import React, { useCallback } from 'react';
import { Button } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import AionModal from './base/AionModal';
import { Shield, Close } from '@icon-park/react';

interface ProductImprovementDialogProps {
  /** 是否显示弹窗 */
  visible: boolean;
  /** 关闭弹窗回调 - confirmed 表示用户是否确认开启 */
  onClose: (confirmed: boolean) => void;
}

/**
 * 产品体验改进计划弹窗组件
 */
const ProductImprovementDialog: React.FC<ProductImprovementDialogProps> = ({ visible, onClose }) => {
  const { t } = useTranslation();

  const handleConfirm = useCallback(() => {
    onClose(true);
  }, [onClose]);

  const handleCancel = useCallback(() => {
    onClose(false);
  }, [onClose]);

  const footer = (
    <div className="flex justify-end gap-12px pt-16px border-t border-[var(--bg-3)]">
      <Button
        onClick={handleCancel}
        className="px-20px min-w-80px rd-8px"
      >
        {t('settings.productImprovement.cancel', '暂不开启')}
      </Button>
      <Button
        type="primary"
        onClick={handleConfirm}
        className="px-20px min-w-80px rd-8px"
      >
        {t('settings.productImprovement.confirm', '确认开启')}
      </Button>
    </div>
  );

  const header = {
    render: () => (
      <div className="flex items-center justify-between w-full pb-20px border-b border-[var(--bg-3)]">
        <h3 className="text-16px font-600 text-t-primary m-0">
          {t('settings.productImprovement.dialogTitle', '产品体验改进计划')}
        </h3>
        <button
          onClick={handleCancel}
          className="w-32px h-32px flex items-center justify-center rd-8px transition-colors cursor-pointer border-0 bg-transparent p-0 hover:bg-2 focus:outline-none"
          aria-label="Close"
        >
          <Close size={20} fill="#86909c" />
        </button>
      </div>
    ),
  };

  return (
    <AionModal
      visible={visible}
      onCancel={handleCancel}
      header={header}
      footer={{ render: () => footer, style: { padding: '0 20px 20px' } }}
      size="small"
      contentStyle={{ padding: '20px' }}
      className="product-improvement-dialog"
    >
      <div className="flex flex-col gap-16px">
        {/* 说明内容 */}
        <div className="text-14px text-t-secondary leading-relaxed">
          {t(
            'settings.productImprovement.description',
            '帮助我们持续优化产品体验，为您带来更好的服务。'
          )}
        </div>

        {/* 隐私保障 */}
        <div className="flex items-start gap-10px p-12px rd-10px bg-[var(--bg-2)]">
          <Shield size={18} fill="var(--success)" className="flex-shrink-0 mt-1px" />
          <div className="text-13px text-t-secondary leading-relaxed">
            {t(
              'settings.productImprovement.privacy',
              '开启后将匿名收集 SudoWork 性能指标，仅用于产品改进，不会收集您的对话内容或个人信息。您可以随时关闭此功能。'
            )}
          </div>
        </div>
      </div>
    </AionModal>
  );
};

export default ProductImprovementDialog;