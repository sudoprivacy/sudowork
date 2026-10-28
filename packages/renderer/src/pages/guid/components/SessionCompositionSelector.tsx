import { Select } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import React from 'react';
import { getAgentExecutionType, isPersonalAgentRef, type IMyAgent } from '@sudowork/common/personalAgents';
import type { AcpBackendConfig } from '../types';

/** Select durable identity and this session's task template independently. */
export default function SessionCompositionSelector({ agents, templates, personalAgentRef, templateRef, sessionMode = 'remote', onPersonalAgentChange, onTemplateChange }: ISessionCompositionSelectorProps) {
  const { t } = useTranslation();
  const isLocalMode = sessionMode === 'local';
  const agentLabel = t(isLocalMode ? 'guid.sessionComposition.localAgent' : 'guid.sessionComposition.agent');
  const executionType = sessionMode === 'local' ? 'local' : 'server';
  const selectableAgents = agents.filter((agent) => agent.kind !== 'template' && isPersonalAgentRef(agent.ref) && getAgentExecutionType(agent) === executionType);
  return (
    <div className='grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4'>
      <div className='flex flex-col gap-1 min-w-0 text-secondary text-sm'>
        <span>{agentLabel}</span>
        <Select aria-label={agentLabel} value={personalAgentRef} onChange={onPersonalAgentChange} placeholder={t('guid.sessionComposition.selectAgent')} options={selectableAgents.map((agent) => ({ value: agent.ref, label: agent.displayName }))} />
      </div>
      <div className='flex flex-col gap-1 min-w-0 text-secondary text-sm'>
        <span>{t('guid.sessionComposition.template')}</span>
        <Select
          aria-label={t('guid.sessionComposition.template')}
          value={templateRef || ''}
          onChange={onTemplateChange}
          options={[{ value: '', label: t('guid.sessionComposition.noTemplate') }, ...templates.filter((template) => template.enabled !== false && !isPersonalAgentRef(template.id)).map((template) => ({ value: template.id, label: template.name }))]}
        />
      </div>
      <div className='sm:col-span-2 text-xs text-secondary'>{t('guid.sessionComposition.engine', { engine: 'Sudo Code' })}</div>
    </div>
  );
}

interface ISessionCompositionSelectorProps {
  agents: IMyAgent[];
  templates: AcpBackendConfig[];
  sessionMode?: 'remote' | 'local';
  personalAgentRef?: string;
  templateRef?: string;
  onPersonalAgentChange: (reference: string) => void;
  onTemplateChange: (reference: string) => void;
}
