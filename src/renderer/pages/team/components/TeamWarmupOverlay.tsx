import React from 'react';
import { Button } from '@arco-design/web-react';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TeamAssistant } from '../types';
import type { TeamWarmupMemberState, TeamWarmupPhase } from '../hooks/useTeamWarmup';
import { renderTeamAssistantIcon } from '../utils/teamAssistantIcon';

export default function TeamWarmupOverlay({ phase, members, runtimeStatus, error, onRetry }: ITeamWarmupOverlayProps) {
  const { t } = useTranslation();
  if (phase === 'ready') return null;

  const failedMembers = members.filter((member) => runtimeStatus.get(member.slot_id)?.status === 'failed');
  const isError = phase === 'error';

  return (
    <div className='absolute inset-0 z-20 flex items-center justify-center bg-[rgba(var(--gray-1),0.78)] backdrop-blur-[3px]'>
      <div className='flex max-w-420px flex-col items-center gap-14px rounded-18px border border-light bg-1 px-36px py-28px shadow-[0_8px_30px_rgba(0,0,0,0.08)]'>
        <div className='flex max-w-320px flex-wrap items-center justify-center gap-10px'>
          {members.slice(0, 8).map((member) => {
            const state = runtimeStatus.get(member.slot_id);
            const status = state?.status ?? member.status;
            const isFailed = status === 'failed';
            const isReady = status === 'idle' || status === 'active' || status === 'completed';
            return (
              <span key={member.slot_id} className={`inline-flex size-36px items-center justify-center rounded-full border bg-fill-1 transition-all ${isFailed ? 'border-red-500 grayscale' : isReady ? 'border-green-500 shadow-[0_0_0_3px_rgba(34,197,94,0.12)]' : 'border-light opacity-50'}`}>
                {renderTeamAssistantIcon({ assistantId: member.assistant_id, source: member.source, backend: member.assistant_backend, avatar: member.icon, name: member.assistant_name }, { size: 22 })}
              </span>
            );
          })}
        </div>
        {isError ? (
          <>
            <div className='text-center text-15px font-650 text-1'>{t('team.warmup.failedTitle')}</div>
            <div className='max-w-320px text-center text-12px leading-20px text-gray-500'>{failedMembers.length > 0 ? failedMembers.map((member) => member.assistant_name).join(', ') : error || t('team.warmup.failedHint')}</div>
            <Button type='primary' icon={<RefreshCw size={14} />} onClick={onRetry}>
              {t('team.warmup.retry')}
            </Button>
          </>
        ) : (
          <>
            <div className='text-center text-15px font-650 text-1'>{t('team.warmup.title')}</div>
            <div className='text-center text-12px text-gray-500'>{t('team.warmup.subtitle')}</div>
            <div className='h-4px w-180px overflow-hidden rounded-full bg-fill-3'>
              <div className='h-full w-1/2 animate-pulse rounded-full bg-blue-500' />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

interface ITeamWarmupOverlayProps {
  phase: TeamWarmupPhase;
  members: TeamAssistant[];
  runtimeStatus: Map<string, TeamWarmupMemberState>;
  error?: string;
  onRetry: () => void;
}
