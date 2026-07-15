import { Button, Dropdown, Menu } from '@arco-design/web-react';
import { MoreOne } from '@icon-park/react';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { AcpBackend } from '@/types/acpTypes';
import AcpChat from '@renderer/pages/conversation/acp/AcpChat';
import type { TeammateStatus, TTeam } from '../types';

const STATUS_COLOR: Record<TeammateStatus, string> = {
  pending: 'bg-gray-400',
  idle: 'bg-gray-400',
  active: 'bg-green-500 animate-pulse',
  completed: 'bg-gray-400',
  failed: 'bg-red-500',
};

interface ITeamMemberListTabProps {
  team: TTeam;
  statusMap: Map<string, TeammateStatus>;
  onRemoveMember: (slotId: string) => void;
}

function TeamMemberListTab({ team, statusMap, onRemoveMember }: ITeamMemberListTabProps) {
  const { t } = useTranslation();
  const storageKey = `team-active-member-${team.id}`;
  const [activeSlotId, setActiveSlotId] = useState<string>(() => {
    try {
      return localStorage.getItem(storageKey) ?? '';
    } catch {
      return '';
    }
  });

  // Default to the leader; fall back to the first member.
  useEffect(() => {
    if (activeSlotId && team.assistants.some((a) => a.slot_id === activeSlotId)) return;
    const leader = team.assistants.find((a) => a.role === 'leader') ?? team.assistants[0];
    const next = leader?.slot_id ?? '';
    setActiveSlotId(next);
  }, [team.assistants, activeSlotId]);

  useEffect(() => {
    try {
      if (activeSlotId) localStorage.setItem(storageKey, activeSlotId);
    } catch {
      // ignore
    }
  }, [storageKey, activeSlotId]);

  const activeMember = useMemo(() => team.assistants.find((a) => a.slot_id === activeSlotId) ?? null, [team.assistants, activeSlotId]);
  const workspaceName = useMemo(
    () =>
      team.workspace
        ?.split(/[\\/]+/)
        .filter(Boolean)
        .pop() ??
      team.workspace ??
      '',
    [team.workspace]
  );

  const teamSendMessage = useMemo(() => {
    if (!activeMember) return undefined;
    return async ({ input, files, msg_id }: { input: string; files?: string[]; msg_id?: string }) => {
      await ipcBridge.team.sendMessageToMember.invoke({ teamId: team.id, memberId: activeMember.slot_id, input, files, msgId: msg_id });
    };
  }, [team.id, activeMember]);

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div className='flex flex-col gap-2px overflow-y-auto p-8px max-h-40%'>
        {team.assistants.map((a) => {
          const status = statusMap.get(a.slot_id) ?? a.status;
          const isActive = a.slot_id === activeSlotId;
          return (
            <div key={a.slot_id} className={`flex items-center gap-8px px-8px py-6px rounded-4px cursor-pointer ${isActive ? 'bg-[var(--color-fill-2)]' : 'hover:bg-[var(--color-fill-1)]'}`} onClick={() => setActiveSlotId(a.slot_id)}>
              <span className={`inline-block w-8px h-8px rounded-full ${STATUS_COLOR[status]}`} />
              <span className='flex-1 truncate text-13px'>{a.assistant_name}</span>
              <span className='text-11px text-gray-400'>{a.role === 'leader' ? t('team.role.leader') : t('team.role.teammate')}</span>
              {a.role !== 'leader' ? (
                <Dropdown
                  droplist={
                    <Menu onClickMenuItem={(key) => key === 'remove' && onRemoveMember(a.slot_id)}>
                      <Menu.Item key='remove'>{t('team.actions.remove')}</Menu.Item>
                    </Menu>
                  }
                  trigger='click'
                  position='br'
                >
                  <Button type='text' size='mini' icon={<MoreOne />} onClick={(e) => e.stopPropagation()} />
                </Dropdown>
              ) : null}
            </div>
          );
        })}
        <div className='mt-2 border-t border-[var(--color-border-2)] pt-2'>
          <div className='text-12px text-gray-400 mb-1'>{t('team.detail.workspaceTitle')}</div>
          {team.workspace ? (
            <div className='min-w-0'>
              <div className='text-13px truncate'>{team.workspace_kind === 'temporary' ? t('team.detail.workspaceTemporary') : t('team.detail.workspaceCustom')}</div>
              <div className='text-12px text-gray-400 truncate' title={team.workspace}>
                {team.workspace_kind === 'temporary' ? team.workspace : workspaceName}
              </div>
            </div>
          ) : (
            <div className='text-12px text-gray-400'>{t('team.detail.workspacePending')}</div>
          )}
        </div>
      </div>
      <div className='flex-1 min-h-0 border-t border-[var(--color-border-2)]'>
        {activeMember && activeMember.conversation_id ? (
          <AcpChat conversation_id={activeMember.conversation_id} backend={activeMember.assistant_backend as AcpBackend} agentName={activeMember.assistant_name} workspace={team.workspace ?? undefined} teamSendMessage={teamSendMessage} />
        ) : (
          <div className='flex items-center justify-center h-full text-gray-400 text-13px'>{t('team.detail.selectMember')}</div>
        )}
      </div>
    </div>
  );
}

export default TeamMemberListTab;
