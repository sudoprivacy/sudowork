import { Button, Drawer, Form, Input, Radio, Spin } from '@arco-design/web-react';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import { getAgentPriority } from '@/types/acpTypes';
import { useAuth } from '@/renderer/context/AuthContext';
import { unwrapTeamResult } from '../utils';

interface SelectableAssistant {
  assistant_id: string;
  name: string;
  backend: string;
  avatar?: string;
}

interface ITeamFormDrawerProps {
  visible: boolean;
  onClose: () => void;
  onCreated: (teamId: string) => void;
}

function TeamFormDrawer({ visible, onClose, onCreated }: ITeamFormDrawerProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [workspace, setWorkspace] = useState('');
  const [selectedId, setSelectedId] = useState<string>('');
  const [assistants, setAssistants] = useState<SelectableAssistant[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    setSelectedId('');
    setName('');
    setWorkspace('');
    void (async () => {
      try {
        const res = await ipcBridge.acpConversation.getAvailableAgents.invoke();
        const agents = res?.success ? (res.data ?? []) : [];
        const seen = new Set<string>();
        const list: SelectableAssistant[] = [];
        for (const a of agents) {
          if (a.backend === 'remote-agent') continue; // enterprise — not a C-end team member
          const id = a.customAgentId ?? a.backend;
          if (seen.has(id)) continue;
          seen.add(id);
          list.push({ assistant_id: id, name: a.name, backend: a.backend, avatar: a.avatar });
        }
        list.sort((a, b) => getAgentPriority(a.backend) - getAgentPriority(b.backend));
        if (!cancelled) {
          setAssistants(list);
          setSelectedId(list[0]?.assistant_id ?? '');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible]);

  const selected = useMemo(() => assistants.find((a) => a.assistant_id === selectedId), [assistants, selectedId]);

  const handleSubmit = async () => {
    if (!user?.id) return;
    if (!name.trim() || !selected) return;
    setSubmitting(true);
    try {
      const team = unwrapTeamResult(
        await ipcBridge.team.createTeam.invoke({
          user_id: user.id,
          name: name.trim(),
          workspace: workspace.trim() || undefined,
          leader_assistant_id: selected.assistant_id,
          leader_name: selected.name,
        })
      );
      onCreated(team.id);
      onClose();
    } catch (e) {
      console.error('[TeamFormDrawer] createTeam failed:', e);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Drawer title={t('team.create.drawerTitle')} visible={visible} onCancel={onClose} footer={null} width={480}>
      <Form layout='vertical'>
        <Form.Item label={t('team.create.nameLabel')}>
          <Input value={name} onChange={setName} placeholder={t('team.create.namePlaceholder')} />
        </Form.Item>
        <Form.Item label={t('team.create.workspaceLabel')}>
          <Input value={workspace} onChange={setWorkspace} placeholder='/path/to/workspace' />
        </Form.Item>
        <Form.Item label={t('team.create.leaderLabel')}>
          {loading ? (
            <Spin />
          ) : assistants.length === 0 ? (
            <span className='text-gray-400'>{t('team.create.noAssistants')}</span>
          ) : (
            <Radio.Group value={selectedId} onChange={setSelectedId} direction='vertical'>
              {assistants.map((a) => (
                <Radio key={a.assistant_id} value={a.assistant_id}>
                  {a.name} <span className='text-gray-400 text-12px'>({a.backend})</span>
                </Radio>
              ))}
            </Radio.Group>
          )}
        </Form.Item>
        <div className='flex gap-8px justify-end mt-12px'>
          <Button onClick={onClose}>{t('team.create.cancel')}</Button>
          <Button type='primary' loading={submitting} disabled={!name.trim() || !selected} onClick={handleSubmit}>
            {t('team.create.submit')}
          </Button>
        </div>
      </Form>
    </Drawer>
  );
}

export default TeamFormDrawer;
