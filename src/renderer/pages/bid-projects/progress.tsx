import { Button, Progress, Steps, Tag } from '@arco-design/web-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageWrapper from '@renderer/components/base/PageWrapper';
import { getBidProject, updateBidProject } from './storage';
import type { IBidProjectDetailView } from './types';

const STAGES = [
  { key: 'parsing', percent: 12 },
  { key: 'facts', percent: 24 },
  { key: 'template', percent: 36 },
  { key: 'planning', percent: 52 },
  { key: 'knowledge', percent: 68 },
  { key: 'notice', percent: 80 },
  { key: 'technical', percent: 92 },
  { key: 'merge', percent: 100 },
] as const;

export default function BidProjectProgressPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { projectId = '' } = useParams();
  const [project, setProject] = useState<IBidProjectDetailView | null>(null);
  const [stageIndex, setStageIndex] = useState(4);

  const onLoadProject = useCallback(async () => {
    try {
      const nextProject = await getBidProject(projectId);
      setProject(nextProject);
      if (nextProject?.status === 'generated' || nextProject?.status === 'editing' || nextProject?.status === 'exported') {
        setStageIndex(STAGES.length - 1);
      }
    } catch (error) {
      console.error('[bid-projects] failed to load progress project', error);
      setProject(null);
    }
  }, [projectId]);

  useEffect(() => {
    void onLoadProject();
  }, [onLoadProject]);

  const currentStage = STAGES[stageIndex] || STAGES[0];
  const chapterPlan = useMemo(() => {
    return project?.sections.length ? project.sections : [];
  }, [project?.sections]);

  async function onCompleteAndEnterEditor() {
    if (project) {
      const nextProject = await updateBidProject(project.id, { status: 'generated' });
      if (nextProject) setProject(nextProject);
    }
    void navigate(`/app/bid-projects/${projectId}/editor`);
  }

  return (
    <PageWrapper title={t('bidProjects.progress.title')} subtitle={t('bidProjects.progress.subtitle')} back={{ label: t('common.back'), onClick: () => void navigate(`/app/bid-projects/${projectId}/analysis`) }}>
      {!project ? (
        <div className='card p-6 text-secondary'>{t('bidProjects.analysisLoading')}</div>
      ) : (
        <div className='space-y-4'>
          <div className='card p-4'>
            <div className='flex items-center justify-between gap-4 mb-4'>
              <div>
                <div className='text-15px font-medium text-foreground'>{t('bidProjects.progress.total')}</div>
                <div className='text-13px text-secondary'>{t(`bidProjects.progress.stage.${currentStage.key}`)}</div>
              </div>
              <div className='flex gap-2'>
                <Button type='secondary' onClick={() => setStageIndex((current) => Math.min(STAGES.length - 1, current + 1))}>
                  {t('bidProjects.progress.advance')}
                </Button>
                <Button type='primary' onClick={() => void onCompleteAndEnterEditor()}>
                  {t('bidProjects.progress.completeButton')}
                </Button>
              </div>
            </div>
            <Progress percent={currentStage.percent} showText />
          </div>

          <div className='grid grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)] gap-4'>
            <div className='card p-4'>
              <div className='text-15px font-medium text-foreground mb-4'>{t('bidProjects.progress.currentStage')}</div>
              <Steps direction='vertical' current={stageIndex} size='small'>
                {STAGES.map((stage) => (
                  <Steps.Step key={stage.key} title={t(`bidProjects.progress.stage.${stage.key}`)} />
                ))}
              </Steps>
            </div>

            <div className='space-y-4'>
              <div className='card p-4'>
                <div className='text-15px font-medium text-foreground mb-4'>{t('bidProjects.progress.chapterPlan')}</div>
                <div className='space-y-2'>
                  {chapterPlan.map((section) => (
                    <div key={section.id} className='flex items-center justify-between gap-3 rd-2 bg-fill-1 px-3 py-2'>
                      <div className='text-13px text-foreground'>{section.sectionTitle}</div>
                      <Tag>{section.status}</Tag>
                    </div>
                  ))}
                </div>
              </div>

              <div className='card p-4'>
                <div className='text-15px font-medium text-foreground mb-4'>{t('bidProjects.progress.logs')}</div>
                <div className='space-y-2'>
                  <div className='rd-2 bg-fill-1 px-3 py-2 text-13px text-secondary'>{t(`bidProjects.progress.log.${currentStage.key}`)}</div>
                  <div className='rd-2 bg-fill-1 px-3 py-2 text-13px text-secondary'>{t('bidProjects.progress.log.assetMatching')}</div>
                </div>
              </div>

              <div className='card p-4'>
                <div className='text-15px font-medium text-foreground mb-2'>{t('bidProjects.progress.complete')}</div>
                <div className='text-13px text-secondary mb-4'>{t('bidProjects.progress.completeHint')}</div>
                <Button type='primary' onClick={() => void onCompleteAndEnterEditor()}>
                  {t('bidProjects.progress.enterEditor')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </PageWrapper>
  );
}
