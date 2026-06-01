/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Collapse, Input, Tooltip } from '@arco-design/web-react';
import configItemDefaultIcon from '@/renderer/assets/config-item-default.svg';
import { ConfigStorage } from '@/common/storage';
import { useAuth } from '@/renderer/context/AuthContext';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import PreferenceRow from './PreferenceRow';
import type { TenantConfigItem } from './types';

function resolveIconUrl(iconUrl: string | null): string {
  if (!iconUrl) return configItemDefaultIcon;
  if (iconUrl.startsWith('data:') || iconUrl.startsWith('http://') || iconUrl.startsWith('https://')) {
    return iconUrl;
  }
  return configItemDefaultIcon;
}

const ConfigItemIcon: React.FC<{ iconUrl?: string; name: string }> = ({ iconUrl, name }) => {
  const [useDefault, setUseDefault] = React.useState(false);

  React.useEffect(() => {
    setUseDefault(false);
  }, [iconUrl]);

  const src = useDefault ? configItemDefaultIcon : resolveIconUrl(iconUrl ?? null);
  return <img src={src} alt={name} className='w-14px h-14px object-contain shrink-0' onError={() => setUseDefault(true)} />;
};

const LOCKED_TIP = '企业凭据禁止操作';

export const EnterpriseSecretSection: React.FC = () => {
  const { t } = useTranslation();
  const { ensureValidToken, user } = useAuth();
  const [items, setItems] = useState<TenantConfigItem[]>([]);
  const [loading, setLoading] = useState(true);

  const loadItems = useCallback(async () => {
    if (!user?.id) return;
    try {
      const token = await ensureValidToken();
      const serverUrl = await ConfigStorage.get('eeclaw.serverUrl');
      const headers = { Authorization: `Bearer ${token}` };

      // 1. Get authorized system config IDs
      const authRes = await fetch(`${serverUrl}/api/v1/me/authorized-system-configs`, { headers });
      const authData = await authRes.json();
      if (!authData.success) return;
      const authorizedIds = new Set((authData.data as Array<{ id: number }>).map((i) => i.id));
      if (authorizedIds.size === 0) return;

      // 2. Get full config items with entries, filter to authorized system items
      const itemsRes = await fetch(`${serverUrl}/api/v1/config/items`, { headers });
      const itemsData = await itemsRes.json();
      if (!itemsData.success) return;

      const systemItems: TenantConfigItem[] = itemsData.data.filter((item: TenantConfigItem) => item.scope === 'system' && authorizedIds.has(item.id)).map((item: TenantConfigItem) => item);

      setItems(systemItems);
    } catch {
      // Silently fail
    } finally {
      setLoading(false);
    }
  }, [ensureValidToken, user?.id]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  if (loading || items.length === 0) return null;

  return (
    <div className='space-y-12px'>
      <div className='flex items-center gap-8px mb-4px'>
        <span className='text-13px font-500 text-t-secondary'>{t('settings.secrets.enterprise.title', '企业凭据')}</span>
      </div>
      {items.map((item) => (
        <Collapse key={item.id} defaultActiveKey={[]} className='[&_div.arco-collapse-item-header-title]:flex-1'>
          <Collapse.Item
            header={
              <div className='flex items-center justify-between group'>
                <div className='flex items-center gap-8px flex-1 min-w-0'>
                  <ConfigItemIcon iconUrl={item.icon_url} name={item.name} />
                  <span className='text-14px text-t-primary'>{item.name}</span>
                </div>
              </div>
            }
            name={`enterprise-${item.id}`}
            className='[&_div.arco-collapse-item-content-box]:py-3'
          >
            <div className='flex flex-col gap-24px'>
              <div className='bg-fill-1 rd-12px pt-16px pr-16px pb-16px pl-0'>
                {item.entries.map((entry) => (
                  <PreferenceRow key={entry.id} label={entry.name} description={entry.config_desc || undefined} required={entry.required === 1}>
                    <Tooltip content={LOCKED_TIP}>
                      <Input.Password value='••••••••' style={{ width: 240 }} disabled />
                    </Tooltip>
                  </PreferenceRow>
                ))}
              </div>
            </div>
          </Collapse.Item>
        </Collapse>
      ))}
    </div>
  );
};
