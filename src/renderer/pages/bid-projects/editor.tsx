import { Button, Message, Spin, Tabs, Tag } from '@arco-design/web-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageWrapper from '@renderer/components/base/PageWrapper';
import MarkdownEditor from '@renderer/pages/conversation/preview/components/editors/MarkdownEditor';
import { useAuth } from '@renderer/context/AuthContext';
import { fetchVisibleAssistantsAsConfigs } from '@renderer/shared/agents/assistantAdapter';
import { resolveSudohubAssistantId } from '@renderer/shared/dify/sessionBinding';
import { DocumentConverter } from '@common/document/DocumentConverter';
import type { TBidProjectAiSectionKey } from '@common/bid-projects/types';
import { generateBidProjectAiSections, getBidProject, updateBidProject } from './storage';
import type { IBidProjectDetailView } from './types';

const ASSISTANT_PROMPTS = ['bidProjects.editor.prompt.explainSection', 'bidProjects.editor.prompt.formalTone', 'bidProjects.editor.prompt.twoAlternatives', 'bidProjects.editor.prompt.explainReviewIssue'];

export default function BidProjectEditorPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { projectId = '' } = useParams();
  const { ensureValidToken } = useAuth();
  const [project, setProject] = useState<IBidProjectDetailView | null>(null);
  const [markdown, setMarkdown] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isGeneratingAiSection, setIsGeneratingAiSection] = useState(false);
  const [selectedIssueId, setSelectedIssueId] = useState('');
  const [selectedSectionId, setSelectedSectionId] = useState('');
  const [assistantTab, setAssistantTab] = useState<'chat' | 'actions' | 'context'>('chat');
  const [assistantMessages, setAssistantMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string; actions?: string[] }>>([]);

  const onLoadProject = useCallback(async () => {
    setIsLoading(true);
    try {
      const nextProject = await getBidProject(projectId);
      setProject(nextProject);
    } catch (error) {
      console.error('[bid-projects] failed to load editor project', error);
      setProject(null);
      Message.error(t('bidProjects.analysisActionFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [projectId, t]);

  useEffect(() => {
    void onLoadProject();
  }, [onLoadProject]);

  const selectedIssue = useMemo(() => {
    return project?.complianceIssues.find((issue) => issue.id === selectedIssueId) || project?.complianceIssues[0] || null;
  }, [project?.complianceIssues, selectedIssueId]);

  const selectedSection = useMemo(() => {
    return project?.sections.find((section) => section.id === selectedSectionId) || project?.sections[0] || null;
  }, [project?.sections, selectedSectionId]);

  useEffect(() => {
    if (!project) return;
    setMarkdown(project.markdown || '');
    setSelectedIssueId((current) => current || project.complianceIssues[0]?.id || '');
    setSelectedSectionId((current) => current || project.sections[0]?.id || '');
    setAssistantMessages([
      {
        role: 'user',
        content: t('bidProjects.editor.defaultConversation.user'),
      },
      {
        role: 'assistant',
        content: t('bidProjects.editor.defaultConversation.assistant'),
        actions: [t('bidProjects.editor.action.applyCurrentSection'), t('bidProjects.editor.action.saveAlternative'), t('bidProjects.editor.action.explainBasis')],
      },
    ]);
  }, [project, t]);

  async function onSave() {
    if (!project) return;
    setIsSaving(true);
    try {
      const nextProject = await updateBidProject(project.id, { markdown, status: 'editing' });
      if (nextProject) {
        setProject(nextProject);
      }
      Message.success(t('common.saveSuccess'));
    } finally {
      setIsSaving(false);
    }
  }

  async function onApplyFix() {
    if (!project || !selectedIssue) return;
    const nextMarkdown = `${markdown}\n\n> ${t('bidProjects.fixSuggestionPrefix')}${selectedIssue.fixSuggestion}`;
    setMarkdown(nextMarkdown);
    const nextProject = await updateBidProject(project.id, { markdown: nextMarkdown, status: 'editing' });
    if (nextProject) {
      setProject(nextProject);
    }
    setAssistantMessages((current) => [
      ...current,
      {
        role: 'assistant',
        content: t('bidProjects.editor.fixAppliedMessage', { title: selectedIssue.title }),
        actions: [t('bidProjects.editor.action.applyCurrentSection'), t('bidProjects.editor.action.explainBasis')],
      },
    ]);
    Message.success(t('bidProjects.fixApplied'));
  }

  async function onGenerateAiSections(sectionKeys: TBidProjectAiSectionKey[]) {
    if (!project) return;
    setIsGeneratingAiSection(true);
    try {
      const accessToken = await ensureValidToken();
      const assistantConfigs = await fetchVisibleAssistantsAsConfigs(accessToken);
      const assistantId = await resolveSudohubAssistantId(assistantConfigs[0]?.id);
      const result = await generateBidProjectAiSections({
        projectId: project.id,
        sectionKeys,
        accessToken: accessToken || undefined,
        assistantId: assistantId || undefined,
      });
      if (!result) {
        Message.error(t('bidProjects.analysisActionFailed'));
        return;
      }
      setProject(result.detail);
      setMarkdown(result.detail.markdown);
      const fallbackCount = result.generatedSections.filter((section) => section.fallbackUsed).length;
      Message.success(
        fallbackCount > 0
          ? t('bidProjects.editorAiFallbackUsed', {
              count: fallbackCount,
              total: result.generatedSections.length,
            })
          : t('bidProjects.editorAiGenerated', { count: result.generatedSections.length })
      );
    } catch {
      Message.error(t('bidProjects.analysisActionFailed'));
    } finally {
      setIsGeneratingAiSection(false);
    }
  }

  async function onExport() {
    if (!project) return;
    setIsExporting(true);
    try {
      const converter = new DocumentConverter();
      const buffer = await converter.markdownToWord(markdown);
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${project.name || t('bidProjects.defaults.downloadName')}.docx`;
      anchor.click();
      URL.revokeObjectURL(url);
      const nextProject = await updateBidProject(project.id, { markdown, status: 'exported' });
      if (nextProject) {
        setProject(nextProject);
      }
      Message.success(t('bidProjects.exportSuccess'));
    } catch (error) {
      console.error(error);
      Message.error(t('bidProjects.exportFailed'));
    } finally {
      setIsExporting(false);
    }
  }

  function onAskAssistant(prompt: string) {
    setAssistantTab('chat');
    setAssistantMessages((current) => [
      ...current,
      { role: 'user', content: prompt },
      {
        role: 'assistant',
        content: t('bidProjects.editor.assistantReplyTemplate', { prompt }),
        actions: [t('bidProjects.editor.action.applyCurrentSection'), t('bidProjects.editor.action.saveAlternative'), t('bidProjects.editor.action.explainBasis')],
      },
    ]);
  }

  function onApplyAssistantAction(action: string) {
    if (!selectedSection) return;
    if (action === t('bidProjects.editor.action.applyCurrentSection')) {
      const applied = `${markdown}\n\n> ${t('bidProjects.editor.assistantTitle')}: ${t('bidProjects.editor.assistantSubtitle')}`;
      setMarkdown(applied);
      Message.success(action);
      return;
    }
    if (action === t('bidProjects.editor.action.saveAlternative')) {
      setAssistantMessages((current) => [
        ...current,
        {
          role: 'assistant',
          content: `${selectedSection.sectionTitle} alternative saved for later comparison.`,
        },
      ]);
      Message.success(action);
      return;
    }
    Message.success(action);
  }

  if (isLoading) {
    return (
      <PageWrapper title={t('bidProjects.editorTitle')} back={{ label: t('common.back'), onClick: () => void navigate('/app/bid-projects') }}>
        <div className='card p-6'>
          <Spin loading tip={t('bidProjects.analysisLoading')} />
        </div>
      </PageWrapper>
    );
  }

  if (!project) {
    return (
      <PageWrapper title={t('bidProjects.editorTitle')} back={{ label: t('common.back'), onClick: () => void navigate('/app/bid-projects') }}>
        <div className='card p-6 text-secondary'>{t('bidProjects.projectNotFound')}</div>
      </PageWrapper>
    );
  }

  return (
    <PageWrapper
      title={project.name}
      subtitle={t('bidProjects.editorSubtitle', { version: project.version, template: project.selectedTemplate })}
      back={{ label: t('common.back'), onClick: () => void navigate('/app/bid-projects') }}
      actions={
        <>
          <Button type='secondary' loading={isSaving} onClick={() => void onSave()}>
            {t('common.save')}
          </Button>
          <Button type='primary' loading={isExporting} onClick={() => void onExport()}>
            {t('bidProjects.exportDocx')}
          </Button>
        </>
      }
    >
      <div className='space-y-4'>
        <div className='grid grid-cols-[240px_minmax(0,1fr)_360px] gap-4 h-[calc(100vh-260px)] min-h-140'>
          <div className='card p-4 overflow-y-auto'>
            <div className='text-15px font-medium text-foreground mb-3'>{t('bidProjects.sectionNav')}</div>
            <div className='space-y-2'>
              {(project.sections.length > 0 ? project.sections : [{ id: 'default', sectionTitle: t('bidProjects.sections.notice'), status: 'generated' } as any]).map((section) => (
                <div key={section.id} className={`rd-2 px-3 py-2 text-13px cursor-pointer ${selectedSectionId === section.id ? 'bg-primary-1 border border-primary' : 'bg-fill-1'}`} onClick={() => setSelectedSectionId(section.id)}>
                  <div className='flex items-center justify-between gap-2'>
                    <span className='text-foreground'>{section.sectionTitle}</span>
                    <Tag size='small'>{section.status}</Tag>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className='card min-h-0 overflow-hidden flex flex-col'>
            <div className='px-4 py-3 border-b border-[var(--color-border-2)] flex items-center justify-between gap-4'>
              <div>
                <div className='text-15px font-medium text-foreground'>{t('bidProjects.documentEditor')}</div>
                <div className='text-12px text-secondary'>{selectedSection?.sectionTitle || t('bidProjects.sections.notice')}</div>
              </div>
              <div className='flex flex-wrap gap-2'>
                {project.assetHits.slice(0, 4).map((assetHit, index) => (
                  <Tag key={`${assetHit.assetKind}-${assetHit.label}-${index}`}>{assetHit.label}</Tag>
                ))}
              </div>
            </div>
            <div className='flex-1 min-h-0'>
              <MarkdownEditor value={markdown} onChange={setMarkdown} />
            </div>
          </div>

          <div className='card min-h-0 overflow-hidden flex flex-col'>
            <div className='px-3 pt-3'>
              <div className='text-15px font-medium text-foreground mb-2'>{t('bidProjects.editor.assistantTitle')}</div>
              <div className='text-12px text-secondary mb-3'>{t('bidProjects.editor.assistantSubtitle')}</div>
            </div>
            <Tabs activeTab={assistantTab} onChange={(value) => setAssistantTab(value as any)} className='flex-1 min-h-0 px-3'>
              <Tabs.TabPane key='chat' title={t('bidProjects.editor.chatTab')}>
                <div className='space-y-3 overflow-y-auto max-h-[calc(100vh-420px)] pr-1'>
                  {assistantMessages.map((message, index) => (
                    <div key={`${message.role}-${index}`} className={`rd-2 p-3 ${message.role === 'assistant' ? 'bg-fill-1' : 'bg-primary-1'}`}>
                      <div className='text-12px font-medium text-secondary mb-1'>{message.role === 'assistant' ? t('bidProjects.editor.assistantTitle') : t('bidProjects.editor.userLabel')}</div>
                      <div className='text-13px text-foreground whitespace-pre-wrap'>{message.content}</div>
                      {message.actions?.length ? (
                        <div className='flex flex-wrap gap-2 mt-3'>
                          {message.actions.map((action) => (
                            <Button key={action} size='mini' type={action === t('bidProjects.editor.action.applyCurrentSection') ? 'primary' : 'secondary'} onClick={() => onApplyAssistantAction(action)}>
                              {action}
                            </Button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
                <div className='grid grid-cols-1 gap-2 mt-4'>
                  {ASSISTANT_PROMPTS.map((promptKey) => (
                    <Button key={promptKey} type='secondary' long onClick={() => onAskAssistant(t(promptKey))}>
                      {t(promptKey)}
                    </Button>
                  ))}
                </div>
              </Tabs.TabPane>
              <Tabs.TabPane key='actions' title={t('bidProjects.editor.actionsTab')}>
                <div className='space-y-3'>
                  <ActionSection title={t('bidProjects.editor.action.currentSection')}>
                    <Button type='primary' long loading={isGeneratingAiSection} onClick={() => void onGenerateAiSections(['technical'])}>
                      {t('bidProjects.editorAiRewriteTechnical')}
                    </Button>
                    <Button type='secondary' long loading={isGeneratingAiSection} onClick={() => void onGenerateAiSections(['notice'])}>
                      {t('bidProjects.editorAiRewriteNotice')}
                    </Button>
                  </ActionSection>
                  <ActionSection title={t('bidProjects.editor.action.wholeDraft')}>
                    <Button type='secondary' long loading={isGeneratingAiSection} onClick={() => void onGenerateAiSections(['notice', 'instructions', 'contract', 'technical', 'responseFormats'])}>
                      {t('bidProjects.editor.action.regenerateCoreSections')}
                    </Button>
                    <Button type='secondary' long onClick={() => Message.success(t('bidProjects.editor.action.linkedGenerated'))}>
                      {t('bidProjects.editor.action.detectAffectedSections')}
                    </Button>
                  </ActionSection>
                  <ActionSection title={t('bidProjects.editor.action.reviewSupport')}>
                    <Button type='secondary' long onClick={() => selectedIssue && onAskAssistant(`${t('bidProjects.editor.action.explainSelectedIssue')}: ${selectedIssue.title}`)}>
                      {t('bidProjects.editor.action.explainSelectedIssue')}
                    </Button>
                    <Button type='secondary' long onClick={() => selectedIssue && onAskAssistant(`${t('bidProjects.editor.action.generateFixAlternative')}: ${selectedIssue.title}`)}>
                      {t('bidProjects.editor.action.generateFixAlternative')}
                    </Button>
                  </ActionSection>
                </div>
              </Tabs.TabPane>
              <Tabs.TabPane key='context' title={t('bidProjects.editor.contextTab')}>
                <div className='space-y-3 text-13px text-secondary'>
                  <ContextCard title={t('bidProjects.editor.context.currentProject')} items={project.assistantContext.contextLabels} />
                  <ContextCard title={t('bidProjects.editor.context.sourceOrigins')} items={project.sourceOrigins} />
                  <ContextCard title={t('bidProjects.editor.context.knowledgeAssets')} items={project.assetHits.map((item) => item.label)} />
                  <ContextCard title='Citations' items={project.citations.map((item) => `${item.title}${item.snippet ? ` · ${item.snippet}` : ''}`)} />
                  <ContextCard title={t('bidProjects.editor.context.versionHistory')} items={project.versions.map((item) => `${item.version} · ${item.summary}`)} />
                </div>
              </Tabs.TabPane>
            </Tabs>
          </div>
        </div>

        <div className='card p-4'>
          <div className='flex items-center justify-between gap-4 mb-3'>
            <div>
              <div className='text-15px font-medium text-foreground'>{t('bidProjects.compliancePanel')}</div>
              <div className='text-13px text-secondary'>{t('bidProjects.complianceSubtitle')}</div>
            </div>
            {selectedIssue ? (
              <div className='flex gap-2'>
                <Button type='secondary' onClick={() => selectedIssue && onAskAssistant(`${t('bidProjects.editor.action.explainSelectedIssue')}: ${selectedIssue.title}`)}>
                  {t('bidProjects.editor.askAiAboutIssue')}
                </Button>
                <Button type='primary' onClick={() => void onApplyFix()}>
                  {t('bidProjects.applyFix')}
                </Button>
              </div>
            ) : null}
          </div>
          <div className='grid grid-cols-[280px_minmax(0,1fr)] gap-4'>
            <div className='space-y-2'>
              {project.complianceIssues.map((issue) => (
                <div key={issue.id} className={`cursor-pointer rd-2 px-3 py-2 border ${selectedIssueId === issue.id ? 'border-primary bg-primary-1' : 'border-[var(--color-border-2)] bg-fill-1'}`} onClick={() => setSelectedIssueId(issue.id)}>
                  <div className='text-12px uppercase text-secondary mb-1'>{t(`bidProjects.complianceLevels.${issue.severity}`)}</div>
                  <div className='text-13px text-foreground'>{issue.title}</div>
                </div>
              ))}
            </div>
            {selectedIssue ? (
              <div className='rd-2 bg-fill-1 p-4'>
                <div className='text-15px font-medium text-foreground mb-2'>{selectedIssue.title}</div>
                <div className='space-y-2 text-13px text-secondary'>
                  <div>{selectedIssue.detail}</div>
                  <div>{t('bidProjects.issueLocation', { location: selectedIssue.sectionKey || t('bidProjects.defaults.pending') })}</div>
                  <div>{t('bidProjects.issueBasis', { basis: selectedIssue.basis })}</div>
                  <div>{t('bidProjects.issueFix', { fix: selectedIssue.fixSuggestion })}</div>
                  {selectedIssue.citations.length > 0 ? (
                    <div>
                      <div className='text-12px font-medium text-foreground mb-1'>Citations</div>
                      <div className='space-y-1'>
                        {selectedIssue.citations.map((citation, index) => (
                          <div key={`${citation.title}-${index}`} className='text-12px text-secondary'>
                            {citation.title}
                            {citation.snippet ? ` · ${citation.snippet}` : ''}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
                <div className='flex flex-wrap gap-2 mt-4'>
                  {selectedIssue.assetHits.map((assetHit, index) => (
                    <Tag key={`${assetHit.assetKind}-${assetHit.label}-${index}`}>{assetHit.label}</Tag>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </PageWrapper>
  );
}

function ActionSection({ children, title }: IActionSectionProps) {
  return (
    <div className='space-y-2'>
      <div className='text-13px font-medium text-foreground'>{title}</div>
      <div className='space-y-2'>{children}</div>
    </div>
  );
}

function ContextCard({ items, title }: IContextCardProps) {
  return (
    <div className='rd-2 bg-fill-1 p-3'>
      <div className='text-13px font-medium text-foreground mb-2'>{title}</div>
      {items.length === 0 ? (
        <div className='text-12px text-secondary'>No data yet.</div>
      ) : (
        items.map((item) => (
          <div key={item} className='text-12px text-secondary mb-1 last:mb-0'>
            {item}
          </div>
        ))
      )}
    </div>
  );
}

interface IActionSectionProps {
  children: React.ReactNode;
  title: string;
}

interface IContextCardProps {
  items: string[];
  title: string;
}
