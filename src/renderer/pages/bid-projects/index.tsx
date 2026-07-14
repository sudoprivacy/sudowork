import { Button, Card, Input, Select, Tag } from '@arco-design/web-react';
import React, { useEffect, useMemo, useState } from 'react';
import { IconPlus } from '@arco-design/web-react/icon';
import { DatabaseBackup, FileText, FolderOpen, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageWrapper from '@renderer/components/base/PageWrapper';
import { listBidProjects } from './storage';
import type { IBidProjectDraft } from './types';

export default function BidProjectsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<IBidProjectDraft[]>([]);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | string>('all');

  const onLoadProjects = React.useCallback(async () => {
    const nextProjects = await listBidProjects();
    setProjects(nextProjects);
  }, []);

  useEffect(() => {
    void onLoadProjects();
  }, [onLoadProjects]);

  useEffect(() => {
    const onFocus = () => {
      void onLoadProjects();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [onLoadProjects]);

  const filteredProjects = useMemo(() => {
    return projects.filter((project) => {
      const keywordMatched = !keyword || [project.name, project.company, project.target].some((value) => value?.toLowerCase().includes(keyword.toLowerCase()));
      const statusMatched = statusFilter === 'all' || project.status === statusFilter;
      return keywordMatched && statusMatched;
    });
  }, [keyword, projects, statusFilter]);

  const stats = useMemo(() => {
    return {
      total: projects.length,
      awaitingConfirmation: projects.filter((project) => project.status === 'awaiting_confirmation').length,
      generating: projects.filter((project) => project.status === 'generating' || project.status === 'analyzing' || project.status === 'planning').length,
      openIssues: projects.reduce((count, project) => count + project.complianceIssues.filter((issue) => issue.status === 'open').length, 0),
    };
  }, [projects]);

  return (
    <PageWrapper
      title={t('bidProjects.title')}
      subtitle={t('bidProjects.subtitle')}
      actions={
        <Button type='primary' shape='round' icon={<IconPlus />} onClick={() => void navigate('/app/bid-projects/new')}>
          {t('bidProjects.createProject')}
        </Button>
      }
    >
      <div className='space-y-4'>
        <div className='grid grid-cols-1 md:grid-cols-4 gap-3'>
          <StatsCard label={t('bidProjects.stats.total')} value={stats.total} />
          <StatsCard label={t('bidProjects.stats.awaitingConfirmation')} value={stats.awaitingConfirmation} />
          <StatsCard label={t('bidProjects.stats.generating')} value={stats.generating} />
          <StatsCard label={t('bidProjects.stats.openIssues')} value={stats.openIssues} />
        </div>

        <div className='card p-4 flex flex-col gap-4'>
          <div className='flex flex-col md:flex-row gap-3 md:items-center md:justify-between'>
            <div className='flex flex-1 flex-col md:flex-row gap-3'>
              <Input allowClear value={keyword} placeholder={t('bidProjects.list.searchPlaceholder')} onChange={setKeyword} />
              <Select value={statusFilter} onChange={setStatusFilter} className='w-full md:w-56'>
                <Select.Option value='all'>{t('bidProjects.list.statusAll')}</Select.Option>
                <Select.Option value='draft'>{t('bidProjects.status.draft')}</Select.Option>
                <Select.Option value='awaiting_confirmation'>{t('bidProjects.status.awaiting_confirmation')}</Select.Option>
                <Select.Option value='generated'>{t('bidProjects.status.generated')}</Select.Option>
                <Select.Option value='editing'>{t('bidProjects.status.editing')}</Select.Option>
                <Select.Option value='exported'>{t('bidProjects.status.exported')}</Select.Option>
              </Select>
            </div>
          </div>

          <div className='grid grid-cols-1 md:grid-cols-4 gap-3'>
            <QuickActionCard icon={<FileText size={18} />} title={t('bidProjects.quickStart')} description={t('bidProjects.quickStartDesc')} onClick={() => void navigate('/app/bid-projects/new')} />
            <QuickActionCard icon={<FolderOpen size={18} />} title={t('bidProjects.importProject')} description={t('bidProjects.importProjectDesc')} onClick={() => void navigate('/app/bid-projects/new')} />
            <QuickActionCard icon={<ShieldCheck size={18} />} title={t('bidProjects.complianceCenter')} description={t('bidProjects.complianceCenterDesc')} onClick={() => void navigate('/app/bid-projects/new')} />
            <QuickActionCard icon={<DatabaseBackup size={18} />} title={t('bidProjects.list.knowledgeAssetsTitle')} description={t('bidProjects.list.knowledgeAssetsDesc')} onClick={() => void navigate('/app/bid-projects/new')} />
          </div>
        </div>

        {filteredProjects.length === 0 ? (
          <div className='card p-8 text-center text-secondary'>
            <div className='text-15px font-medium text-foreground mb-2'>{projects.length === 0 ? t('bidProjects.emptyTitle') : t('bidProjects.noPendingItems')}</div>
            <div className='text-13px mb-4'>{projects.length === 0 ? t('bidProjects.emptyDescription') : t('bidProjects.subtitle')}</div>
            <Button type='primary' onClick={() => void navigate('/app/bid-projects/new')}>
              {t('bidProjects.createFirstProject')}
            </Button>
          </div>
        ) : (
          <div className='grid grid-cols-1 gap-3'>
            {filteredProjects.map((project) => (
              <Card key={project.id} className='cursor-pointer' onClick={() => void navigate(resolveBidProjectRoute(project))}>
                <div className='flex flex-col gap-4 md:flex-row md:items-start md:justify-between'>
                  <div className='min-w-0 flex-1'>
                    <div className='flex flex-wrap items-center gap-2 mb-2'>
                      <div className='text-15px font-medium text-foreground'>{project.name}</div>
                      <Tag>{project.version}</Tag>
                      <Tag color={getStatusTagColor(project.status)}>{t(`bidProjects.status.${project.status}`)}</Tag>
                    </div>
                    <div className='text-13px text-secondary mb-1'>{project.company || t('bidProjects.pendingCompany')}</div>
                    <div className='text-12px text-secondary mb-3'>{t('bidProjects.updatedAt', { time: new Date(project.updatedAt).toLocaleString() })}</div>
                    <div className='flex flex-wrap gap-2 text-12px text-secondary'>
                      <span>{project.analysis.projectType}</span>
                      <span>·</span>
                      <span>{project.analysis.recommendedMethod}</span>
                      <span>·</span>
                      <span>{project.selectedTemplate}</span>
                    </div>
                  </div>
                  <div className='flex flex-col items-start md:items-end gap-3'>
                    <div className='flex flex-wrap gap-2 justify-end'>
                      {project.sourceOrigins.map((origin) => (
                        <Tag key={`${project.id}-${origin}`}>{origin}</Tag>
                      ))}
                    </div>
                    <div className='text-12px text-secondary'>{t('bidProjects.list.openIssues', { count: project.complianceIssues.filter((issue) => issue.status === 'open').length })}</div>
                    <Button
                      size='small'
                      type='secondary'
                      onClick={(event) => {
                        event.stopPropagation();
                        void navigate(resolveBidProjectRoute(project));
                      }}
                    >
                      {t('bidProjects.continueEditing')}
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </PageWrapper>
  );
}

function StatsCard({ label, value }: IStatsCardProps) {
  return (
    <div className='card p-4'>
      <div className='text-13px text-secondary mb-2'>{label}</div>
      <div className='text-24px font-medium text-foreground'>{value}</div>
    </div>
  );
}

function QuickActionCard({ icon, title, description, onClick }: IQuickActionCardProps) {
  return (
    <div className='card p-4 cursor-pointer hover:bg-hover transition-colors' onClick={onClick}>
      <div className='size-9 rd-full bg-fill-2 f-center mb-3 text-foreground'>{icon}</div>
      <div className='text-15px font-medium text-foreground mb-1'>{title}</div>
      <div className='text-13px text-secondary'>{description}</div>
    </div>
  );
}

function getStatusTagColor(status: string): 'arcoblue' | 'orange' | 'green' | 'red' {
  if (status === 'awaiting_confirmation' || status === 'planning') return 'orange';
  if (status === 'generated' || status === 'exported') return 'green';
  if (status === 'editing') return 'arcoblue';
  return 'red';
}

function resolveBidProjectRoute(project: IBidProjectDraft): string {
  if (project.status === 'awaiting_confirmation' || project.status === 'draft') {
    return `/app/bid-projects/${project.id}/analysis`;
  }
  if (project.status === 'generating' || project.status === 'analyzing' || project.status === 'planning') {
    return `/app/bid-projects/${project.id}/progress`;
  }
  return `/app/bid-projects/${project.id}/editor`;
}

interface IQuickActionCardProps {
  description: string;
  icon: React.ReactNode;
  onClick: () => void;
  title: string;
}

interface IStatsCardProps {
  label: string;
  value: number;
}
