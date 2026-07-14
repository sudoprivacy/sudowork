import { Button, Input, Message, Spin, Tabs, Tag } from '@arco-design/web-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageWrapper from '@renderer/components/base/PageWrapper';
import MarkdownEditor from '@renderer/pages/conversation/preview/components/editors/MarkdownEditor';
import { useAuth } from '@renderer/context/AuthContext';
import { fetchVisibleAssistantsAsConfigs } from '@renderer/shared/agents/assistantAdapter';
import { resolveSudohubAssistantId } from '@renderer/shared/dify/sessionBinding';
import { DocumentConverter } from '@common/document/DocumentConverter';
import type { TBidProjectAiSectionKey, TBidProjectAssistantIntent } from '@common/bid-projects/types';
import { chatBidProjectAssistant, generateBidProjectAiSections, getBidProject, updateBidProject } from './storage';
import type { IBidProjectDetailView, IBidProjectSectionItem } from './types';

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
  const [isChatting, setIsChatting] = useState(false);
  const [alternatives, setAlternatives] = useState<Array<{ id: string; sectionTitle: string; content: string }>>([]);
  const [lastAssistantContent, setLastAssistantContent] = useState('');
  const [chatInput, setChatInput] = useState('');
  const assistantMessagesRef = useRef<HTMLDivElement | null>(null);

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

  useEffect(() => {
    if (!assistantMessagesRef.current) return;
    assistantMessagesRef.current.scrollTop = assistantMessagesRef.current.scrollHeight;
  }, [assistantMessages]);

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

  function detectIntentFromPrompt(prompt: string): TBidProjectAssistantIntent {
    if (prompt === t('bidProjects.editor.prompt.explainSection')) return 'explainSection';
    if (prompt === t('bidProjects.editor.prompt.formalTone')) return 'rewriteSection';
    if (prompt === t('bidProjects.editor.prompt.twoAlternatives')) return 'twoAlternatives';
    if (prompt === t('bidProjects.editor.prompt.explainReviewIssue')) return 'explainIssue';
    return 'chat';
  }

  function resolveActionButtons(intent: TBidProjectAssistantIntent): string[] {
    if (intent === 'twoAlternatives' || intent === 'rewriteSection') {
      return [t('bidProjects.editor.action.applyCurrentSection'), t('bidProjects.editor.action.saveAlternative'), t('bidProjects.editor.action.explainBasis')];
    }
    if (intent === 'explainIssue' || intent === 'fixIssue') {
      return [t('bidProjects.editor.action.applyCurrentSection'), t('bidProjects.editor.action.explainBasis')];
    }
    return [t('bidProjects.editor.action.explainBasis')];
  }

  async function onAskAssistant(prompt: string) {
    if (!project || isChatting) return;
    setAssistantTab('chat');
    const intent = detectIntentFromPrompt(prompt);
    setAssistantMessages((current) => [...current, { role: 'user', content: prompt }]);
    setIsChatting(true);
    try {
      const accessToken = await ensureValidToken();
      const assistantConfigs = await fetchVisibleAssistantsAsConfigs(accessToken);
      const assistantId = await resolveSudohubAssistantId(assistantConfigs[0]?.id);
      const result = await chatBidProjectAssistant({
        projectId: project.id,
        prompt,
        intent,
        sectionKey: (selectedSection?.sectionKey as TBidProjectAiSectionKey) || undefined,
        sectionMarkdown: selectedSection ? extractSectionMarkdown(markdown, selectedSection) : undefined,
        issueTitle: intent === 'explainIssue' ? selectedIssue?.title : undefined,
        issueDetail: intent === 'explainIssue' ? selectedIssue?.detail : undefined,
        issueBasis: intent === 'explainIssue' ? selectedIssue?.basis : undefined,
        accessToken: accessToken || undefined,
        assistantId: assistantId || undefined,
      });
      const content = result?.content?.trim() || t('bidProjects.editor.emptyReply');
      setLastAssistantContent(content);
      setAssistantMessages((current) => [
        ...current,
        {
          role: 'assistant',
          content,
          actions: resolveActionButtons(intent),
        },
      ]);
    } catch (error) {
      console.error('[bid-projects] assistant chat failed', error);
      Message.error(t('bidProjects.editor.chatFailed'));
    } finally {
      setIsChatting(false);
    }
  }

  function onApplyAssistantAction(action: string) {
    if (!selectedSection) return;
    if (action === t('bidProjects.editor.action.applyCurrentSection')) {
      if (!lastAssistantContent) {
        Message.warning(t('bidProjects.editor.applyNoContent'));
        return;
      }
      const nextMarkdown = replaceSectionMarkdown(markdown, selectedSection, lastAssistantContent);
      setMarkdown(nextMarkdown);
      Message.success(action);
      return;
    }
    if (action === t('bidProjects.editor.action.saveAlternative')) {
      if (!lastAssistantContent) {
        Message.warning(t('bidProjects.editor.applyNoContent'));
        return;
      }
      const id = `alt-${Date.now()}`;
      setAlternatives((current) => [{ id, sectionTitle: selectedSection.sectionTitle, content: lastAssistantContent }, ...current]);
      Message.success(action);
      return;
    }
    Message.success(action);
  }

  async function onGenerateFixAlternative() {
    if (!project || !selectedIssue || isChatting) return;
    setAssistantTab('chat');
    setAssistantMessages((current) => [...current, { role: 'user', content: t('bidProjects.editor.action.generateFixAlternative') }]);
    setIsChatting(true);
    try {
      const accessToken = await ensureValidToken();
      const assistantConfigs = await fetchVisibleAssistantsAsConfigs(accessToken);
      const assistantId = await resolveSudohubAssistantId(assistantConfigs[0]?.id);
      const result = await chatBidProjectAssistant({
        projectId: project.id,
        prompt: t('bidProjects.editor.action.generateFixAlternative'),
        intent: 'fixIssue',
        sectionKey: (selectedSection?.sectionKey as TBidProjectAiSectionKey) || undefined,
        sectionMarkdown: selectedSection ? extractSectionMarkdown(markdown, selectedSection) : undefined,
        issueTitle: selectedIssue.title,
        issueDetail: selectedIssue.detail,
        issueBasis: selectedIssue.basis,
        accessToken: accessToken || undefined,
        assistantId: assistantId || undefined,
      });
      const content = result?.content?.trim() || t('bidProjects.editor.emptyReply');
      setLastAssistantContent(content);
      setAssistantMessages((current) => [
        ...current,
        {
          role: 'assistant',
          content,
          actions: resolveActionButtons('fixIssue'),
        },
      ]);
    } catch (error) {
      console.error('[bid-projects] fix alternative failed', error);
      Message.error(t('bidProjects.editor.chatFailed'));
    } finally {
      setIsChatting(false);
    }
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
        <div className='grid grid-cols-[210px_minmax(0,1.45fr)_320px] gap-4 h-[calc(100vh-250px)] min-h-140'>
          <div className='card p-3 overflow-y-auto'>
            <div className='text-15px font-medium text-foreground mb-2'>{t('bidProjects.sectionNav')}</div>
            <div className='space-y-2'>
              {(project.sections.length > 0 ? project.sections : [{ id: 'default', sectionTitle: t('bidProjects.sections.notice'), status: 'generated' } as any]).map((section) => (
                <div key={section.id} className={`rd-2 px-3 py-2 text-13px cursor-pointer ${selectedSectionId === section.id ? 'bg-primary-1 border border-primary' : 'bg-fill-1'}`} onClick={() => setSelectedSectionId(section.id)}>
                  <div className='flex items-start justify-between gap-2'>
                    <span className='text-foreground'>{section.sectionTitle}</span>
                    <Tag size='small'>{section.status}</Tag>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className='card min-h-0 overflow-hidden flex flex-col'>
            <div className='px-4 py-2.5 border-b border-[var(--color-border-2)] flex items-start justify-between gap-3'>
              <div>
                <div className='text-15px font-medium text-foreground'>{t('bidProjects.documentEditor')}</div>
                <div className='text-12px text-secondary'>{selectedSection?.sectionTitle || t('bidProjects.sections.notice')}</div>
              </div>
              <div className='flex flex-wrap gap-1.5 max-w-180px justify-end'>
                {project.assetHits.slice(0, 3).map((assetHit, index) => (
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
                <div className='flex min-h-0 h-[calc(100vh-420px)] flex-col'>
                  <div ref={assistantMessagesRef} className='flex-1 space-y-3 overflow-y-auto pr-1'>
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
                  <div className='mt-3 border-t border-[var(--color-border-2)] bg-[var(--color-bg-1)] pt-3'>
                    <div className='grid grid-cols-1 gap-2'>
                      <div className='flex items-end gap-2'>
                        <Input.TextArea
                          value={chatInput}
                          onChange={setChatInput}
                          placeholder={t('bidProjects.editor.chatInputPlaceholder')}
                          autoSize={{ minRows: 2, maxRows: 6 }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                              event.preventDefault();
                              const value = chatInput.trim();
                              if (!value || isChatting) return;
                              setChatInput('');
                              void onAskAssistant(value);
                            }
                          }}
                        />
                        <Button
                          type='primary'
                          loading={isChatting}
                          disabled={!chatInput.trim()}
                          onClick={() => {
                            const value = chatInput.trim();
                            if (!value) return;
                            setChatInput('');
                            void onAskAssistant(value);
                          }}
                        >
                          {t('bidProjects.editor.chatSend')}
                        </Button>
                      </div>
                      <div className='text-12px text-secondary'>{t('bidProjects.editor.chatQuickPrompts')}</div>
                      {ASSISTANT_PROMPTS.map((promptKey) => (
                        <Button key={promptKey} type='secondary' long loading={isChatting} onClick={() => void onAskAssistant(t(promptKey))}>
                          {t(promptKey)}
                        </Button>
                      ))}
                    </div>
                    {alternatives.length > 0 ? (
                      <div className='mt-4 space-y-2'>
                        <div className='text-13px text-secondary'>{t('bidProjects.editor.savedAlternativesTitle')}</div>
                        {alternatives.map((alt) => (
                          <div key={alt.id} className='rd-2 bg-fill-1 px-3 py-2'>
                            <div className='text-12px text-secondary mb-1'>{alt.sectionTitle}</div>
                            <div className='text-13px text-foreground whitespace-pre-wrap break-words'>{alt.content}</div>
                            <div className='mt-2 flex gap-2'>
                              <Button
                                size='mini'
                                type='primary'
                                onClick={() => {
                                  if (!selectedSection) return;
                                  setMarkdown(replaceSectionMarkdown(markdown, selectedSection, alt.content));
                                  Message.success(t('bidProjects.editor.action.applyCurrentSection'));
                                }}
                              >
                                {t('bidProjects.editor.action.applyCurrentSection')}
                              </Button>
                              <Button size='mini' type='text' onClick={() => setAlternatives((current) => current.filter((item) => item.id !== alt.id))}>
                                {t('common.remove')}
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
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
                    <Button type='secondary' long loading={isChatting} onClick={() => selectedIssue && onAskAssistant(t('bidProjects.editor.prompt.explainReviewIssue'))}>
                      {t('bidProjects.editor.action.explainSelectedIssue')}
                    </Button>
                    <Button type='secondary' long loading={isChatting} onClick={() => void onGenerateFixAlternative()}>
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
                <Button type='secondary' loading={isChatting} onClick={() => selectedIssue && void onAskAssistant(t('bidProjects.editor.prompt.explainReviewIssue'))}>
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

function extractSectionMarkdown(markdown: string, section: IBidProjectSectionItem): string {
  const heading = `## ${section.sectionTitle}`;
  const start = markdown.indexOf(heading);
  if (start === -1) return '';
  const startContent = start + heading.length;
  const nextHeading = markdown.indexOf('\n## ', startContent);
  const end = nextHeading === -1 ? markdown.length : nextHeading;
  return markdown.slice(startContent, end).trim();
}

function replaceSectionMarkdown(markdown: string, section: IBidProjectSectionItem, nextContent: string): string {
  const heading = `## ${section.sectionTitle}`;
  const start = markdown.indexOf(heading);
  const trimmed = nextContent.trim();
  if (start === -1) {
    return `${markdown.trimEnd()}\n\n${heading}\n\n${trimmed}\n`;
  }
  const startContent = start + heading.length;
  const nextHeading = markdown.indexOf('\n## ', startContent);
  const end = nextHeading === -1 ? markdown.length : nextHeading;
  return `${markdown.slice(0, startContent)}\n\n${trimmed}\n${markdown.slice(end)}`;
}
