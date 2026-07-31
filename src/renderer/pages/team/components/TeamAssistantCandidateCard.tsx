import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ITeamAssistantCandidate } from '@/common/ipcBridge';
import { renderTeamAssistantIcon } from '../utils/teamAssistantIcon';

type TFunc = ReturnType<typeof useTranslation>['t'];

/** snake_case candidate → camelCase icon input, then render via the shared helper (附录 II.12). */
export function renderCandidateIcon(candidate: ITeamAssistantCandidate, size = 24) {
  return renderTeamAssistantIcon({ assistantId: candidate.assistant_id, source: candidate.source, backend: candidate.backend, avatar: candidate.avatar, name: candidate.name }, { size });
}

/** Candidate description with the shared fallback (附录 II.12). */
export function getCandidateDescription(candidate: ITeamAssistantCandidate, t: TFunc): string {
  return candidate.description || t('team.create.agentDescriptionFallback');
}

/** Sort candidates: source 'agent' first, then 'assistant' (附录 II.12). */
export function sortCandidatesBySource(list: ITeamAssistantCandidate[]): ITeamAssistantCandidate[] {
  return [...list].sort((a, b) => (a.source === b.source ? 0 : a.source === 'agent' ? -1 : 1));
}

/** Shared search + sort over candidates, used by both TeamCreateModal and TeamAddMemberModal (附录 II.12). */
export function useFilteredCandidates(list: ITeamAssistantCandidate[], t: TFunc) {
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    const sorted = sortCandidatesBySource(list);
    const query = search.trim().toLowerCase();
    if (!query) return sorted;
    return sorted.filter((candidate) => {
      const description = getCandidateDescription(candidate, t);
      return candidate.name.toLowerCase().includes(query) || description.toLowerCase().includes(query);
    });
  }, [list, search, t]);
  return { search, setSearch, filtered };
}

function TeamAssistantCandidateCard({ candidate, size = 24, onClick, children }: ITeamAssistantCandidateCardProps) {
  const { t } = useTranslation();

  return (
    <div className={`flex items-center gap-3 rounded-14px border border-light bg-fill-1 p-3 hover:bg-1 ${onClick ? 'cursor-pointer' : ''}`} onClick={onClick}>
      <span className='inline-flex size-42px shrink-0 items-center justify-center overflow-hidden rounded-12px bg-fill-2'>{renderCandidateIcon(candidate, size)}</span>
      <div className='min-w-0 flex-1'>
        <div className='truncate text-15px font-650 text-1'>{candidate.name}</div>
        <div className='mt-1 line-clamp-1 text-13px leading-18px text-gray-400'>{getCandidateDescription(candidate, t)}</div>
      </div>
      {children}
    </div>
  );
}

export default TeamAssistantCandidateCard;

interface ITeamAssistantCandidateCardProps {
  candidate: ITeamAssistantCandidate;
  size?: number;
  onClick?: () => void;
  children?: React.ReactNode;
}
