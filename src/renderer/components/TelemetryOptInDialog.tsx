/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * TelemetryOptInDialog - 遥测授权弹窗
 *
 * 用户首次启动应用时显示，询问是否允许收集匿名使用数据
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Button, Checkbox } from '@arco-design/web-react';
import { ipcBridge } from '@/common';
import { useTranslation } from 'react-i18next';
import AionModal from './base/AionModal';
import { Shield, Close } from '@icon-park/react';

interface TelemetryOptInDialogProps {
  /** 是否显示弹窗 */
  visible: boolean;
  /** 关闭弹窗回调 */
  onClose: (allowed: boolean) => void;
}

/**
 * 遥测授权弹窗组件
 */
const TelemetryOptInDialog: React.FC<TelemetryOptInDialogProps> = ({ visible, onClose }) => {
  const { t } = useTranslation();
  const [allowTelemetry, setAllowTelemetry] = useState(true);
  const [loading, setLoading] = useState(false);

  // 重置状态
  useEffect(() => {
    if (visible) {
      setAllowTelemetry(true);
      setLoading(false);
    }
  }, [visible]);

  const handleConfirm = useCallback(async () => {
    setLoading(true);
    try {
      // 保存用户选择
      await ipcBridge.telemetry.setEnabled.invoke({ enabled: allowTelemetry });
      await ipcBridge.telemetry.setOptInShown.invoke();

      onClose(allowTelemetry);
    } catch (error) {
      console.error('[TelemetryOptIn] Failed to save preference:', error);
      onClose(false);
    } finally {
      setLoading(false);
    }
  }, [allowTelemetry, onClose]);

  const handleSkip = useCallback(() => {
    // 用户选择稍后提醒，不保存选择
    onClose(false);
  }, [onClose]);

  const footer = (
    <div className="flex justify-end gap-12px pt-16px border-t border-[var(--bg-3)]">
      <Button
        onClick={handleSkip}
        className="px-20px min-w-80px rd-8px"
      >
        {t('telemetry.optIn.skip', '稍后提醒')}
      </Button>
      <Button
        type="primary"
        onClick={handleConfirm}
        loading={loading}
        className="px-20px min-w-80px rd-8px"
      >
        {t('telemetry.optIn.confirm', '确认')}
      </Button>
    </div>
  );

  const header = {
    render: () => (
      <div className="flex items-center justify-between w-full pb-20px border-b border-[var(--bg-3)]">
        <h3 className="text-16px font-600 text-t-primary m-0">
          {t('telemetry.optIn.title', '帮助我们改进 Sudowork')}
        </h3>
        <button
          onClick={handleSkip}
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
      onCancel={handleSkip}
      header={header}
      footer={{ render: () => footer, style: { padding: '0 20px 20px' } }}
      size="small"
      contentStyle={{ padding: '20px' }}
      className="telemetry-opt-in-dialog"
    >
      <div className="flex flex-col gap-16px">
        {/* 说明内容 */}
        <div className="text-14px text-t-secondary leading-relaxed">
          {t(
            'telemetry.optIn.description',
            '为了持续优化您的使用体验，我们希望收集匿名使用数据。'
          )}
        </div>

        {/* 隐私保障 */}
        <div className="flex items-start gap-10px p-12px rd-10px bg-[var(--bg-2)]">
          <Shield size={18} fill="var(--success)" className="flex-shrink-0 mt-1px" />
          <div className="text-13px text-t-secondary leading-relaxed">
            {t(
              'telemetry.optIn.privacy',
              '开启后将匿名收集性能指标数据，仅用于产品改进，不会收集您的对话内容或个人信息。您可以随时在设置中关闭此功能。'
            )}
          </div>
        </div>

        {/* 勾选框 */}
        <Checkbox
          checked={allowTelemetry}
          onChange={(checked) => setAllowTelemetry(checked)}
          className="text-14px"
        >
          {t('telemetry.optIn.checkbox', '允许收集匿名使用数据')}
        </Checkbox>
      </div>
    </AionModal>
  );
};

export default TelemetryOptInDialog;