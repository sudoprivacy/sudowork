import { Radio } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';

/** Share the execution target control between the home page and selected Agents. */
export default function ExecutionModeSelector({ sessionMode, isLocalAvailable, onSessionModeChange }: IExecutionModeSelectorProps) {
  const { t } = useTranslation();
  const options = [{ label: t('conversation.welcome.execution.cloud'), value: 'remote' }];
  if (isLocalAvailable) options.push({ label: t('conversation.welcome.execution.local'), value: 'local' });

  function onChange(value: unknown): void {
    if (value === 'remote' || (value === 'local' && isLocalAvailable)) onSessionModeChange?.(value);
  }

  return (
    <div className='flex justify-center mb-5'>
      <Radio.Group type='button' value={isLocalAvailable ? sessionMode : 'remote'} options={options} onChange={onChange} />
    </div>
  );
}

interface IExecutionModeSelectorProps {
  sessionMode: 'remote' | 'local';
  isLocalAvailable: boolean;
  onSessionModeChange?: (mode: 'remote' | 'local') => void;
}
