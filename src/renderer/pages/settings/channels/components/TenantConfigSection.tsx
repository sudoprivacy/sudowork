import { Button, Spin } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useTenantConfigItems } from '../hooks/useTenantConfigItems';
import TenantConfigItemGroup from './TenantConfigItemGroup';

interface TenantConfigSectionProps {
  refreshTrigger?: number;
}

const TenantConfigSection: React.FC<TenantConfigSectionProps> = ({ refreshTrigger }) => {
  const { t } = useTranslation();
  const { configItems, valuesMap, enabledMap, loading, savingId, error, refresh, toggleEnabled, saveItem } = useTenantConfigItems(refreshTrigger);

  if (loading) {
    return (
      <div className='f-center py-6'>
        <Spin />
      </div>
    );
  }

  if (error) {
    return (
      <div className='flex flex-col items-center gap-2 py-4'>
        <span className='text-13px text-danger'>{error}</span>
        <Button size='small' type='text' onClick={() => void refresh()}>
          {t('common.retry', '重试')}
        </Button>
      </div>
    );
  }

  if (configItems.length === 0) {
    return <div className='text-13px text-tertiary py-4'>{t('settings.secrets.emptyHint', '暂无凭据配置项')}</div>;
  }

  return (
    <div className='space-y-3'>
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
