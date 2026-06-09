/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Collapse, Input, Tooltip } from '@arco-design/web-react';
import configItemDefaultIcon from '@/renderer/assets/config-item-default.svg';
import { ConfigStorage } from '@/common/storage';
import { useAuth } from '@/renderer/context/AuthContext';
import { Right } from '@icon-park/react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import PreferenceRow from './PreferenceRow';
import type { TenantConfigItem } from './types';

function resolveIconUrl(iconUrl: string | null, baseUrl?: string): string {
  if (!iconUrl) return configItemDefaultIcon;
  if (iconUrl.startsWith('data:') || iconUrl.startsWith('http://') || iconUrl.startsWith('https://')) {
    return iconUrl;
  }
  if (baseUrl) {
    return `${baseUrl.replace(/\/+$/, '')}${iconUrl.startsWith('/') ? iconUrl : `/${iconUrl}`}`;
  }
  return configItemDefaultIcon;
}

const ConfigItemIcon: React.FC<{ iconUrl?: string; name: string; baseUrl?: string }> = ({ iconUrl, name, baseUrl }) => {
  const [useDefault, setUseDefault] = useState(false);

  useEffect(() => {
    setUseDefault(false);
  }, [iconUrl]);

  const src = useDefault ? configItemDefaultIcon : resolveIconUrl(iconUrl ?? null, baseUrl);
  return <img src={src} alt={name} className='w-16px h-16px object-contain shrink-0' onError={() => setUseDefault(true)} />;
};

const LOCKED_TIP = '企业凭据禁止操作';

export const EnterpriseSecretSection: React.FC = () => {
  const { t } = useTranslation();
  const { ensureValidToken, user } = useAuth();
  const [items, setItems] = useState<TenantConfigItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [iconBaseUrl, setIconBaseUrl] = useState<string | undefined>(undefined);

  const loadItems = useCallback(async () => {
    if (!user?.id) return;
    try {
      const token = await ensureValidToken();
      const serverUrl = await ConfigStorage.get('eeclaw.serverUrl');
      if (typeof serverUrl === 'string') {
        setIconBaseUrl(serverUrl);
      }
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
      <div className='flex items-center gap-8px'>
        <span className='text-13px font-500 text-t-secondary'>{t('settings.secrets.enterprise.title', '企业凭据')}</span>
      </div>
      {items.map((item) => (
        <div key={item.id} className='overflow-hidden border-0 border-b border-solid border-[var(--ui-border-strong)] last:border-b-0'>
          <Collapse defaultActiveKey={[]} className='border-0 bg-transparent [&_.arco-collapse-item-icon]:hidden [&_.arco-collapse-item-header-icon]:hidden [&_.arco-collapse-item-header]:px-0 [&_.arco-collapse-item-header]:py-0 [&_div.arco-collapse-item-header-title]:flex-1'>
            <Collapse.Item
              header={
                <div className='group flex items-center gap-12px px-12px py-12px md:px-16px'>
                  <span className='inline-flex h-28px w-28px shrink-0 items-center justify-center rd-8px text-t-tertiary transition-colors group-hover:bg-fill-1 group-hover:text-t-secondary'>
                    <Right theme='outline' size='14' className='transition-transform' />
                  </span>
                  <div className='flex h-28px w-28px items-center justify-center rd-7px bg-fill-1'>
                    <ConfigItemIcon iconUrl={item.icon_url} name={item.name} baseUrl={iconBaseUrl} />
                  </div>
                  <span className='min-w-0 flex-1 truncate text-14px font-600 text-t-primary'>{item.name}</span>
                </div>
              }
              name={`enterprise-${item.id}`}
              className='[&_div.arco-collapse-item-content-box]:px-12px [&_div.arco-collapse-item-content-box]:py-12px md:[&_div.arco-collapse-item-content-box]:px-16px'
            >
              <div className='space-y-12px border-t border-border-2 pt-12px'>
                {item.entries.map((entry) => (
                  <PreferenceRow key={entry.id} label={entry.name} description={entry.config_desc || undefined} required={entry.required === 1}>
                    <Tooltip content={LOCKED_TIP}>
                      <Input.Password value='••••••••' style={{ width: 240 }} disabled />
                    </Tooltip>
                  </PreferenceRow>
                ))}
              </div>
            </Collapse.Item>
          </Collapse>
        </div>
      ))}
    </div>
  );
};
