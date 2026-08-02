import React from 'react';
import { Button } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { DEFAULT_PROMPT_SCENARIOS } from '../utils/constants';

/**
 * Displays scenario-based prompt shortcuts above the input card.
 * Clicking a scenario fills the input with the corresponding prompt template.
 */
export default function PromptTemplates({ visible, onSelectPrompt }: IPromptTemplatesProps) {
  const { t } = useTranslation();

  if (!visible) return null;

  return (
    <div className='w-full mb-4 animate-fade-in animate-duration-400 animate-ease-out'>
      <div className='flex items-center gap-6px mb-10px'>
        <span className='text-13px text-foreground-secondary'>💡 {t('guid.promptTemplates.title')}</span>
      </div>
      <div className='flex flex-wrap gap-2'>
        {DEFAULT_PROMPT_SCENARIOS.map((scenario) => (
          <Button key={scenario.labelKey} onClick={() => onSelectPrompt(t(scenario.contentKey))}>
            {scenario.icon && <span className='mr-1'>{scenario.icon}</span>}
            {t(scenario.labelKey)}
          </Button>
        ))}
      </div>
    </div>
  );
}

interface IPromptTemplatesProps {
  visible: boolean;
  onSelectPrompt: (content: string) => void;
}
