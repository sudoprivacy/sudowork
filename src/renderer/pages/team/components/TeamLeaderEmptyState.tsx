import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { resolveTeamAssistantIcon } from '../utils/teamAssistantIcon';

const PROMPTS = [
  { key: 'productDevQaOps', icon: '💻' },
  { key: 'growth', icon: '📣' },
  { key: 'delivery', icon: '📋' },
];

export default function TeamLeaderEmptyState({ assistantName, assistantAvatar, assistantBackend, assistantId, source, onPromptClick }: ITeamLeaderEmptyStateProps) {
  const { t } = useTranslation();
  const avatar = useMemo(() => resolveTeamAssistantIcon({ assistantId, source, backend: assistantBackend, avatar: assistantAvatar, name: assistantName }), [assistantAvatar, assistantBackend, assistantId, assistantName, source]);

  return (
    <div className='w-full flex justify-center'>
      <div className='w-full max-w-560px rd-24px border border-light bg-[var(--color-bg-2)] px-28px py-30px text-center shadow-[0_12px_32px_rgba(15,23,42,0.05)] animate-fade-in animate-duration-300 animate-ease-out'>
        <div className='mx-auto mb-18px size-64px rd-full bg-fill-2 f-center overflow-hidden border border-light shadow-[0_8px_24px_rgba(0,0,0,0.06)]'>
          {avatar.kind === 'image' && avatar.value ? (
            <img src={avatar.value} alt={assistantName} className='size-full object-cover' />
          ) : avatar.kind === 'emoji' && avatar.value ? (
            <span className='text-26px leading-none'>{avatar.value}</span>
          ) : (
            <span className='text-24px font-semibold text-1'>{assistantName.slice(0, 1).toUpperCase()}</span>
          )}
        </div>
        <div className='mb-8px text-20px font-semibold leading-28px text-1'>{assistantName}</div>
        <div className='mx-auto mb-26px max-w-420px text-14px leading-22px text-secondary'>{t('team.detail.empty.subtitle')}</div>
        <div className='flex flex-col gap-12px text-left'>
          {PROMPTS.map((prompt) => {
            const text = t(`team.detail.empty.prompt.${prompt.key}`);
            return (
              <button
                key={prompt.key}
                type='button'
                className='group w-full flex items-center gap-12px rd-16px border border-light bg-fill-1 px-16px py-14px text-left text-14px leading-20px text-1 shadow-[0_1px_0_rgba(0,0,0,0.02)] transition-all duration-180 hover:bg-fill-2 hover:shadow-[0_8px_24px_rgba(0,0,0,0.05)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(var(--ui-accent-orange-rgb),0.28)] active:bg-fill-3 active:shadow-none'
                onClick={() => onPromptClick(text)}
              >
                <span className='h-32px w-32px flex-shrink-0 rd-10px bg-fill-2 f-center text-17px leading-none transition-colors group-hover:bg-fill-3'>{prompt.icon}</span>
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
  assistantId?: string | null;
  source?: 'agent' | 'assistant' | null;
  onPromptClick: (prompt: string) => void;
}
