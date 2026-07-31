/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Form, Tooltip } from '@arco-design/web-react';
import { FolderOpen } from 'lucide-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';

/**
 * 目录选择输入组件 / Directory selection input component
 * 用于选择和显示系统目录路径 / Used for selecting and displaying system directory paths
 */
export default function DirInputItem({ label, field }: IDirInputItemProps) {
  const { t } = useTranslation();

  return (
    <Form.Item label={label} field={field}>
      {(_value, form) => {
        const currentValue = form.getFieldValue(field) || '';

        const handlePick = () => {
          ipcBridge.dialog.showOpen
            .invoke({
              defaultPath: currentValue,
              properties: ['openDirectory', 'createDirectory'],
            })
            .then((res) => {
              if (res?.success && res.data && !res.data.canceled && res.data.filePaths.length > 0) {
                form.setFieldValue(field, res.data.filePaths[0]);
              }
            })
            .catch((error) => {
              console.error('Failed to open directory dialog:', error);
            });
        };

        return (
          <div className='h-8 flex items-center rd-8px border border-border bg-secondary pl-3.5'>
            <Tooltip content={currentValue || t('settings.dirNotConfigured')} position='top'>
              <div className='flex-1 min-w-0 text-13px text-foreground truncate '>{currentValue || t('settings.dirNotConfigured')}</div>
            </Tooltip>
            <Button
              type='text'
              style={{ borderLeft: '1px solid var(--border)', borderRadius: '0 8px 8px 0' }}
              icon={<FolderOpen size={14} className='text-foreground' />}
              onClick={(e) => {
                e.stopPropagation();
                handlePick();
              }}
            />
          </div>
        );
      }}
    </Form.Item>
  );
}

interface IDirInputItemProps {
  /** 标签文本 / Label text */
  label: string;
  /** 表单字段名 / Form field name */
  field: string;
}
