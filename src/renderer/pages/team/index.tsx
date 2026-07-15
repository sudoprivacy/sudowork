import { Button, Card, Empty } from '@arco-design/web-react';
import { IconPlus } from '@arco-design/web-react/icon';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Users } from 'lucide-react';
import PageWrapper from '@renderer/components/base/PageWrapper';
import TeamFormDrawer from './components/TeamFormDrawer';
import { useTeams } from './hooks/useTeams';

function TeamListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { teams, isLoading } = useTeams();
  const [createVisible, setCreateVisible] = useState(false);

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
              <div className='font-medium text-16px mb-4px'>{team.name}</div>
              <div className='text-gray-400 text-12px'>
                {team.assistants.length} {t('team.detail.memberTab')} · {team.leader_member_id ? (team.assistants.find((a) => a.slot_id === team.leader_member_id)?.assistant_name ?? '') : ''}
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
