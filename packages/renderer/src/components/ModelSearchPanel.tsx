import { Input } from '@arco-design/web-react';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ModelGroupOption, ProviderModelGroup } from '@renderer/utils/modelProviderGroups';

export default function ModelSearchPanel<T extends ModelGroupOption>({ groups, isOpen, children }: IModelSearchPanelProps<T>) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!isOpen) setQuery('');
  }, [isOpen]);

  const filteredGroups = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) return groups;

    return groups.flatMap((group) => {
      const isProviderMatch = group.name.toLowerCase().includes(search);
      const models = isProviderMatch ? group.models : group.models.filter((model) => [model.id, model.label, model.provider, model.providerLabel].some((value) => value?.toLowerCase().includes(search)));
      return models.length ? [{ ...group, models }] : [];
    });
  }, [groups, query]);

  return (
    <div className='flex flex-col gap-2 p-1.5 rd-12px border bg-popup max-h-[min(60vh,420px)]' style={{ minWidth: 240, maxWidth: 'calc(100vw - 24px)', boxShadow: '0 8px 28px rgba(0, 0, 0, 0.12)' }}>
      <Input className='shrink-0' allowClear value={query} onChange={setQuery} aria-label={t('common.searchModels')} placeholder={t('common.searchModels')} />
      <div className='flex flex-col gap-0.5 min-h-0 overflow-y-auto'>
        {filteredGroups.length > 0 ? (
          children(filteredGroups)
        ) : (
          <div role='status' className='px-2.5 py-3 text-secondary text-14px text-center'>
            {t('common.noMatchingModels')}
          </div>
        )}
      </div>
    </div>
  );
}

interface IModelSearchPanelProps<T extends ModelGroupOption> {
  groups: ProviderModelGroup<T>[];
  isOpen: boolean;
  children: (groups: ProviderModelGroup<T>[]) => React.ReactNode;
}
