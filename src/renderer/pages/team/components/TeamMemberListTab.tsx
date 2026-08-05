/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Modal } from '@arco-design/web-react';
import { Pencil, UserPlus, X } from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import { getAgentLogo } from '@/renderer/utils/agentLogo';
import { resolveAssistantName } from '@/renderer/shared/agents/assistantAdapter';
import type { AcpBackend } from '@/types/acpTypes';
import AcpChat from '@renderer/pages/conversation/acp/AcpChat';
import AcpModelSelector from '@renderer/components/AcpModelSelector';
import type { TeamAssistant, TeammateStatus, TTeam } from '../types';
import TeamAddMemberModal from './TeamAddMemberModal';

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

/** Inline editor for a member name. Commits on blur/Enter (deduped via ref), cancels on Esc, keeps original name when emptied. */
function TeamMemberNameInput({ initialValue, onCommit, onCancel }: ITeamMemberNameInputProps) {
  const [value, setValue] = useState(initialValue);
  const committedRef = useRef(false);

  const commit = () => {
    if (committedRef.current) return;
    committedRef.current = true;
    const trimmed = value.trim();
    if (trimmed && trimmed !== initialValue) onCommit(trimmed);
    else onCancel();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      committedRef.current = true;
      onCancel();
    }
  };

  // border-[var(--color-border-1)] 保留内联：未桥接的 Arco 默认，无零改样等价类
  return <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} onBlur={commit} onKeyDown={handleKeyDown} className='min-w-0 flex-1 box-border rounded-4px border border-[var(--color-border-1)] bg-[var(--color-bg-1)] px-6px h-28px text-13px outline-none' />;
}

function TeamMemberListTab({ team, statusMap, activeSlotIds, onAddMember, onRenameMember, onRemoveMember }: ITeamMemberListTabProps) {
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
  const [isSelectedChatProcessing, setIsSelectedChatProcessing] = useState(false);
  const [isAddMemberVisible, setIsAddMemberVisible] = useState(false);

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

  useEffect(() => {
    setIsSelectedChatProcessing(false);
  }, [activeSlotId, activeMember?.conversation_id]);

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

  return (
    <div className='flex h-full min-w-0 w-full flex-1 flex-col'>
      <div className='flex items-center justify-between px-20px py-8px'>
        <span className='text-13px font-600 text-gray-600'>{t('team.detail.memberTab')}</span>
        <button type='button' className='inline-flex cursor-pointer items-center gap-4px rounded-6px px-8px py-4px text-12px text-gray-600 transition-colors hover:bg-fill-2 hover:text-foreground' onClick={() => setIsAddMemberVisible(true)}>
          <UserPlus size={14} />
          {t('team.create.addMember')}
        </button>
      </div>

      <div className='flex min-w-0 flex-col gap-2px overflow-y-auto overflow-x-hidden px-20px pb-8px max-h-40%'>
        {memberAssistants.length === 0 ? (
          <div className='flex flex-col items-center justify-center py-24px text-center text-13px text-gray-400'>{t('team.detail.noMembers')}</div>
        ) : (
          memberAssistants.map((a) => {
            const baseStatus = statusMap.get(a.slot_id) ?? a.status;
            const hasActiveDisplayState = activeSlotIds?.has(a.slot_id) || (a.slot_id === activeSlotId && isSelectedChatProcessing);
            const status = baseStatus !== 'failed' && baseStatus !== 'pending' && hasActiveDisplayState ? 'active' : baseStatus;
            const isActive = a.slot_id === activeSlotId;
            return <TeamMemberRow key={a.slot_id} member={a} status={status} isActive={isActive} statusLabel={t(`team.status.${status}`)} onSelect={() => setActiveSlotId(a.slot_id)} onRename={(name) => void onRenameMember?.(a.slot_id, name)} onRemove={() => void onRemoveMember?.(a.slot_id)} />;
          })
        )}
      </div>

      {memberAssistants.length > 0 && (
        <div className='flex min-h-0 flex-1 flex-col overflow-hidden border-t border-light'>
          {activeMember && activeMember.conversation_id ? (
            <AcpChat
              conversation_id={activeMember.conversation_id}
              backend={activeMember.assistant_backend as AcpBackend}
              agentName={activeMember.assistant_name}
              workspace={team.workspace ?? undefined}
              onTeamAnswerQuestion={onTeamAnswerQuestion}
              teamAnswerQuestion={onTeamAnswerQuestion}
              teamSendMessage={teamSendMessage}
              onProcessingChange={setIsSelectedChatProcessing}
            />
          ) : (
            <div className='flex items-center justify-center h-full text-gray-400 text-13px'>{t('team.detail.selectMember')}</div>
          )}
        </div>
      )}

      <TeamAddMemberModal isVisible={isAddMemberVisible} onClose={() => setIsAddMemberVisible(false)} onAdded={async (params) => void onAddMember?.(params)} />
    </div>
  );
}

function TeamMemberRow({ member, status, statusLabel, isActive, onSelect, onRename, onRemove }: ITeamMemberRowProps) {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const icon = resolveMemberIcon(member);

  const handleRemove = () => {
    Modal.confirm({
      title: t('team.actions.remove'),
      content: t('team.confirm.removeMember', { name: member.assistant_name }),
      okText: t('team.confirm.confirmDelete'),
      cancelText: t('team.confirm.cancelDelete'),
      okButtonProps: { status: 'warning' },
      alignCenter: true,
      getPopupContainer: () => document.body,
      onOk: () => onRemove(),
    });
  };

  return (
    <div className={`group/team-member flex w-full min-w-0 h-28px items-center gap-8px overflow-hidden rounded-4px px-8px py-4px cursor-pointer ${isActive ? 'bg-fill-2' : 'hover:bg-fill-1'}`} onClick={isEditing ? undefined : onSelect}>
      <span className='inline-flex size-24px shrink-0 items-center justify-center overflow-hidden rounded-full bg-fill-3 text-12px font-medium text-1'>{icon ? <img src={icon} alt='' className='size-full object-cover' /> : <span className='size-10px rounded-full bg-text-4' />}</span>
      {isEditing ? (
        <TeamMemberNameInput
          initialValue={member.assistant_name}
          onCommit={(name) => {
            setIsEditing(false);
            onRename(name);
          }}
          onCancel={() => setIsEditing(false)}
        />
      ) : (
        <div className='flex min-w-0 flex-1 items-center gap-6px'>
          <span className='min-w-0 truncate text-13px'>{member.assistant_name}</span>
          {member.conversation_id && (
            <span className='inline-flex shrink-0 items-center' onClick={(e) => e.stopPropagation()}>
              <AcpModelSelector conversationId={member.conversation_id} backend={member.assistant_backend} isCompact />
            </span>
          )}
        </div>
      )}
      {!isEditing && (
        <div className='hidden shrink-0 items-center gap-4px group-hover/team-member:flex' onClick={(e) => e.stopPropagation()}>
          <button type='button' title={t('team.actions.rename')} className='inline-flex size-24px cursor-pointer items-center justify-center rounded-4px text-gray-400 hover:bg-fill-2 hover:text-foreground' onClick={() => setIsEditing(true)}>
            <Pencil size={16} />
          </button>
          <button type='button' title={t('team.actions.remove')} className='inline-flex size-24px cursor-pointer items-center justify-center rounded-4px text-gray-400 hover:bg-red-500/10 hover:text-red-500' onClick={handleRemove}>
            <X size={16} />
          </button>
        </div>
      )}
      <span className='inline-flex shrink-0 items-center gap-4px whitespace-nowrap text-11px text-gray-400'>
        <span className={`inline-block w-8px h-8px rounded-full ${STATUS_COLOR[status]}`} />
        <span className={isEditing ? 'hidden' : ''}>{statusLabel}</span>
      </span>
    </div>
  );
}

interface ITeamMemberListTabProps {
  team: TTeam;
  statusMap: Map<string, TeammateStatus>;
  activeSlotIds?: ReadonlySet<string>;
  onAddMember?: (params: { assistant_id: string; name: string; model?: string; role?: 'lead' | 'teammate' }) => Promise<void>;
  onRenameMember?: (slotId: string, name: string) => Promise<void> | void;
  onRemoveMember?: (slotId: string) => Promise<void> | void;
}

interface ITeamMemberRowProps {
  member: TeamAssistant;
  status: TeammateStatus;
  statusLabel: string;
  isActive: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
  onRemove: () => void;
}

interface ITeamMemberNameInputProps {
  initialValue: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}

export default TeamMemberListTab;
