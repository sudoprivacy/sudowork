/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Collapse, Input, Message, Switch } from '@arco-design/web-react';
import { Right } from '@icon-park/react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppMode } from '@/renderer/hooks/useAppMode';
import { ConfigStorage } from '@/common/storage';
import configItemDefaultIcon from '@/renderer/assets/config-item-default.svg';
import { BUILD_SUDOWORK_SERVER_BASE_URL, getSudoworkServerBaseUrl } from '@/common/sudoworkServer';
import type { TenantConfigItem, TenantConfigValues } from './types';
import PreferenceRow from './PreferenceRow';

function resolveIconUrl(iconUrl: string | null, baseUrl?: string): string {
  if (!iconUrl) return configItemDefaultIcon;
  if (iconUrl.startsWith('data:') || iconUrl.startsWith('http://') || iconUrl.startsWith('https://')) {
    return iconUrl;
  }
  const resolvedBase = (baseUrl ?? BUILD_SUDOWORK_SERVER_BASE_URL).replace(/\/+$/, '');
  return `${resolvedBase}${iconUrl.startsWith('/') ? iconUrl : `/${iconUrl}`}`;
}

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

  const src = useDefault ? configItemDefaultIcon : resolveIconUrl(iconUrl ?? null, baseUrl);

  return <img src={src} alt={name} className='w-16px h-16px object-contain shrink-0' onError={() => setUseDefault(true)} />;
};

interface TenantConfigItemGroupProps {
  configItem: TenantConfigItem;
  values: TenantConfigValues;
  enabled: boolean;
  saving: boolean;
  onToggleEnabled: (enabled: boolean) => void;
  onSave: (values: TenantConfigValues) => Promise<boolean>;
}

function shouldBlockEnableUntilConfigured(configItem: TenantConfigItem, values: TenantConfigValues): boolean {
  if (configItem.pinyin !== 'shareone') return false;
  return configItem.entries.some((entry) => entry.required === 1 && !values[entry.config_key]?.trim());
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
      <Collapse activeKey={collapsed ? [] : [`tenant-${configItem.id}`]} onChange={() => setCollapsed((prev) => !prev)} className='[&_div.arco-collapse-item-header-title]:flex-1 border-0 bg-transparent [&_.arco-collapse-item-icon]:hidden [&_.arco-collapse-item-header-icon]:hidden [&_.arco-collapse-item-header]:px-0 [&_.arco-collapse-item-header]:py-0'>
        <Collapse.Item
          header={
            <div className='flex items-center justify-between group px-12px py-12px md:px-16px min-h-44px'>
              <div className='flex items-center gap-12px flex-1 min-w-0'>
                <span className='inline-flex h-28px w-28px shrink-0 items-center justify-center rd-8px text-tertiary transition-colors group-hover:bg-fill-1 group-hover:text-secondary'>
                  <Right theme='outline' size='14' className='transition-transform' style={{ transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)' }} />
                </span>
                <div className='flex h-28px w-28px items-center justify-center rd-7px bg-fill-1'>
                  <ConfigItemIcon iconUrl={configItem.icon_url} name={configItem.name} />
                </div>
                <span className='truncate text-14px font-600 leading-none text-foreground'>{configItem.name}</span>
              </div>
              <div className='flex items-center gap-8px' onClick={(e) => e.stopPropagation()}>
                <span className={enabled ? 'whitespace-nowrap text-13px font-500 leading-none text-success' : 'whitespace-nowrap text-13px leading-none text-secondary'}>
                  <span className={enabled ? 'mr-6px inline-block h-5px w-5px rd-50% bg-success align-middle' : 'mr-6px inline-block h-5px w-5px rd-50% bg-[var(--color-text-3)] align-middle'} />
                  {statusText}
                </span>
                <Switch size='small' checked={enabled} onChange={handleToggle} className='settings-accent-switch' style={enabled ? { backgroundColor: 'var(--ui-accent-orange)' } : undefined} />
              </div>
            </div>
          }
          name={`tenant-${configItem.id}`}
          className='[&_div.arco-collapse-item-content-box]:px-12px [&_div.arco-collapse-item-content-box]:pb-12px [&_div.arco-collapse-item-content-box]:pt-0 md:[&_div.arco-collapse-item-content-box]:px-16px'
        >
          <div className='flex flex-col gap-16px border-t pt-12px'>
            <div className='bg-fill-1 rd-12px pt-16px pr-16px pb-16px pl-0'>
              {configItem.entries.map((entry) => (
                <PreferenceRow key={entry.id} label={entry.name} description={entry.config_desc || undefined} required={entry.required === 1}>
                  <Input.Password value={localValues[entry.config_key] || ''} onChange={(val) => handleValueChange(entry.config_key, val)} placeholder={`请输入${entry.name}`} style={{ width: 240 }} disabled={saving} />
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
