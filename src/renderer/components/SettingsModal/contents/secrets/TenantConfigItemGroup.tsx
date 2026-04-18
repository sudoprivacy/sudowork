/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { SUDOWORK_SERVER_BASE_URL } from '@/common/sudoworkServer';
import { Button, Collapse, Input, Message, Switch } from '@arco-design/web-react';
import configItemDefaultIcon from '@/renderer/assets/config-item-default.svg';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import PreferenceRow from './PreferenceRow';
import type { TenantConfigItem, TenantConfigValues } from './types';

const ConfigItemIcon: React.FC<{ iconUrl?: string; name: string }> = ({ iconUrl, name }) => {
  const [useDefault, setUseDefault] = useState(false);

  useEffect(() => {
    setUseDefault(false);
  }, [iconUrl]);

  const src = useDefault || !iconUrl ? configItemDefaultIcon : `${SUDOWORK_SERVER_BASE_URL}${iconUrl}`;

  return <img src={src} alt={name} className='w-14px h-14px object-contain shrink-0' onError={() => setUseDefault(true)} />;
};

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
    const emptyEntry = configItem.entries.find((entry) => !localValues[entry.config_key]?.trim());
    if (emptyEntry) {
      Message.warning(t('settings.secrets.tenantFieldRequired', '请填写所有配置项'));
      return;
    }
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
  }, [localValues, onSave, enabled, onToggleEnabled, t, configItem.entries]);

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
          <div className='flex items-center justify-between group'>
            <div className='flex items-center gap-8px flex-1 min-w-0'>
              <ConfigItemIcon iconUrl={configItem.icon_url} name={configItem.name} />
              <span className='text-14px text-t-primary'>{configItem.name}</span>
            </div>
            <div className='flex items-center gap-2' onClick={(e) => e.stopPropagation()}>
              <Switch
                size='small'
                checked={enabled}
                onChange={handleToggle}
              />
            </div>
          </div>
        }
        name={`tenant-${configItem.id}`}
        className='[&_div.arco-collapse-item-content-box]:py-3'
      >
        <div className='flex flex-col gap-24px'>
          <div className='bg-fill-1 rd-12px pt-16px pr-16px pb-16px pl-0'>
            {configItem.entries.map((entry) => (
              <PreferenceRow key={entry.id} label={entry.name} description={entry.config_desc || undefined} required>
                <Input
                  value={localValues[entry.config_key] || ''}
                  onChange={(val) => handleValueChange(entry.config_key, val)}
                  placeholder={entry.config_key}
                  style={{ width: 240 }}
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
