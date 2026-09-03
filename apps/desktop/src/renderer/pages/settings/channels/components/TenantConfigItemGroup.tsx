/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Collapse, Input, Message, Switch } from '@arco-design/web-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfigStorage } from '@sudowork/common/storage';
import { getSudoworkServerBaseUrl } from '@sudowork/common/sudoworkServer';
import { useAppMode } from '@/renderer/hooks/useAppMode';
import type { TenantConfigItem, TenantConfigValues } from '../types';
import { resolveConfigItemIconUrl, shouldBlockEnableUntilConfigured } from '../utils';
import PreferenceRow from './PreferenceRow';

const ConfigItemIcon: React.FC<{ iconUrl?: string; name: string }> = ({ iconUrl, name }) => {
  const [useDefault, setUseDefault] = useState(false);
  const { isEnterprise } = useAppMode();
  const [baseUrl, setBaseUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    setUseDefault(false);
  }, [iconUrl]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        if (isEnterprise) {
          const serverUrl = await ConfigStorage.get('eeclaw.serverUrl');
          if (mounted && typeof serverUrl === 'string') {
            setBaseUrl(serverUrl);
          }
        } else {
          const resolved = await getSudoworkServerBaseUrl();
          if (mounted) {
            setBaseUrl(resolved);
          }
        }
      } catch {
        // silent
      }
    })();
    return () => {
      mounted = false;
    };
  }, [isEnterprise]);

  const src = useDefault ? resolveConfigItemIconUrl(null) : resolveConfigItemIconUrl(iconUrl ?? null, baseUrl);

  return <img src={src} alt={name} className='size-4 object-contain shrink-0' onError={() => setUseDefault(true)} />;
};

interface TenantConfigItemGroupProps {
  configItem: TenantConfigItem;
  values: TenantConfigValues;
  enabled: boolean;
  saving: boolean;
  onToggleEnabled: (enabled: boolean) => void;
  onSave: (values: TenantConfigValues) => Promise<boolean>;
}

const TenantConfigItemGroup: React.FC<TenantConfigItemGroupProps> = ({ configItem, values: externalValues, enabled, saving, onToggleEnabled, onSave }) => {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(true);
  const [localValues, setLocalValues] = useState<TenantConfigValues>(externalValues);
  const statusText = enabled ? t('common.enabled', { defaultValue: '已启用' }) : t('settings.runtimeSettings.status.disabled', { defaultValue: '未启用' });
  const blockEnable = shouldBlockEnableUntilConfigured(configItem, localValues);

  useEffect(() => {
    setLocalValues(externalValues);
  }, [externalValues]);

  const handleValueChange = useCallback((configKey: string, value: string) => {
    setLocalValues((prev) => ({ ...prev, [configKey]: value }));
  }, []);

  const handleSave = useCallback(async () => {
    const emptyRequiredEntry = configItem.entries.find((entry) => entry.required === 1 && !localValues[entry.config_key]?.trim());
    if (emptyRequiredEntry) {
      Message.warning(
        t('settings.secrets.tenantFieldRequiredSpecific', '请填写：{{configItemName}} - {{entryName}}', {
          configItemName: configItem.name,
          entryName: emptyRequiredEntry.name,
        })
      );
      return;
    }
    const success = await onSave(localValues);
    if (success) {
      Message.success(t('settings.secrets.tenantSaveSuccess', '配置保存成功'));
      // Auto-enable after successful save
      if (!enabled) {
        onToggleEnabled(true);
      }
    } else {
      Message.error(t('settings.secrets.tenantSaveFailed', '配置保存失败'));
    }
  }, [localValues, onSave, enabled, onToggleEnabled, t, configItem.entries, configItem.name]);

  const handleToggle = useCallback(
    async (checked: boolean) => {
      if (!checked) {
        void onToggleEnabled(checked);
      } else {
        if (blockEnable) {
          Message.warning(t('settings.secrets.shareoneEnableBlocked', '请先填写 ShareOne API Key，再启用'));
          return;
        }
        const hasNewValues = configItem.entries.some((entry) => {
          const local = localValues[entry.config_key]?.trim() ?? '';
          const external = externalValues[entry.config_key]?.trim() ?? '';
          return local !== '' && local !== external;
        });
        if (hasNewValues) {
          const emptyRequired = configItem.entries.find((e) => e.required === 1 && !localValues[e.config_key]?.trim());
          if (emptyRequired) {
            Message.warning(
              t('settings.secrets.tenantFieldRequiredSpecific', '请填写：{{configItemName}} - {{entryName}}', {
                configItemName: configItem.name,
                entryName: emptyRequired.name,
              })
            );
            return;
          }
          const success = await onSave(localValues);
          if (success) {
            Message.success(t('settings.secrets.tenantSaveSuccess', '配置保存成功'));
            onToggleEnabled(true);
          } else {
            Message.error(t('settings.secrets.tenantSaveFailed', '配置保存失败'));
          }
        } else {
          setLocalValues(externalValues);
          void onToggleEnabled(checked);
        }
      }
    },
    [blockEnable, localValues, externalValues, onSave, onToggleEnabled, t, configItem.entries, configItem.name]
  );

  return (
    <div className='overflow-hidden rd-12px border'>
      <Collapse activeKey={collapsed ? [] : [`tenant-${configItem.id}`]} onChange={() => setCollapsed((prev) => !prev)} className='[&_div.arco-collapse-item-header-title]:flex-1 border-0 bg-transparent [&_.arco-collapse-item-header]:px-0 [&_.arco-collapse-item-header]:py-0'>
        <Collapse.Item
          header={
            <div className='flex items-center justify-between group px-3 py-3 md:px-4 min-h-11'>
              <div className='flex items-center gap-3 flex-1 min-w-0'>
                <div className='ml-2.5 flex size-7 items-center justify-center rd-7px bg-fill-1'>
                  <ConfigItemIcon iconUrl={configItem.icon_url} name={configItem.name} />
                </div>
                <span className='truncate text-14px font-600 leading-none text-foreground'>{configItem.name}</span>
              </div>
              <div className='flex items-center gap-2' onClick={(e) => e.stopPropagation()}>
                <span className={enabled ? 'whitespace-nowrap text-13px font-500 leading-none text-success' : 'whitespace-nowrap text-13px leading-none text-secondary'}>
                  <span className={enabled ? 'mr-1.5 inline-block size-[5px] rd-full bg-success align-middle' : 'mr-1.5 inline-block size-[5px] rd-full bg-text-3 align-middle'} />
                  {statusText}
                </span>
                <Switch size='small' checked={enabled} onChange={handleToggle} className='settings-accent-switch' style={enabled ? { backgroundColor: 'var(--ui-accent-orange)' } : undefined} />
              </div>
            </div>
          }
          name={`tenant-${configItem.id}`}
        >
          <div className='flex flex-col gap-4'>
            <div className='bg-fill-1 rd-12px pt-4 px-4 pb-4'>
              {configItem.entries.map((entry) => (
                <PreferenceRow key={entry.id} label={entry.name} description={entry.config_desc || undefined} required={entry.required === 1}>
                  <Input.Password
                    value={localValues[entry.config_key] || ''}
                    onChange={(val) => handleValueChange(entry.config_key, val)}
                    placeholder={t('settings.secrets.tenantValuePlaceholder', { entryName: entry.name, defaultValue: '请输入{{entryName}}' })}
                    style={{ width: 240 }}
                    disabled={saving}
                  />
                </PreferenceRow>
              ))}
            </div>
            <div className='flex justify-end'>
              <Button type='primary' loading={saving} disabled={saving} onClick={handleSave}>
                {t('settings.secrets.save', '保存')}
              </Button>
            </div>
          </div>
        </Collapse.Item>
      </Collapse>
    </div>
  );
};

export default TenantConfigItemGroup;
