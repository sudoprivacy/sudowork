/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Collapse, Input, Tooltip } from '@arco-design/web-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfigStorage } from '@sudowork/common/storage';
import { useAuth } from '@renderer/context/AuthContext';
import type { TenantConfigItem } from '../types';
import { resolveEnterpriseConfigItemIconUrl } from '../utils';
import PreferenceRow from './PreferenceRow';

type SecretScope = 'system' | 'department';

const SECTION_TEXT_KEYS: Record<SecretScope, { title: string; lockedTip: string }> = {
  system: { title: 'settings.secrets.enterprise.title', lockedTip: 'settings.secrets.enterprise.lockedTip' },
  department: { title: 'settings.secrets.department.title', lockedTip: 'settings.secrets.department.lockedTip' },
};

function ConfigItemIcon({ iconUrl, name, baseUrl }: { iconUrl?: string; name: string; baseUrl?: string }) {
  const [useDefault, setUseDefault] = useState(false);

  useEffect(() => {
    setUseDefault(false);
  }, [iconUrl]);

  const src = useDefault ? resolveEnterpriseConfigItemIconUrl(null) : resolveEnterpriseConfigItemIconUrl(iconUrl ?? null, baseUrl);
  return <img src={src} alt={name} className='size-4 object-contain shrink-0' onError={() => setUseDefault(true)} />;
}

export function AuthorizedSecretSection({ scope }: IAuthorizedSecretSectionProps) {
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

      // 1. Get authorized config items for this scope (rows carry the scope field)
      const authRes = await fetch(`${serverUrl}/api/v1/me/authorized-system-configs`, { headers });
      const authData = await authRes.json();
      if (!authData.success) return;
      const authorizedIds = new Set((authData.data as Array<{ id: number; scope?: string }>).filter((i) => i.scope === scope).map((i) => i.id));
      if (authorizedIds.size === 0) return;

      // 2. Get full config items with entries, filter to authorized items of this scope
      const itemsRes = await fetch(`${serverUrl}/api/v1/config/items`, { headers });
      const itemsData = await itemsRes.json();
      if (!itemsData.success) return;

      const scopedItems: TenantConfigItem[] = itemsData.data.filter((item: TenantConfigItem) => item.scope === scope && authorizedIds.has(item.id));

      setItems(scopedItems);
    } catch {
      // Silently fail
    } finally {
      setLoading(false);
    }
  }, [ensureValidToken, scope, user?.id]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  if (loading || items.length === 0) return null;

  return (
    <div className='space-y-3'>
      <div className='flex items-center gap-2'>
        <span className='text-13px font-500 text-secondary'>{t(SECTION_TEXT_KEYS[scope].title)}</span>
      </div>
      {items.map((item) => (
        <div key={item.id} className='overflow-hidden rd-12px border'>
          <Collapse defaultActiveKey={[]} className='border-0 bg-transparent [&_.arco-collapse-item-icon]:hidden [&_.arco-collapse-item-header-icon]:hidden [&_.arco-collapse-item-header]:px-0 [&_.arco-collapse-item-header]:py-0 [&_div.arco-collapse-item-header-title]:flex-1'>
            <Collapse.Item
              header={
                <div className='group flex items-center gap-3 px-3 py-3 md:px-4'>
                  <div className='ml-2.5 flex size-7 items-center justify-center rd-7px bg-fill-1'>
                    <ConfigItemIcon iconUrl={item.icon_url} name={item.name} baseUrl={iconBaseUrl} />
                  </div>
                  <span className='min-w-0 flex-1 truncate text-14px font-600 text-foreground'>{item.name}</span>
                </div>
              }
              name={`${scope}-${item.id}`}
            >
              <div className='space-y-3 border-t pt-3'>
                {item.entries.map((entry) => (
                  <PreferenceRow key={entry.id} label={entry.name} description={entry.config_desc || undefined} required={entry.required === 1}>
                    <Tooltip content={t(SECTION_TEXT_KEYS[scope].lockedTip)}>
                      <Input.Password value='*****' style={{ width: 240 }} disabled />
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
}

interface IAuthorizedSecretSectionProps {
  scope: SecretScope;
}
