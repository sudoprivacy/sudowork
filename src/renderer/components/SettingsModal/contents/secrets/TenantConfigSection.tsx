/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Spin } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useTenantConfigItems } from './useTenantConfigItems';
import TenantConfigItemGroup from './TenantConfigItemGroup';

interface TenantConfigSectionProps {
  refreshTrigger?: number;
}

const TenantConfigSection: React.FC<TenantConfigSectionProps> = ({ refreshTrigger }) => {
  const { t } = useTranslation();
  const { configItems, valuesMap, enabledMap, loading, savingId, error, refresh, toggleEnabled, saveItem } =
    useTenantConfigItems(refreshTrigger);

  if (loading) {
    return (
      <div className='flex items-center justify-center py-24px'>
        <Spin />
      </div>
    );
  }

  if (error) {
    return (
      <div className='flex flex-col items-center gap-8px py-16px'>
        <span className='text-13px text-danger'>{error}</span>
        <Button size='small' type='text' onClick={() => void refresh()}>
          {t('common.retry', '重试')}
        </Button>
      </div>
    );
  }

  if (configItems.length === 0) {
    return null;
  }

  return (
    <div className='space-y-12px'>
      {configItems.map((item) => (
        <TenantConfigItemGroup
          key={item.id}
          configItem={item}
          values={valuesMap[item.id] || {}}
          enabled={enabledMap[item.id] ?? false}
          saving={savingId === item.id}
          onToggleEnabled={(enabled) => void toggleEnabled(item.id, enabled)}
          onSave={(values) => saveItem(item.id, item.pinyin!, item.entries, values, valuesMap[item.id] || {})}
        />
      ))}
    </div>
  );
};

export default TenantConfigSection;
