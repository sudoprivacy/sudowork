import { Select } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import React from 'react';
import { isPersonalAgentRef, type IMyAgent } from '@sudowork/common/personalAgents';
import type { AcpBackendConfig } from '../types';

/** Select durable identity and this session's task template independently. */
export default function SessionCompositionSelector({ agents, templates, personalAgentRef, templateRef, onPersonalAgentChange, onTemplateChange }: ISessionCompositionSelectorProps) {
  const { t } = useTranslation();
  return (
    <div className='grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4'>
      <label className='flex flex-col gap-1 min-w-0 text-secondary text-sm'>
        {t('guid.sessionComposition.agent')}
        <Select aria-label={t('guid.sessionComposition.agent')} value={personalAgentRef} onChange={onPersonalAgentChange} options={agents.filter((agent) => agent.kind !== 'template' && isPersonalAgentRef(agent.ref)).map((agent) => ({ value: agent.ref, label: agent.displayName }))} />
      </label>
      <label className='flex flex-col gap-1 min-w-0 text-secondary text-sm'>
        {t('guid.sessionComposition.template')}
        <Select
          aria-label={t('guid.sessionComposition.template')}
          value={templateRef || ''}
          onChange={onTemplateChange}
          options={[{ value: '', label: t('guid.sessionComposition.noTemplate') }, ...templates.filter((template) => template.enabled !== false && !isPersonalAgentRef(template.id)).map((template) => ({ value: template.id, label: template.name }))]}
        />
      </label>
      <div className='sm:col-span-2 text-xs text-secondary'>{t('guid.sessionComposition.engine', { engine: 'Sudo Code' })}</div>
    </div>
  );
}

interface ISessionCompositionSelectorProps {
  agents: IMyAgent[];
  templates: AcpBackendConfig[];
  personalAgentRef?: string;
  templateRef?: string;
  onPersonalAgentChange: (reference: string) => void;
  onTemplateChange: (reference: string) => void;
}
