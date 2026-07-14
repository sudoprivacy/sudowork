import { ipcBridge } from '@/common';
import type { IBidProjectAiGenerateInput, IBidProjectAssetHit, IBidProjectAssistantChatInput, IBidProjectAssistantChatResult } from '@common/bid-projects/types';
import i18n from '@renderer/i18n';
import type { IBidProjectAiGenerateViewResult, IBidProjectCreateInput, IBidProjectDetail, IBidProjectDetailView, IBidProjectDetectedFieldItem, IBidProjectDraft, IBidProjectEntity, IBidProjectFactItem, IBidProjectSectionItem, IBidProjectSourceItem, TBidProjectFactStatus } from './types';

function getDefaultMarkdown(): string {
  return i18n.t('bidProjects.defaultMarkdown');
}

function formatProjectType(value: string): string {
  if (value === 'goods') return i18n.t('bidProjects.new.options.projectType.goods');
  if (value === 'service') return i18n.t('bidProjects.new.options.projectType.service');
  if (value === 'engineering') return i18n.t('bidProjects.new.options.projectType.engineering');
  return value || i18n.t('bidProjects.defaults.projectType');
}

function formatProcurementMethod(value: string, budget: string): string {
  if (value === 'direct') return i18n.t('bidProjects.new.options.procurementMethod.direct');
  if (value === 'public') return i18n.t('bidProjects.new.options.procurementMethod.public');
  if (value === 'consulting') return i18n.t('bidProjects.new.options.procurementMethod.consulting');
  if (value === 'negotiation') return i18n.t('bidProjects.new.options.procurementMethod.negotiation');
  return value || (Number(budget.replace(/[^\d.]/g, '')) >= 200 ? i18n.t('bidProjects.defaults.recommendedMethodPublic') : i18n.t('bidProjects.defaults.recommendedMethodConsulting'));
}

function createAnalysis(project: { budget: string; projectType: string; target: string; duration: string; company: string; procurementMethod: string; name: string; facts: IBidProjectFactItem[]; assetHits: IBidProjectAssetHit[]; sourceOrigins: string[] }) {
  const projectType = formatProjectType(project.projectType);
  const industry = project.target.includes('服务器') || project.target.includes('信息') ? i18n.t('bidProjects.defaults.industryInfo') : i18n.t('bidProjects.defaults.industryGeneral');
  const recommendedMethod = formatProcurementMethod(project.procurementMethod, project.budget);
  return {
    projectType,
    industry,
    recommendedMethod,
    riskHints: buildRiskHints(project),
    detectedFields: buildDetectedFields(project),
    assetHits: project.assetHits,
    sourceOrigins: project.sourceOrigins as any,
  };
}

function pickFactValue(facts: IBidProjectFactItem[], fieldName: string): string {
  const candidates = facts.filter((fact) => fact.fieldName === fieldName && fact.status !== 'rejected');
  if (candidates.length === 0) return '';
  const preferred = candidates.find((fact) => fact.status === 'confirmed');
  if (preferred?.candidateValue) return preferred.candidateValue;
  const sorted = [...candidates].sort((a, b) => b.confidence - a.confidence);
  return sorted[0]?.candidateValue || '';
}

function buildDetectedFields(project: { budget: string; target: string; duration: string; company: string; name: string; facts?: IBidProjectFactItem[] }): IBidProjectDetectedFieldItem[] {
  const facts = project.facts || [];
  const factName = pickFactValue(facts, 'name');
  const factCompany = pickFactValue(facts, 'company');
  const factBudget = pickFactValue(facts, 'budget');
  const factTarget = pickFactValue(facts, 'target');
  const factDuration = pickFactValue(facts, 'duration');
  return [
    { label: i18n.t('bidProjects.detectedFieldLabels.projectName'), value: factName || project.name || i18n.t('bidProjects.defaults.unnamedProject') },
    { label: i18n.t('bidProjects.detectedFieldLabels.company'), value: factCompany || project.company || i18n.t('bidProjects.defaults.pending') },
    { label: i18n.t('bidProjects.detectedFieldLabels.budget'), value: factBudget || project.budget || i18n.t('bidProjects.defaults.pending') },
    { label: i18n.t('bidProjects.detectedFieldLabels.target'), value: factTarget || project.target || i18n.t('bidProjects.defaults.pending') },
    { label: i18n.t('bidProjects.detectedFieldLabels.duration'), value: factDuration || project.duration || i18n.t('bidProjects.defaults.pending') },
  ];
}

function buildRiskHints(project: { budget: string; procurementMethod: string; target: string }): string[] {
  const hints = [i18n.t('bidProjects.riskHintItems.acceptance')];
  if (!project.procurementMethod) hints.push(i18n.t('bidProjects.riskHintItems.procurementMethodMissing'));
  if (!project.budget) hints.push(i18n.t('bidProjects.riskHintItems.budgetMissing'));
  if (!project.target) hints.push(i18n.t('bidProjects.riskHintItems.targetMissing'));
  hints.push(i18n.t('bidProjects.riskHintItems.durationBoundary'));
  return hints;
}

function createClauseGroups(projectType: string) {
  return [
    {
      title: i18n.t('bidProjects.clauseGroups.qualification'),
      clauses: [i18n.t('bidProjects.clauseItems.independentLiability'), i18n.t('bidProjects.clauseItems.technicalCapability'), i18n.t('bidProjects.clauseItems.recentExperience', { projectType: projectType || i18n.t('bidProjects.defaults.projectType') })],
    },
    {
      title: i18n.t('bidProjects.clauseGroups.technical'),
      clauses: [i18n.t('bidProjects.clauseItems.technicalCompleteness'), i18n.t('bidProjects.clauseItems.implementationPlan'), i18n.t('bidProjects.clauseItems.maintenanceCapability')],
    },
    {
      title: i18n.t('bidProjects.clauseGroups.commercial'),
      clauses: [i18n.t('bidProjects.clauseItems.teamConfiguration'), i18n.t('bidProjects.clauseItems.afterSalesCommitment')],
    },
    {
      title: i18n.t('bidProjects.clauseGroups.price'),
      clauses: [i18n.t('bidProjects.clauseItems.priceFormula')],
    },
  ];
}

function parseSections(markdown: string): IBidProjectSectionItem[] {
  return markdown
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('## '))
    .map((line, index) => ({
      id: `section-${index + 1}`,
      projectId: '',
      draftId: '',
      sectionKey: 'technical',
      sectionTitle: line.replace(/^##\s+/, ''),
      sortOrder: index,
      contentMarkdown: '',
      status: 'generated',
      isLocked: false,
      citations: [] as any[],
      assetHits: [] as any[],
      createdAt: 0,
      updatedAt: 0,
    }));
}

function buildPendingItems(project: IBidProjectDetail['project'], sources: IBidProjectSourceItem[]): string[] {
  const items: string[] = [];
  if (!project.company) items.push(i18n.t('bidProjects.pendingItems.company'));
  if (!project.budget) items.push(i18n.t('bidProjects.pendingItems.budget'));
  if (!project.duration) items.push(i18n.t('bidProjects.pendingItems.duration'));
  if (!project.procurementMethod) items.push(i18n.t('bidProjects.pendingItems.procurementMethod'));
  if (sources.length === 0) items.push(i18n.t('bidProjects.pendingItems.sources'));
  return items;
}

function mapProjectDetail(detail: IBidProjectDetail): IBidProjectDetailView {
  const project = detail.project;
  const facts: IBidProjectFactItem[] = detail.facts || [];
  const sources: IBidProjectSourceItem[] = detail.sources || [];
  const rawSections = detail.sections || [];
  const reviewIssues = detail.reviewIssues || [];
  const versions = detail.versions || [];
  const markdown = detail.currentDraft?.markdown || getDefaultMarkdown();
  const files = sources.map((source) => ({
    id: source.id,
    name: source.fileName,
    path: source.filePath,
    size: source.size,
    type: source.mimeType,
    origin: source.origin,
  }));
  const detectedFields = buildDetectedFields({
    budget: project.budget,
    target: project.target,
    duration: project.duration,
    company: project.company,
    name: project.name,
    facts,
  });
  const sections = rawSections.length > 0 ? rawSections : parseSections(markdown);
  const sourceSummaries = sources.filter((source) => source.summary).map((source) => `${source.fileName}：${source.summary}`);
  const pendingItems = buildPendingItems(project, sources);
  const assetHits = Array.from(new Map(rawSections.flatMap((section) => (section.assetHits || []).map((assetHit) => [`${assetHit.assetKind}::${assetHit.label}::${assetHit.refId || ''}`, assetHit]))).values());
  const citations = rawSections.flatMap((section) => section.citations || []);
  const sourceOrigins = Array.from(new Set(sources.map((source) => source.origin)));

  return {
    id: project.id,
    name: project.name,
    company: project.company,
    budget: project.budget,
    projectType: project.projectType,
    target: project.target,
    duration: project.duration,
    procurementMethod: project.procurementMethod,
    remark: project.remark,
    status: project.status,
    version: project.currentVersion,
    updatedAt: project.updatedAt,
    files,
    facts,
    sources,
    analysis: createAnalysis({
      budget: project.budget,
      projectType: project.projectType,
      target: project.target,
      duration: project.duration,
      company: project.company,
      procurementMethod: project.procurementMethod,
      name: project.name,
      facts,
      assetHits,
      sourceOrigins,
    }),
    detectedFields,
    templateOptions: [i18n.t('bidProjects.defaults.templateUnicomDirect'), i18n.t('bidProjects.defaults.templateNegotiation'), i18n.t('bidProjects.defaults.templateRecruitment')],
    selectedTemplate: project.selectedTemplate || i18n.t('bidProjects.defaults.defaultTemplate'),
    clauseGroups: createClauseGroups(project.projectType),
    sections,
    sourceSummaries,
    pendingItems,
    markdown,
    complianceIssues: reviewIssues,
    versions,
    assistantContext: detail.assistantContext || {
      mode: 'project',
      contextLabels: [],
      sourceOrigins: [],
      assetKinds: [],
    },
    sourceOrigins: sourceOrigins as any,
    assetHits,
    citations,
  };
}

export async function listBidProjects(): Promise<IBidProjectDraft[]> {
  const result = await ipcBridge.bidProject.listProjects.invoke();
  if (!result.success || !result.data) return [];
  return result.data.map(
    (project: IBidProjectEntity): IBidProjectDraft => ({
      id: project.id,
      name: project.name,
      company: project.company,
      budget: project.budget,
      projectType: project.projectType,
      target: project.target,
      duration: project.duration,
      procurementMethod: project.procurementMethod,
      remark: project.remark,
      status: project.status,
      version: project.currentVersion,
      updatedAt: project.updatedAt,
      files: [] as IBidProjectDetailView['files'],
      facts: [] as IBidProjectFactItem[],
      analysis: createAnalysis({
        budget: project.budget,
        projectType: project.projectType,
        target: project.target,
        duration: project.duration,
        company: project.company,
        procurementMethod: project.procurementMethod,
        name: project.name,
        facts: [],
        assetHits: [],
        sourceOrigins: [],
      }),
      detectedFields: buildDetectedFields({
        budget: project.budget,
        target: project.target,
        duration: project.duration,
        company: project.company,
        name: project.name,
        facts: [],
      }),
      templateOptions: [i18n.t('bidProjects.defaults.templateUnicomDirect'), i18n.t('bidProjects.defaults.templateNegotiation'), i18n.t('bidProjects.defaults.templateRecruitment')],
      selectedTemplate: project.selectedTemplate || i18n.t('bidProjects.defaults.defaultTemplate'),
      clauseGroups: createClauseGroups(project.projectType),
      sections: parseSections(getDefaultMarkdown()),
      sourceSummaries: [],
      pendingItems: buildPendingItems(project as any, []),
      markdown: getDefaultMarkdown(),
      complianceIssues: [],
      versions: [],
      assistantContext: {
        mode: 'project',
        contextLabels: [],
        sourceOrigins: [],
        assetKinds: [],
      },
      sourceOrigins: [],
      assetHits: [],
      citations: [],
    })
  );
}

export async function getBidProject(projectId: string): Promise<IBidProjectDetailView | null> {
  const result = await ipcBridge.bidProject.getProject.invoke({ projectId });
  if (!result.success || !result.data) return null;
  return mapProjectDetail(result.data);
}

export async function createBidProject(input: IBidProjectCreateInput): Promise<IBidProjectDetailView> {
  const result = await ipcBridge.bidProject.createProject.invoke(input);
  if (!result.success || !result.data) {
    throw new Error(result.msg || 'Failed to create project');
  }
  return mapProjectDetail(result.data);
}

export async function updateBidProject(projectId: string, patch: Partial<IBidProjectDraft>): Promise<IBidProjectDetailView | null> {
  const result = await ipcBridge.bidProject.updateProject.invoke({
    projectId,
    updates: {
      name: patch.name,
      company: patch.company,
      budget: patch.budget,
      projectType: patch.projectType,
      target: patch.target,
      duration: patch.duration,
      procurementMethod: patch.procurementMethod,
      remark: patch.remark,
      markdown: patch.markdown,
      status: patch.status as any,
      selectedTemplate: patch.selectedTemplate,
      currentVersion: patch.version,
    },
  });
  if (!result.success || !result.data) return null;
  return mapProjectDetail(result.data);
}

export async function parseBidProjectSources(projectId: string): Promise<IBidProjectDetailView | null> {
  const result = await ipcBridge.bidProject.parseAllSources.invoke({ projectId });
  if (!result.success || !result.data) return null;
  return mapProjectDetail(result.data);
}

export async function generateBidProjectAiSections(input: IBidProjectAiGenerateInput): Promise<IBidProjectAiGenerateViewResult | null> {
  const result = await ipcBridge.bidProject.generateAiSections.invoke(input);
  if (!result.success || !result.data) return null;
  return {
    detail: mapProjectDetail(result.data.detail),
    generatedSections: result.data.generatedSections,
  };
}

export async function updateBidProjectFactStatus(factId: string, status: TBidProjectFactStatus) {
  if (status === 'confirmed') {
    return await ipcBridge.bidProject.confirmFact.invoke({ factId });
  }
  return await ipcBridge.bidProject.rejectFact.invoke({ factId });
}

export async function confirmBidProjectFact(factId: string) {
  return await ipcBridge.bidProject.confirmFact.invoke({ factId });
}

export async function rejectBidProjectFact(factId: string) {
  return await ipcBridge.bidProject.rejectFact.invoke({ factId });
}

export async function chatBidProjectAssistant(input: IBidProjectAssistantChatInput): Promise<IBidProjectAssistantChatResult | null> {
  const result = await ipcBridge.bidProject.chatAssistant.invoke(input);
  if (!result.success || !result.data) return null;
  return result.data;
}
