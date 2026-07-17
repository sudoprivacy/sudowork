import { Button, Form, Input, Message, Modal, Spin } from '@arco-design/web-react';
import { Search } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import { renderTeamAssistantIcon } from '../utils/teamAssistantIcon';
import { unwrapTeamResult } from '../utils';

interface SelectableAssistant {
  assistant_id: string;
  name: string;
  backend: string;
  avatar?: string | null;
  source: 'agent' | 'assistant';
  description?: string | null;
}

interface SelectedMemberDraft {
  selectionId: string;
  assistant: SelectableAssistant;
}

function RequiredLabel({ children }: IRequiredLabelProps) {
  return (
    <span>
      {children}
      <span className='text-red-500 ml-1'>*</span>
    </span>
  );
}

function renderAssistantIcon(assistant: SelectableAssistant, size = 24) {
  return renderTeamAssistantIcon({ assistantId: assistant.assistant_id, source: assistant.source, backend: assistant.backend, avatar: assistant.avatar, name: assistant.name }, { size });
}

function getAssistantDescription(assistant: SelectableAssistant, t: ReturnType<typeof useTranslation>['t']): string {
  return assistant.description || t('team.create.agentDescriptionFallback');
}

export default function TeamCreateModal({ isVisible, onClose, onCreated }: ITeamCreateModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [workspace, setWorkspace] = useState('');
  const [search, setSearch] = useState('');
  const [selectedMembers, setSelectedMembers] = useState<SelectedMemberDraft[]>([]);
  const [leaderSelectionId, setLeaderSelectionId] = useState<string | null>(null);
  const [assistants, setAssistants] = useState<SelectableAssistant[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isVisible) return;
    let isCancelled = false;
    setIsLoading(true);
    setName('');
    setWorkspace('');
    setSearch('');
    setSelectedMembers([]);
    setLeaderSelectionId(null);
    void (async () => {
      try {
        const list = unwrapTeamResult(await ipcBridge.team.listAssistants.invoke()) ?? [];
        if (!isCancelled) setAssistants(list);
      } finally {
        if (!isCancelled) setIsLoading(false);
      }
    })();
    return () => {
      isCancelled = true;
    };
  }, [isVisible]);

  const sortedAssistants = useMemo(() => [...assistants].sort((a, b) => (a.source === b.source ? 0 : a.source === 'agent' ? -1 : 1)), [assistants]);
  const filteredAssistants = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return sortedAssistants;
    return sortedAssistants.filter((assistant) => {
      const description = getAssistantDescription(assistant, t);
      return assistant.name.toLowerCase().includes(query) || description.toLowerCase().includes(query);
    });
  }, [search, sortedAssistants, t]);
  const workspaceName = useMemo(
    () =>
      workspace
        .split(/[\\/]+/)
        .filter(Boolean)
        .pop() ?? workspace,
    [workspace]
  );
  const hasLeader = leaderSelectionId !== null && selectedMembers.some((member) => member.selectionId === leaderSelectionId);
  const isCreateDisabled = !name.trim() || selectedMembers.length === 0 || !hasLeader;

  const onSelectWorkspace = async () => {
    try {
      const res = await ipcBridge.dialog.showOpen.invoke({ properties: ['openDirectory', 'createDirectory'] });
      if (res?.success && res.data && !res.data.canceled && res.data.filePaths.length > 0) {
        setWorkspace(res.data.filePaths[0]);
      }
    } catch (error) {
      console.error('[TeamCreateModal] select workspace failed:', error);
      Message.error(t('team.create.selectWorkspaceFailed'));
    }
  };

  const onAddAssistant = (assistant: SelectableAssistant) => {
    const draft: SelectedMemberDraft = {
      selectionId: `${assistant.assistant_id}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      assistant,
    };
    setSelectedMembers((members) => [...members, draft]);
    setLeaderSelectionId((current) => current ?? draft.selectionId);
  };

  const onRemoveMember = (selectionId: string) => {
    setSelectedMembers((members) => {
      const nextMembers = members.filter((member) => member.selectionId !== selectionId);
      if (leaderSelectionId === selectionId) setLeaderSelectionId(nextMembers[0]?.selectionId ?? null);
      return nextMembers;
    });
  };

  const onSubmit = async () => {
    if (isCreateDisabled) return;
    setIsSubmitting(true);
    try {
      const team = unwrapTeamResult(
        await ipcBridge.team.createTeam.invoke({
          name: name.trim(),
          workspace: workspace.trim() || undefined,
          members: selectedMembers.map((member) => ({
            assistant_id: member.assistant.assistant_id,
            name: member.assistant.name,
            role: member.selectionId === leaderSelectionId ? 'lead' : 'teammate',
          })),
        })
      );
      onCreated(team.id);
      onClose();
    } catch (error) {
      console.error('[TeamCreateModal] createTeam failed:', error);
      Message.error(t('team.create.createFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderAssistantList = () => {
    if (isLoading) {
      return (
        <div className='flex h-full items-center justify-center'>
          <Spin />
        </div>
      );
    }
    if (assistants.length === 0) {
      return <div className='flex h-full items-center justify-center text-13px text-gray-400'>{t('team.create.noAssistants')}</div>;
    }
    return (
      <div className='flex min-h-0 flex-col gap-10px overflow-y-auto pr-1'>
        {filteredAssistants.map((assistant) => (
          <div key={assistant.assistant_id} className='flex items-center gap-3 rounded-14px border border-[var(--color-border-2)] bg-1 p-3 hover:bg-fill-1'>
            <span className='inline-flex size-42px shrink-0 items-center justify-center overflow-hidden rounded-12px bg-fill-2'>{renderAssistantIcon(assistant, 24)}</span>
            <div className='min-w-0 flex-1'>
              <div className='truncate text-15px font-650 text-1'>{assistant.name}</div>
              <div className='mt-1 line-clamp-1 text-13px leading-18px text-gray-400'>{getAssistantDescription(assistant, t)}</div>
            </div>
            <Button type='text' shape='circle' title={t('team.create.addMember')} className='!size-36px !bg-green-500/10 !text-green-600 hover:!bg-green-500/18' onClick={() => onAddAssistant(assistant)}>
              +
            </Button>
          </div>
        ))}
      </div>
    );
  };

  const renderSelectedMembers = () => {
    if (selectedMembers.length === 0) {
      return (
        <div className='flex h-full min-h-180px flex-col items-center justify-center gap-10px px-22px text-center text-gray-400'>
          <div className='flex size-34px items-center justify-center rounded-full bg-green-500/10 text-20px leading-none text-green-600'>+</div>
          <div className='text-13px font-650 leading-20px text-gray-600'>{t('team.create.emptyMembersTitle')}</div>
          <div className='max-w-260px text-12px leading-21px tracking-0.01em text-gray-400'>{t('team.create.emptyMembersSubtitle')}</div>
        </div>
      );
    }
    return selectedMembers.map((member) => {
      const isLeader = member.selectionId === leaderSelectionId;
      return (
        <div key={member.selectionId} className='flex min-h-66px items-center gap-3 rounded-14px border border-[var(--color-border-2)] bg-1 p-10px hover:bg-fill-1'>
          <span className='inline-flex size-42px shrink-0 items-center justify-center overflow-hidden rounded-12px bg-fill-2'>{renderAssistantIcon(member.assistant, 24)}</span>
          <div className='min-w-0 flex-1'>
            <div className='truncate text-15px font-650 text-1'>{member.assistant.name}</div>
            <div className='mt-1 line-clamp-1 text-13px leading-18px text-gray-400'>{getAssistantDescription(member.assistant, t)}</div>
          </div>
          <div className='flex items-center gap-6px'>
            <Button type='text' size='mini' className={`!h-28px !rounded-8px !px-10px !text-12px !font-650 ${isLeader ? '!bg-green-500/10 !text-green-600' : '!bg-fill-2 !text-gray-500 hover:!bg-blue-500/10 hover:!text-blue-600'}`} onClick={() => setLeaderSelectionId(member.selectionId)}>
              {t('team.create.leaderButton')}
            </Button>
            <Button type='text' size='mini' title={t('team.create.removeMember')} className='!size-28px !rounded-8px !p-0 !text-18px !text-gray-400 hover:!bg-red-500/10 hover:!text-red-500' onClick={() => onRemoveMember(member.selectionId)}>
              ×
            </Button>
          </div>
        </div>
      );
    });
  };

  return (
    <Modal title={t('team.create.drawerTitle')} visible={isVisible} onCancel={onClose} footer={null} style={{ width: 1040, maxWidth: 'calc(100vw - 48px)' }} alignCenter getPopupContainer={() => document.body}>
      <div className='-mx-20px -mt-4px flex h-[min(620px,calc(100vh-180px))] min-h-460px flex-col overflow-hidden'>
        <div className='px-28px pb-20px text-14px leading-22px text-gray-500'>{t('team.create.subtitle')}</div>
        <div className='grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] border-y border-[var(--color-border-2)]'>
          <section className='flex min-h-0 flex-col border-r border-[var(--color-border-2)] p-20px'>
            <div className='relative'>
              <Search size={16} className='absolute left-14px top-1/2 -translate-y-1/2 text-gray-400' />
              <Input value={search} onChange={setSearch} placeholder={t('team.create.searchPlaceholder')} className='!h-44px !rounded-10px !bg-fill-1 !pl-38px' />
            </div>
            <div className='my-12px text-13px font-600 text-gray-600'>{t('team.create.allAssistantsCount', { count: filteredAssistants.length })}</div>
            {renderAssistantList()}
          </section>
          <section className='flex min-h-0 flex-col p-20px'>
            <div className='mb-10px flex items-center justify-between gap-3'>
              <div className='text-15px font-700 text-1'>{t('team.create.selectedMembersCount', { count: selectedMembers.length })}</div>
              <div className='text-12px text-gray-400'>{t('team.create.leaderHint')}</div>
            </div>
            <div className='flex min-h-220px flex-1 flex-col gap-2 overflow-y-auto rounded-14px border border-[var(--color-border-2)] bg-fill-1 p-10px'>{renderSelectedMembers()}</div>
            <Form layout='vertical' className='mt-18px border-t border-[var(--color-border-2)] pt-18px'>
              <div className='grid grid-cols-[88px_minmax(0,1fr)] items-center gap-x-3 gap-y-3'>
                <div className='text-14px font-600 text-gray-600'>
                  <RequiredLabel>{t('team.create.nameLabel')}</RequiredLabel>
                </div>
                <Input value={name} onChange={setName} placeholder={t('team.create.namePlaceholder')} className='!h-38px !rounded-10px' />
                <div className='text-14px font-600 text-gray-600'>{t('team.create.workspaceLabel')}</div>
                <div className='min-w-0'>
                  <Button long onClick={onSelectWorkspace} className='!h-38px !justify-start !rounded-10px !text-left'>
                    {workspace ? <span className='truncate'>{workspaceName}</span> : <span className='text-gray-400'>{t('team.create.selectFolder')}</span>}
                  </Button>
                  {workspace ? (
                    <div className='mt-2 flex items-center gap-2 min-w-0'>
                      <span className='flex-1 truncate text-12px text-gray-400'>{workspace}</span>
                      <Button size='mini' type='text' onClick={() => setWorkspace('')}>
                        {t('team.create.clearWorkspace')}
                      </Button>
                    </div>
                  ) : null}
                </div>
              </div>
            </Form>
          </section>
        </div>
        <div className='flex justify-end gap-3 px-22px pt-18px'>
          <Button onClick={onClose} className='!h-40px !min-w-96px !rounded-10px'>
            {t('team.create.cancel')}
          </Button>
          <Button type='primary' loading={isSubmitting} disabled={isCreateDisabled} className='!h-40px !min-w-96px !rounded-10px' onClick={onSubmit}>
            {t('team.create.submit')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

interface ITeamCreateModalProps {
  isVisible: boolean;
  onClose: () => void;
  onCreated: (teamId: string) => void;
}

interface IRequiredLabelProps {
  children: React.ReactNode;
}
