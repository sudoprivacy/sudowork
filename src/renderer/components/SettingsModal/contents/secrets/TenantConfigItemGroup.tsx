/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Collapse, Input, Message, Switch } from '@arco-design/web-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TenantConfigItem, TenantConfigValues } from './types';

const PreferenceRow: React.FC<{ label: string; description?: React.ReactNode; children: React.ReactNode }> = ({
  label,
  description,
  children,
}) => (
  <div className='flex items-center justify-between gap-24px py-12px'>
    <div className='flex-1'>
      <div className='flex items-center gap-8px'>
        <span className='text-14px text-t-primary'>{label}</span>
      </div>
      {description && <div className='text-12px text-t-tertiary mt-2px'>{description}</div>}
    </div>
    <div className='flex items-center'>{children}</div>
  </div>
);

interface TenantConfigItemGroupProps {
  configItem: TenantConfigItem;
  values: TenantConfigValues;
  enabled: boolean;
  saving: boolean;
  onToggleEnabled: (enabled: boolean) => void;
  onSave: (values: TenantConfigValues) => Promise<boolean>;
}

const TenantConfigItemGroup: React.FC<TenantConfigItemGroupProps> = ({
  configItem,
  values: externalValues,
  enabled,
  saving,
  onToggleEnabled,
  onSave,
}) => {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(true);
  const [localValues, setLocalValues] = useState<TenantConfigValues>(externalValues);

  useEffect(() => {
    setLocalValues(externalValues);
  }, [externalValues]);

  const handleValueChange = useCallback((configKey: string, value: string) => {
    setLocalValues((prev) => ({ ...prev, [configKey]: value }));
  }, []);

  const handleSave = useCallback(async () => {
    const success = await onSave(localValues);
    if (success) {
      Message.success(t('settings.secrets.tenantSaveSuccess', '配置保存成功'));
      // Auto-enable after successful save (matching JsbConfigForm pattern)
      if (!enabled) {
        onToggleEnabled(true);
      }
    } else {
      Message.error(t('settings.secrets.tenantSaveFailed', '配置保存失败'));
    }
  }, [localValues, onSave, enabled, onToggleEnabled, t]);

  const handleToggle = useCallback(
    (checked: boolean) => {
      void onToggleEnabled(checked);
    },
    [onToggleEnabled],
  );

  return (
    <Collapse
      activeKey={collapsed ? [] : [`tenant-${configItem.id}`]}
      onChange={() => setCollapsed((prev) => !prev)}
      className='[&_div.arco-collapse-item-header-title]:flex-1'
    >
      <Collapse.Item
        header={
          <div className='flex items-center justify-between gap-8px'>
            <span className='text-14px text-t-primary'>{configItem.name}</span>
            <Switch
              size='small'
              checked={enabled}
              onChange={handleToggle}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        }
        name={`tenant-${configItem.id}`}
        className='[&_div.arco-collapse-item-content-box]:py-3'
      >
        <div className='flex flex-col gap-24px'>
          <div className='bg-fill-1 rd-12px pt-16px pr-16px pb-16px pl-0'>
            {configItem.entries.map((entry) => (
              <PreferenceRow key={entry.id} label={entry.config_desc || entry.config_key}>
                <Input
                  value={localValues[entry.config_key] || ''}
                  onChange={(val) => handleValueChange(entry.config_key, val)}
                  placeholder={entry.config_key}
                  style={{ width: 280 }}
                  disabled={enabled || saving}
                />
              </PreferenceRow>
            ))}
          </div>
          <div className='flex justify-end'>
            <Button type='primary' loading={saving} disabled={enabled} onClick={handleSave}>
              {t('settings.secrets.save', '保存')}
            </Button>
          </div>
        </div>
      </Collapse.Item>
    </Collapse>
  );
};

export default TenantConfigItemGroup;
