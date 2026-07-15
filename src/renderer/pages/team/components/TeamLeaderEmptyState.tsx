import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { getAgentLogo } from '@/renderer/utils/agentLogo';

const PROMPTS = [
  { key: 'productDevQaOps', icon: '💻' },
  { key: 'growth', icon: '📣' },
  { key: 'delivery', icon: '📋' },
];

export default function TeamLeaderEmptyState({ assistantName, assistantAvatar, assistantBackend, onPromptClick }: ITeamLeaderEmptyStateProps) {
  const { t } = useTranslation();
  const avatar = useMemo(() => assistantAvatar || getAgentLogo(assistantBackend), [assistantAvatar, assistantBackend]);

  return (
    <div className='w-full flex justify-center'>
      <div className='w-full max-w-640px px-24px text-center animate-fade-in animate-duration-300 animate-ease-out'>
        <div className='mx-auto mb-16px size-60px rd-full bg-fill-2 f-center overflow-hidden border border-[var(--color-border-2)] shadow-sm'>
          {avatar ? <img src={avatar} alt={assistantName} className='size-full object-cover' /> : <span className='text-24px font-semibold text-1'>{assistantName.slice(0, 1).toUpperCase()}</span>}
        </div>
        <div className='text-20px font-semibold text-1 mb-6px'>{assistantName}</div>
        <div className='text-14px text-secondary mb-24px'>{t('team.detail.empty.subtitle')}</div>
        <div className='flex flex-col gap-10px text-left'>
          {PROMPTS.map((prompt) => {
            const text = t(`team.detail.empty.prompt.${prompt.key}`);
            return (
              <button key={prompt.key} type='button' className='w-full flex items-center gap-12px px-16px py-13px rd-14px border border-[var(--color-border-2)] bg-fill-1 text-14px text-1 text-left transition-colors hover:bg-fill-2 active:bg-fill-3' onClick={() => onPromptClick(text)}>
                <span className='text-18px leading-none'>{prompt.icon}</span>
                <span className='min-w-0 flex-1'>{text}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

interface ITeamLeaderEmptyStateProps {
  assistantName: string;
  assistantAvatar?: string | null;
  assistantBackend?: string | null;
  onPromptClick: (prompt: string) => void;
}
