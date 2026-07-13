import { Button, Message, Spin, Tag } from '@arco-design/web-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageWrapper from '@renderer/components/base/PageWrapper';
import { useAuth } from '@renderer/context/AuthContext';
import { fetchVisibleAssistantsAsConfigs } from '@renderer/shared/agents/assistantAdapter';
import { resolveSudohubAssistantId } from '@renderer/shared/dify/sessionBinding';
import { confirmBidProjectFact, generateBidProjectAiSections, getBidProject, parseBidProjectSources, rejectBidProjectFact, updateBidProject } from './storage';
import type { IBidProjectAssetHit, IBidProjectDetailView, IBidProjectFactFieldOption, IBidProjectFactItem, IBidProjectSourceItem } from './types';

const ASK_AI_PROMPTS = ['bidProjects.analysis.askAiWhyTemplate', 'bidProjects.analysis.askAiWhyConflict', 'bidProjects.analysis.askAiWhereFrom', 'bidProjects.analysis.askAiWhyMissing'];

export default function BidProjectAnalysisPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { projectId = '' } = useParams();
  const { ensureValidToken } = useAuth();
  const [project, setProject] = useState<IBidProjectDetailView | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isReparsing, setIsReparsing] = useState(false);
  const [isGeneratingAiDraft, setIsGeneratingAiDraft] = useState(false);
  const [pendingFactId, setPendingFactId] = useState('');
  const [askAiAnswer, setAskAiAnswer] = useState('');

  const onLoadProject = useCallback(async () => {
    setIsLoading(true);
    try {
      const nextProject = await getBidProject(projectId);
      setProject(nextProject);
    } catch (error) {
      console.error('[bid-projects] failed to load analysis project', error);
      setProject(null);
      Message.error(t('bidProjects.analysisActionFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [projectId, t]);

  useEffect(() => {
    void onLoadProject();
  }, [onLoadProject]);

  const shouldPoll = project?.status === 'analyzing' || Boolean(project?.sources.some((source) => source.parseStatus === 'pending'));

  useEffect(() => {
    if (!shouldPoll) return;
    const timer = setInterval(async () => {
      try {
        const nextProject = await getBidProject(projectId);
        if (nextProject) setProject(nextProject);
      } catch (error) {
        console.error('[bid-projects] polling failed', error);
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [shouldPoll, projectId]);

  const factsByField = useMemo(() => {
    const groups = new Map<string, IBidProjectFactItem[]>();
    for (const fact of project?.facts || []) {
      const list = groups.get(fact.fieldName) || [];
      list.push(fact);
      groups.set(fact.fieldName, list);
    }
    return Array.from(groups.entries());
  }, [project?.facts]);

  async function onReparseSources() {
    if (!project) return;
    setIsReparsing(true);
    try {
      const nextProject = await parseBidProjectSources(project.id);
      if (nextProject) {
        setProject(nextProject);
        Message.success(t('bidProjects.analysisReparseSuccess'));
      } else {
        Message.error(t('bidProjects.analysisActionFailed'));
      }
    } catch {
      Message.error(t('bidProjects.analysisActionFailed'));
    } finally {
      setIsReparsing(false);
    }
  }

  async function onUpdateFact(factId: string, action: 'confirm' | 'reject') {
    setPendingFactId(factId);
    try {
      const result = action === 'confirm' ? await confirmBidProjectFact(factId) : await rejectBidProjectFact(factId);
      if (!result.success) {
        Message.error(t('bidProjects.analysisActionFailed'));
        return;
      }
      const nextProject = await getBidProject(projectId);
      setProject(nextProject);
      Message.success(t(action === 'confirm' ? 'bidProjects.analysisFactConfirmSuccess' : 'bidProjects.analysisFactRejectSuccess'));
    } catch {
      Message.error(t('bidProjects.analysisActionFailed'));
    } finally {
      setPendingFactId('');
    }
  }

  async function onContinueToEditor() {
    if (!project) return;
    const nextProject = await updateBidProject(project.id, { status: 'planning' });
    if (nextProject) {
      setProject(nextProject);
    }
    void navigate(`/app/bid-projects/${project.id}/progress`);
  }

  async function onGenerateAiDraft() {
    if (!project) return;
    setIsGeneratingAiDraft(true);
    try {
      const accessToken = await ensureValidToken();
      const assistantConfigs = await fetchVisibleAssistantsAsConfigs(accessToken);
      const assistantId = await resolveSudohubAssistantId(assistantConfigs[0]?.id);
      const nextProject = await updateBidProject(project.id, { status: 'planning' });
      if (nextProject) {
        setProject(nextProject);
      }
      const result = await generateBidProjectAiSections({
        projectId: project.id,
        sectionKeys: ['notice', 'technical'],
        accessToken: accessToken || undefined,
        assistantId: assistantId || undefined,
      });
      if (!result) {
        Message.error(t('bidProjects.analysisActionFailed'));
        return;
      }
      setProject(result.detail);
      const fallbackCount = result.generatedSections.filter((section) => section.fallbackUsed).length;
      Message.success(
        fallbackCount > 0
          ? t('bidProjects.analysisAiFallbackUsed', {
              count: fallbackCount,
              total: result.generatedSections.length,
            })
          : t('bidProjects.analysisAiGenerated', { count: result.generatedSections.length })
      );
      void navigate(`/app/bid-projects/${project.id}/progress`);
    } catch {
      Message.error(t('bidProjects.analysisActionFailed'));
    } finally {
      setIsGeneratingAiDraft(false);
    }
  }

  function onAskAi(promptKey: string) {
    if (!project) return;
    if (promptKey === 'bidProjects.analysis.askAiWhyTemplate') {
      setAskAiAnswer(t('bidProjects.analysis.askAiAnswer.whyTemplate', { template: project.selectedTemplate }));
      return;
    }
    if (promptKey === 'bidProjects.analysis.askAiWhyConflict') {
      setAskAiAnswer(t('bidProjects.analysis.askAiAnswer.whyConflict'));
      return;
    }
    if (promptKey === 'bidProjects.analysis.askAiWhereFrom') {
      setAskAiAnswer(t('bidProjects.analysis.askAiAnswer.whereFrom'));
      return;
    }
    setAskAiAnswer(t('bidProjects.analysis.askAiAnswer.whyMissing'));
  }

  if (isLoading) {
    return (
      <PageWrapper title={t('bidProjects.analysisTitle')} back={{ label: t('common.back'), onClick: () => void navigate('/app/bid-projects') }}>
        <div className='card p-6'>
          <Spin loading tip={t('bidProjects.analysisLoading')} />
        </div>
      </PageWrapper>
    );
  }

  if (!project) {
    return (
      <PageWrapper title={t('bidProjects.analysisTitle')} back={{ label: t('common.back'), onClick: () => void navigate('/app/bid-projects') }}>
        <div className='card p-6 text-secondary'>{t('bidProjects.projectNotFound')}</div>
      </PageWrapper>
    );
  }

  return (
    <PageWrapper
      title={t('bidProjects.analysisTitle')}
      subtitle={t('bidProjects.analysisSubtitle')}
      back={{ label: t('common.back'), onClick: () => void navigate('/app/bid-projects/new') }}
      actions={
        <Button type='secondary' loading={isReparsing} onClick={() => void onReparseSources()}>
          {t('bidProjects.analysisRefresh')}
        </Button>
      }
    >
      <div className='space-y-4'>
        <div className='grid grid-cols-1 md:grid-cols-3 gap-3'>
          <SummaryCard title={t('bidProjects.analysis.projectType')} value={project.analysis.projectType} />
          <SummaryCard title={t('bidProjects.analysis.industry')} value={project.analysis.industry} />
          <SummaryCard title={t('bidProjects.analysis.recommendedMethod')} value={project.analysis.recommendedMethod} />
        </div>

        <div className='grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_420px] gap-4'>
          <div className='space-y-4'>
            <div className='card p-4'>
              <div className='text-15px font-medium text-foreground mb-3'>{t('bidProjects.analysisFacts')}</div>
              {factsByField.length === 0 ? (
                <div className='text-13px text-secondary'>{t('bidProjects.analysisNoFacts')}</div>
              ) : (
                <div className='space-y-3'>
                  {factsByField.map(([fieldName, facts]) => (
                    <FactGroupCard key={fieldName} fieldName={fieldName} facts={facts} pendingFactId={pendingFactId} onUpdateFact={onUpdateFact} />
                  ))}
                </div>
              )}
            </div>

            <div className='card p-4'>
              <div className='text-15px font-medium text-foreground mb-3'>{t('bidProjects.analysisSources')}</div>
              {project.sources.length === 0 ? (
                <div className='text-13px text-secondary'>{t('bidProjects.analysisNoSources')}</div>
              ) : (
                <div className='space-y-3'>
                  {project.sources.map((source) => (
                    <SourceCard key={source.id} source={source} />
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className='space-y-4'>
            <div className='card p-4'>
              <div className='text-15px font-medium text-foreground mb-3'>{t('bidProjects.detectedFields')}</div>
              <div className='space-y-2'>
                {project.analysis.detectedFields.map((field) => (
                  <div key={field.label} className='flex items-center justify-between gap-4 rd-2 bg-fill-1 px-3 py-2'>
                    <div className='text-13px text-secondary'>{field.label}</div>
                    <div className='text-13px text-foreground text-right'>{field.value}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className='card p-4'>
              <div className='text-15px font-medium text-foreground mb-3'>{t('bidProjects.analysis.templateRecommendation')}</div>
              <div className='space-y-2 text-13px text-secondary mb-4'>
                <div className='rd-2 bg-fill-1 px-3 py-2'>{project.selectedTemplate}</div>
                {project.templateOptions
                  .filter((item) => item !== project.selectedTemplate)
                  .map((template) => (
                    <div key={template} className='rd-2 bg-fill-1 px-3 py-2'>
                      {template}
                    </div>
                  ))}
              </div>
              <div className='text-15px font-medium text-foreground mb-3'>{t('bidProjects.analysis.platformKnowledgeAssets')}</div>
              <AssetHitTags assetHits={project.analysis.assetHits} />
              {project.citations.length > 0 ? (
                <div className='mt-4'>
                  <div className='text-13px text-secondary mb-2'>Top citations</div>
                  <div className='space-y-2'>
                    {project.citations.slice(0, 3).map((citation, index) => (
                      <div key={`${citation.title}-${index}`} className='rd-2 bg-fill-1 px-3 py-2 text-12px text-secondary'>
                        <div className='text-foreground font-medium'>{citation.title}</div>
                        <div>{citation.snippet || t('bidProjects.analysisNoFacts')}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <div className='card p-4'>
              <div className='text-15px font-medium text-foreground mb-3'>{t('bidProjects.riskHints')}</div>
              <div className='space-y-2 mb-4'>
                {project.analysis.riskHints.map((riskHint) => (
                  <div key={riskHint} className='rd-2 bg-fill-1 px-3 py-2 text-13px text-secondary'>
                    {riskHint}
                  </div>
                ))}
              </div>
              <div className='text-13px text-secondary mb-2'>{t('bidProjects.analysis.sourceOrigins')}</div>
              <div className='flex flex-wrap gap-2 mb-4'>
                {project.sourceOrigins.map((origin) => (
                  <Tag key={origin}>{origin}</Tag>
                ))}
              </div>
              <div className='flex flex-col gap-2'>
                <Button type='primary' loading={isGeneratingAiDraft} onClick={() => void onGenerateAiDraft()}>
                  {t('bidProjects.analysisGenerateAiDraft')}
                </Button>
                <Button type='secondary' onClick={() => void onContinueToEditor()}>
                  {t('bidProjects.analysisEnterEditorDirectly')}
                </Button>
              </div>
            </div>

            <div className='card p-4'>
              <div className='text-15px font-medium text-foreground mb-3'>{t('bidProjects.analysis.askAi')}</div>
              <div className='grid grid-cols-1 gap-2'>
                {ASK_AI_PROMPTS.map((promptKey) => (
                  <Button key={promptKey} type='secondary' long onClick={() => onAskAi(promptKey)}>
                    {t(promptKey)}
                  </Button>
                ))}
              </div>
              {askAiAnswer ? <div className='rd-2 bg-fill-1 px-3 py-3 mt-4 text-13px text-secondary'>{askAiAnswer}</div> : null}
            </div>
          </div>
        </div>
      </div>
    </PageWrapper>
  );
}

function SummaryCard({ title, value }: ISummaryCardProps) {
  return (
    <div className='card p-4'>
      <div className='text-13px text-secondary mb-2'>{title}</div>
      <div className='text-18px font-medium text-foreground'>{value}</div>
    </div>
  );
}

function FactGroupCard({ fieldName, facts, pendingFactId, onUpdateFact }: IFactGroupCardProps) {
  const { t } = useTranslation();
  const option = FACT_FIELD_OPTIONS.find((item) => item.value === fieldName);

  return (
    <div className='rd-2 bg-fill-1 p-3'>
      <div className='text-13px font-medium text-foreground mb-3'>{t(option?.label || 'bidProjects.fields.remark')}</div>
      <div className='space-y-2'>
        {facts.map((fact) => {
          const isPending = fact.status === 'pending';
          const isWorking = pendingFactId === fact.id;
          return (
            <div key={fact.id} className='rd-2 bg-[var(--color-bg-2)] px-3 py-3'>
              <div className='flex items-start justify-between gap-3 mb-2'>
                <div className='min-w-0'>
                  <div className='text-13px text-foreground break-all'>{fact.candidateValue}</div>
                  <div className='mt-1 text-12px text-secondary'>{`${Math.round(fact.confidence * 100)}%`}</div>
                </div>
                <Tag color={getFactStatusColor(fact.status)}>{t(getFactStatusLabel(fact.status))}</Tag>
              </div>
              {fact.sourceSnippet ? <div className='text-12px text-secondary mb-3 break-all'>{fact.sourceSnippet}</div> : null}
              {isPending ? (
                <div className='flex gap-2'>
                  <Button size='mini' type='primary' loading={isWorking} onClick={() => void onUpdateFact(fact.id, 'confirm')}>
                    {t('bidProjects.analysisConfirm')}
                  </Button>
                  <Button size='mini' type='secondary' disabled={isWorking} onClick={() => void onUpdateFact(fact.id, 'reject')}>
                    {t('bidProjects.analysisReject')}
                  </Button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SourceCard({ source }: ISourceCardProps) {
  const { t } = useTranslation();

  return (
    <div className='rd-2 bg-fill-1 p-3'>
      <div className='flex items-center justify-between gap-3 mb-2'>
        <div className='min-w-0'>
          <div className='truncate text-13px text-foreground'>{source.fileName}</div>
          <div className='text-12px text-secondary'>
            {Math.max(1, Math.round(source.size / 1024))} KB · {source.origin}
          </div>
        </div>
        <Tag>{t(`bidProjects.analysisSourceStatus.${source.parseStatus}`)}</Tag>
      </div>
      {source.summary ? <div className='text-12px text-secondary mb-2'>{t('bidProjects.analysisSourceSummary', { summary: source.summary })}</div> : null}
      {source.parseError ? <div className='text-12px text-danger'>{t('bidProjects.analysisSourceError', { error: source.parseError })}</div> : null}
      {source.parseStatus === 'skipped' && !source.filePath ? <div className='text-12px text-secondary'>{t('bidProjects.analysisSourceMissing')}</div> : null}
    </div>
  );
}

function AssetHitTags({ assetHits }: IAssetHitTagsProps) {
  if (assetHits.length === 0) {
    return <div className='text-13px text-secondary'>No asset hits yet.</div>;
  }

  return (
    <div className='flex flex-wrap gap-2'>
      {assetHits.map((assetHit, index) => (
        <Tag key={`${assetHit.assetKind}-${assetHit.label}-${index}`}>{assetHit.label}</Tag>
      ))}
    </div>
  );
}

function getFactStatusLabel(status: string): string {
  if (status === 'confirmed') return 'bidProjects.analysisFactConfirmed';
  if (status === 'rejected') return 'bidProjects.analysisFactRejected';
  return 'bidProjects.analysisFactPending';
}

function getFactStatusColor(status: string): 'green' | 'red' | 'arcoblue' {
  if (status === 'confirmed') return 'green';
  if (status === 'rejected') return 'red';
  return 'arcoblue';
}

const FACT_FIELD_OPTIONS: IBidProjectFactFieldOption[] = [
  { value: 'name', label: 'bidProjects.fields.name' },
  { value: 'company', label: 'bidProjects.fields.company' },
  { value: 'budget', label: 'bidProjects.fields.budget' },
  { value: 'projectType', label: 'bidProjects.fields.projectType' },
  { value: 'target', label: 'bidProjects.fields.target' },
  { value: 'duration', label: 'bidProjects.fields.duration' },
  { value: 'procurementMethod', label: 'bidProjects.fields.procurementMethod' },
];

interface ISummaryCardProps {
  title: string;
  value: string;
}

interface IFactGroupCardProps {
  facts: IBidProjectFactItem[];
  fieldName: string;
  onUpdateFact: (factId: string, action: 'confirm' | 'reject') => Promise<void>;
  pendingFactId: string;
}

interface ISourceCardProps {
  source: IBidProjectSourceItem;
}

interface IAssetHitTagsProps {
  assetHits: IBidProjectAssetHit[];
}
