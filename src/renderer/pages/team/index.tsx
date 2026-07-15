import { Button, Card, Checkbox, Empty, Message, Modal } from '@arco-design/web-react';
import { IconPlus } from '@arco-design/web-react/icon';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Users } from 'lucide-react';
import { ipcBridge } from '@/common';
import PageWrapper from '@renderer/components/base/PageWrapper';
import TeamFormDrawer from './components/TeamFormDrawer';
import { useTeams } from './hooks/useTeams';

function TeamListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { teams, isLoading, mutate } = useTeams();
  const [createVisible, setCreateVisible] = useState(false);

  const onDeleteTeam = (team: (typeof teams)[number]) => {
    const deleteWorkspaceRef = { current: false };
    const isCustomWorkspace = team.workspace_kind === 'custom' && !!team.workspace;
    Modal.confirm({
      title: t('team.confirm.deleteTeamTitle'),
      content: (
        <div>
          <div>{team.workspace_kind === 'temporary' ? t('team.confirm.deleteTeamTemporary') : t('team.confirm.deleteTeam')}</div>
          {isCustomWorkspace ? (
            <Checkbox className='mt-3' onChange={(checked) => (deleteWorkspaceRef.current = checked)}>
              {t('team.confirm.deleteWorkspaceOption')}
            </Checkbox>
          ) : null}
        </div>
      ),
      okText: t('team.confirm.confirmDelete'),
      cancelText: t('team.confirm.cancelDelete'),
      okButtonProps: { status: 'warning' },
      onOk: async () => {
        try {
          await ipcBridge.team.removeTeam.invoke({ teamId: team.id, deleteWorkspace: isCustomWorkspace ? deleteWorkspaceRef.current : undefined });
          Message.success(t('team.confirm.deleteSuccess'));
          void mutate();
        } catch (e) {
          console.error('[TeamListPage] removeTeam failed:', e);
          Message.error(t('team.confirm.deleteFailed'));
        }
      },
    });
  };

  return (
    <PageWrapper>
      <div className='flex items-center justify-between mb-16px'>
        <div className='flex items-center gap-8px text-18px font-medium'>
          <Users size={20} />
          {t('team.list.title')}
        </div>
        <Button type='primary' icon={<IconPlus />} onClick={() => setCreateVisible(true)}>
          {t('team.list.createButton')}
        </Button>
      </div>

      {isLoading ? null : teams.length === 0 ? (
        <Empty description={t('team.list.empty')} />
      ) : (
        <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-12px'>
          {teams.map((team) => (
            <Card key={team.id} hoverable className='cursor-pointer' onClick={() => navigate(`/app/team/${team.id}`)}>
              <div className='flex items-start gap-2'>
                <div className='min-w-0 flex-1'>
                  <div className='font-medium text-16px mb-4px truncate'>{team.name}</div>
                  <div className='text-gray-400 text-12px'>
                    {team.assistants.length} {t('team.detail.memberTab')} · {team.leader_member_id ? (team.assistants.find((a) => a.slot_id === team.leader_member_id)?.assistant_name ?? '') : ''}
                  </div>
                </div>
                <Button
                  size='mini'
                  type='text'
                  status='danger'
                  onClick={(event) => {
                    event.stopPropagation();
                    onDeleteTeam(team);
                  }}
                >
                  {t('team.actions.delete')}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <TeamFormDrawer visible={createVisible} onClose={() => setCreateVisible(false)} onCreated={(teamId) => navigate(`/app/team/${teamId}`)} />
    </PageWrapper>
  );
}

export default TeamListPage;
