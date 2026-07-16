import { Button, Form, Input, Message, Modal, Radio, Spin } from '@arco-design/web-react';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import { getTeamAssistantDisplaySource, renderTeamAssistantIcon } from '../utils/teamAssistantIcon';
import { unwrapTeamResult } from '../utils';

interface SelectableAssistant {
  assistant_id: string;
  name: string;
  backend: string;
  avatar?: string | null;
  source: 'agent' | 'assistant';
}

function RequiredLabel({ children }: IRequiredLabelProps) {
  return (
    <span>
      {children}
      <span className='text-red-500 ml-1'>*</span>
    </span>
  );
}

function renderLeaderOptionIcon(assistant: SelectableAssistant) {
  return renderTeamAssistantIcon({ assistantId: assistant.assistant_id, source: assistant.source, backend: assistant.backend, avatar: assistant.avatar, name: assistant.name });
}

export default function TeamCreateModal({ isVisible, onClose, onCreated }: ITeamCreateModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [workspace, setWorkspace] = useState('');
  const [selectedId, setSelectedId] = useState<string>('');
  const [assistants, setAssistants] = useState<SelectableAssistant[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isVisible) return;
    let isCancelled = false;
    setIsLoading(true);
    setSelectedId('');
    setName('');
    setWorkspace('');
    void (async () => {
      try {
        const list = unwrapTeamResult(await ipcBridge.team.listAssistants.invoke()) ?? [];
        if (!isCancelled) {
          setAssistants(list);
          setSelectedId(list[0]?.assistant_id ?? '');
        }
      } finally {
        if (!isCancelled) setIsLoading(false);
      }
    })();
    return () => {
      isCancelled = true;
    };
  }, [isVisible]);

  const sortedAssistants = useMemo(() => [...assistants].sort((a, b) => (getTeamAssistantDisplaySource(a) === getTeamAssistantDisplaySource(b) ? 0 : getTeamAssistantDisplaySource(a) === 'agent' ? -1 : 1)), [assistants]);
  const selected = useMemo(() => assistants.find((a) => a.assistant_id === selectedId), [assistants, selectedId]);
  const workspaceName = useMemo(
    () =>
      workspace
        .split(/[\\/]+/)
        .filter(Boolean)
        .pop() ?? workspace,
    [workspace]
  );
  const isCreateDisabled = !name.trim() || !selected;

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

  const onSubmit = async () => {
    if (isCreateDisabled) return;
    setIsSubmitting(true);
    try {
      const team = unwrapTeamResult(
        await ipcBridge.team.createTeam.invoke({
          name: name.trim(),
          workspace: workspace.trim() || undefined,
          leader_assistant_id: selected.assistant_id,
          leader_name: selected.name,
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

  return (
    <Modal title={t('team.create.drawerTitle')} visible={isVisible} onCancel={onClose} footer={null} style={{ width: 480 }} alignCenter getPopupContainer={() => document.body}>
      <Form layout='vertical'>
        <Form.Item label={<RequiredLabel>{t('team.create.nameLabel')}</RequiredLabel>}>
          <Input value={name} onChange={setName} placeholder={t('team.create.namePlaceholder')} />
        </Form.Item>
        <Form.Item label={<RequiredLabel>{t('team.create.leaderLabel')}</RequiredLabel>}>
          {isLoading ? (
            <Spin />
          ) : assistants.length === 0 ? (
            <span className='text-gray-400'>{t('team.create.noAssistants')}</span>
          ) : (
            <Radio.Group value={selectedId} onChange={setSelectedId} direction='vertical'>
              {sortedAssistants.map((assistant) => (
                <Radio key={assistant.assistant_id} value={assistant.assistant_id} className='!block w-full whitespace-nowrap'>
                  <span className='inline-flex items-center gap-2 min-w-0 align-middle'>
                    <span className='inline-flex h-4 w-4 shrink-0 items-center justify-center leading-none'>{renderLeaderOptionIcon(assistant)}</span>
                    <span className='truncate'>{assistant.name}</span>
                  </span>
                </Radio>
              ))}
            </Radio.Group>
          )}
        </Form.Item>
        <Form.Item label={t('team.create.workspaceLabel')}>
          <div className='flex flex-col gap-2'>
            <Button long onClick={onSelectWorkspace} className='!justify-start !text-left'>
              {workspace ? <span className='truncate'>{workspaceName}</span> : <span className='text-gray-400'>{t('team.create.selectFolder')}</span>}
            </Button>
            {workspace ? (
              <div className='flex items-center gap-2 min-w-0'>
                <span className='flex-1 truncate text-12px text-gray-400'>{workspace}</span>
                <Button size='mini' type='text' onClick={() => setWorkspace('')}>
                  {t('team.create.clearWorkspace')}
                </Button>
              </div>
            ) : (
              <div className='text-12px text-gray-400'>{t('team.create.temporaryWorkspaceHint')}</div>
            )}
          </div>
        </Form.Item>
        <div className='flex gap-2 justify-end mt-3'>
          <Button onClick={onClose}>{t('team.create.cancel')}</Button>
          <Button type='primary' loading={isSubmitting} disabled={isCreateDisabled} className={isCreateDisabled ? '!bg-fill-3 !border-[var(--color-border-2)] !text-secondary !cursor-not-allowed opacity-60' : undefined} onClick={onSubmit}>
            {t('team.create.submit')}
          </Button>
        </div>
      </Form>
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
