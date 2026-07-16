import { Users } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import { getAgentLogo } from '@/renderer/utils/agentLogo';
import { resolveAssistantName } from '@/renderer/shared/agents/assistantAdapter';
import type { AcpBackend } from '@/types/acpTypes';
import AcpChat from '@renderer/pages/conversation/acp/AcpChat';
import type { TeamAssistant, TeammateStatus, TTeam } from '../types';

const STATUS_COLOR: Record<TeammateStatus, string> = {
  pending: 'bg-gray-400',
  idle: 'bg-gray-400',
  active: 'bg-green-500 animate-pulse',
  completed: 'bg-gray-400',
  failed: 'bg-red-500',
};

function resolveMemberIcon(member: TeamAssistant): string | null {
  if (member.icon) return member.icon;
  const assistantLogo = member.assistant_id ? getAgentLogo(resolveAssistantName(member.assistant_id)) : null;
  return assistantLogo ?? getAgentLogo(member.assistant_backend);
}

interface ITeamMemberListTabProps {
  team: TTeam;
  statusMap: Map<string, TeammateStatus>;
}

function TeamMemberListTab({ team, statusMap }: ITeamMemberListTabProps) {
  const { t } = useTranslation();
  const storageKey = `team-active-member-${team.id}`;
  const memberAssistants = useMemo(() => team.assistants.filter((a) => a.role !== 'leader'), [team.assistants]);
  const [activeSlotId, setActiveSlotId] = useState<string>(() => {
    try {
      return localStorage.getItem(storageKey) ?? '';
    } catch {
      return '';
    }
  });

  useEffect(() => {
    if (activeSlotId && memberAssistants.some((a) => a.slot_id === activeSlotId)) return;
    setActiveSlotId(memberAssistants[0]?.slot_id ?? '');
  }, [memberAssistants, activeSlotId]);

  useEffect(() => {
    try {
      if (activeSlotId) {
        localStorage.setItem(storageKey, activeSlotId);
      } else {
        localStorage.removeItem(storageKey);
      }
    } catch {
      // ignore
    }
  }, [storageKey, activeSlotId]);

  const activeMember = useMemo(() => memberAssistants.find((a) => a.slot_id === activeSlotId) ?? null, [memberAssistants, activeSlotId]);

  const teamSendMessage = useMemo(() => {
    if (!activeMember) return undefined;
    return async ({ input, files, msg_id }: { input: string; files?: string[]; msg_id?: string }) => {
      await ipcBridge.team.sendMessageToMember.invoke({ teamId: team.id, memberId: activeMember.slot_id, input, files, msgId: msg_id });
    };
  }, [team.id, activeMember]);

  const onTeamAnswerQuestion = useMemo(() => {
    if (!activeMember) return undefined;
    return async ({ conversationId, toolCallId, answers }: { conversationId: string; toolCallId: string; answers: Array<{ id: string; value: string; label?: string }> }) => {
      return await ipcBridge.team.answerQuestion.invoke({ teamId: team.id, memberId: activeMember.slot_id, conversationId, toolCallId, answers });
    };
  }, [team.id, activeMember]);

  if (memberAssistants.length === 0) {
    return (
      <div className='flex h-full min-h-0 w-full flex-1 flex-col items-center justify-center px-24px text-center'>
        <div className='flex w-150px flex-col items-center gap-10px rounded-20px border border-dashed border-light bg-[var(--color-bg-2)] px-20px py-24px shadow-[0_1px_0_rgba(0,0,0,0.02)]'>
          <div className='flex h-48px w-48px items-center justify-center rounded-full bg-fill-1'>
            <Users size={32} strokeWidth={1.8} className='text-[var(--text-disabled)]' />
          </div>
          <div className='text-13px font-semibold text-foreground'>{t('team.detail.noMembers')}</div>
        </div>
      </div>
    );
  }

  return (
    <div className='flex h-full min-h-0 w-full flex-1 flex-col'>
      <div className='flex min-w-0 flex-col gap-2px overflow-y-auto overflow-x-hidden px-20px py-8px max-h-40%'>
        {memberAssistants.map((a) => {
          const status = statusMap.get(a.slot_id) ?? a.status;
          const isActive = a.slot_id === activeSlotId;
          return <TeamMemberRow key={a.slot_id} member={a} status={status} isActive={isActive} statusLabel={t(`team.status.${status}`)} onSelect={() => setActiveSlotId(a.slot_id)} />;
        })}
      </div>
      <div className='flex min-h-0 flex-1 flex-col overflow-hidden border-t border-[var(--color-border-2)]'>
        {activeMember && activeMember.conversation_id ? (
          <AcpChat conversation_id={activeMember.conversation_id} backend={activeMember.assistant_backend as AcpBackend} agentName={activeMember.assistant_name} workspace={team.workspace ?? undefined} onTeamAnswerQuestion={onTeamAnswerQuestion} teamSendMessage={teamSendMessage} />
        ) : (
          <div className='flex items-center justify-center h-full text-gray-400 text-13px'>{t('team.detail.selectMember')}</div>
        )}
      </div>
    </div>
  );
}

function TeamMemberRow({ member, status, statusLabel, isActive, onSelect }: ITeamMemberRowProps) {
  const icon = resolveMemberIcon(member);

  return (
    <div className={`flex w-full min-w-0 items-center gap-8px overflow-hidden rounded-4px px-8px py-6px cursor-pointer ${isActive ? 'bg-[var(--color-fill-2)]' : 'hover:bg-[var(--color-fill-1)]'}`} onClick={onSelect}>
      <span className='inline-flex size-24px shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--color-fill-3)] text-12px font-medium text-1'>
        {icon ? <img src={icon} alt='' className='size-full object-cover' /> : <span className='size-10px rounded-full bg-[var(--color-text-4)]' />}
      </span>
      <span className='min-w-0 flex-1 truncate text-13px'>{member.assistant_name}</span>
      <span className='inline-flex shrink-0 items-center gap-4px whitespace-nowrap text-11px text-gray-400'>
        <span className={`inline-block w-8px h-8px rounded-full ${STATUS_COLOR[status]}`} />
        <span>{statusLabel}</span>
      </span>
    </div>
  );
}

interface ITeamMemberRowProps {
  member: TeamAssistant;
  status: TeammateStatus;
  statusLabel: string;
  isActive: boolean;
  onSelect: () => void;
}

export default TeamMemberListTab;
